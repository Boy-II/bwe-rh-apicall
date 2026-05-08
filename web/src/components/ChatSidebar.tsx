import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ImagePlus, Send, X, Trash2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { compressImageToJpegDataUrl } from '@/lib/image-compress';
import type { ChatHistoryEntry, NodeInfo } from '@/lib/types';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB
const MAX_IMAGES = 2;

interface ChatContext {
  cardTitle?: string;
  /** admin 寫的 AI 助手說明（不對 user 顯示）。送進 LLM system prompt */
  cardLlmNote?: string;
  nodeInfoList?: NodeInfo[];
}

interface Props {
  context?: ChatContext;
  onApplyPrompt?: (text: string) => void;
}

interface MsgPart {
  type: 'text' | 'image' | 'prompt';
  content: string;
}

interface UiMessage {
  role: 'user' | 'model';
  parts: MsgPart[];
}

const WELCOME: UiMessage = {
  role: 'model',
  parts: [
    {
      type: 'text',
      content:
        '您好！我是 BWE AI 助手 🤖\n可以問我關於 AI 應用選擇或提示詞撰寫的問題。\n\n支援同時傳送 2 張圖片（每張最大 3 MB），可拖曳到此處上傳。',
    },
  ],
};

function parseResponse(text: string): MsgPart[] {
  const parts: MsgPart[] = [];
  const regex = /```prompt\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', content: text.slice(last, m.index) });
    parts.push({ type: 'prompt', content: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', content: text.slice(last) });
  return parts.length > 0 ? parts : [{ type: 'text', content: text }];
}

export function ChatSidebar({ context, onApplyPrompt }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([WELCOME]);
  const [history, setHistory] = useState<ChatHistoryEntry[]>([]);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const ctx = useMemo(() => ({
    cardTitle: context?.cardTitle,
    cardLlmNote: context?.cardLlmNote,
    nodeInfoList: context?.nodeInfoList,
  }), [context]);

  const acceptFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;
    const room = MAX_IMAGES - pendingImages.length;
    if (room <= 0) {
      alert(`最多只能附加 ${MAX_IMAGES} 張圖片`);
      return;
    }
    const taking = list.slice(0, room);
    const next: string[] = [];
    for (const file of taking) {
      if (file.size > MAX_IMAGE_BYTES) {
        alert(
          `「${file.name}」超過 ${MAX_IMAGE_BYTES / 1024 / 1024} MB（目前 ${(file.size / 1024 / 1024).toFixed(1)} MB）`,
        );
        continue;
      }
      try {
        // 自動壓成 JPEG 縮減 base64 體積（最長邊 2048、quality 0.85）
        // task 節點上傳不走這個，確保模型輸入畫質
        next.push(await compressImageToJpegDataUrl(file, { maxDim: 2048, quality: 0.85 }));
      } catch {
        // ignore unreadable
      }
    }
    if (next.length > 0) setPendingImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
    if (list.length > taking.length) {
      alert(`已超過上限 ${MAX_IMAGES} 張，多餘的圖片已忽略`);
    }
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) await acceptFiles(e.target.files);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeImage = (idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || isLoading) return;

    const imagesToSend = pendingImages.slice();
    const userParts: MsgPart[] = [];
    imagesToSend.forEach((img) => userParts.push({ type: 'image', content: img }));
    if (text) userParts.push({ type: 'text', content: text });

    setMessages((m) => [...m, { role: 'user', parts: userParts }]);
    setHistory((h) => [
      ...h,
      { role: 'user', content: text || `（${imagesToSend.length} 張圖片）` },
    ]);
    setInput('');
    setPendingImages([]);
    setIsLoading(true);

    try {
      const reply = await api.proxy.chat({
        message: text || '請描述這些圖片的內容。',
        history: history.slice(-20),
        context: ctx,
        images: imagesToSend,
      });
      setHistory((h) => [...h, { role: 'assistant', content: reply }]);
      setMessages((m) => [...m, { role: 'model', parts: parseResponse(reply) }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: 'model', parts: [{ type: 'text', content: `❌ 錯誤：${(e as Error).message}` }] },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearHistory = () => {
    setMessages([{ role: 'model', parts: [{ type: 'text', content: '對話已清除。有什麼可以幫您的嗎？' }] }]);
    setHistory([]);
    setPendingImages([]);
  };

  // 在 sidebar 上 drop 圖片
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) {
      void acceptFiles(e.dataTransfer.files);
    }
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 只有真的離開 sidebar 才取消
    if (e.currentTarget === e.target) setDragOver(false);
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-30 inline-flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
          aria-label="開啟 AI 助手"
        >
          <Bot className="size-6" />
        </button>
      )}

      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setOpen(false)}
      />

      <aside
        className={cn(
          'fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-xl transition-transform',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/10 backdrop-blur-sm">
            <div className="rounded-lg border-2 border-dashed border-primary bg-background/80 px-6 py-4 text-sm font-medium text-primary">
              放開以加入圖片（最多 {MAX_IMAGES} 張，每張 ≤ 3 MB）
            </div>
          </div>
        )}

        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="font-medium">AI 助手</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={clearHistory} aria-label="清除對話">
              <Trash2 className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="關閉">
              <X className="size-4" />
            </Button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} onApply={onApplyPrompt} />
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex gap-1 rounded-2xl bg-muted px-3 py-2">
                <span className="size-1.5 animate-bounce rounded-full bg-foreground/60 [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-foreground/60 [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-foreground/60" />
              </div>
            </div>
          )}
        </div>

        {pendingImages.length > 0 && (
          <div className="border-t border-border p-2">
            <div className="flex flex-wrap gap-2">
              {pendingImages.map((img, idx) => (
                <div key={idx} className="relative">
                  <img
                    src={img}
                    alt={`待傳送 ${idx + 1}`}
                    className="h-20 w-20 rounded-md border border-border object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(idx)}
                    className="absolute -right-2 -top-2 inline-flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                    aria-label="移除圖片"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              <span className="self-center text-xs text-muted-foreground">
                {pendingImages.length}/{MAX_IMAGES}
              </span>
            </div>
          </div>
        )}

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onPickImage}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              aria-label="附加圖片"
              disabled={isLoading || pendingImages.length >= MAX_IMAGES}
              title={pendingImages.length >= MAX_IMAGES ? '已達 2 張上限' : '附加圖片'}
            >
              <ImagePlus className="size-4" />
            </Button>
            <Textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`輸入訊息（Enter 送出，Shift+Enter 換行；可拖曳圖片）`}
              className="min-h-9 resize-none"
              disabled={isLoading}
            />
            <Button type="button" size="icon" onClick={send} disabled={isLoading} aria-label="送出">
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}

function MessageBubble({
  msg,
  onApply,
}: {
  msg: UiMessage;
  onApply?: (text: string) => void;
}) {
  const isUser = msg.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] space-y-2 rounded-2xl px-3 py-2 text-sm',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {msg.parts.map((part, i) => {
          if (part.type === 'image') {
            return <img key={i} src={part.content} alt="" className="max-h-48 rounded-md" />;
          }
          if (part.type === 'prompt') {
            return (
              <div key={i} className="rounded-md border border-border bg-background p-2 text-foreground">
                <pre className="whitespace-pre-wrap break-words text-xs">{part.content}</pre>
                {onApply && (
                  <Button size="sm" className="mt-2 w-full" onClick={() => onApply(part.content)}>
                    ✅ 套用到提示詞欄位
                  </Button>
                )}
              </div>
            );
          }
          return (
            <div key={i} className="whitespace-pre-wrap break-words">
              {part.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
