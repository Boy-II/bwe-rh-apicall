import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import api from '@/lib/api';
import type { TemplateCategory } from '@/lib/types';

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];

/** 管理員：手動新增範本到提示詞庫。 */
export function NewTemplatePage({ onCreated }: { onCreated: () => void }) {
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [dragging, setDragging] = useState(false);
  const [promptZh, setPromptZh] = useState('');
  const [promptEn, setPromptEn] = useState('');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [mode, setMode] = useState('');
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.templates.categories().then(setCategories).catch(() => setCategories([]));
  }, []);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!ACCEPT.includes(f.type)) {
      toast.error('只支援 PNG、JPG、WEBP 圖片');
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error('圖片超過 20 MB');
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files || []).find((x) => x.type.startsWith('image/'));
      if (f) {
        e.preventDefault();
        pick(f);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const reset = () => {
    setFile(null);
    setPreview('');
    setPromptZh('');
    setPromptEn('');
    setTitle('');
    setCategoryId('');
    setMode('');
  };

  const submit = async () => {
    if (!file) return toast.error('請上傳示例圖片');
    if (!promptZh.trim() && !promptEn.trim()) return toast.error('請至少填寫中文或英文提示詞');
    setSaving(true);
    try {
      const t = await api.adminTemplates.create({ file, promptZh, promptEn, title, categoryId, mode });
      toast.success(`已新增「${t.title}」`);
      reset();
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="mb-1 text-2xl font-semibold">新增範本</h1>
      <p className="mb-5 text-sm text-muted-foreground">標題、分類、模式可留空，送出時由 AI 依提示詞自動判斷。</p>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-medium">示例圖片 *</div>
          <div
            role="button"
            tabIndex={0}
            aria-label="上傳示例圖片"
            onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files[0]);
            }}
            className={
              'relative flex min-h-[320px] cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-colors ' +
              (dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50')
            }
          >
            {preview ? (
              <>
                <img src={preview} alt="示例圖片預覽" className="max-h-[480px] w-full object-contain" />
                <button
                  type="button"
                  aria-label="移除圖片"
                  className="absolute right-2 top-2 rounded-full bg-black/50 p-1 text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setPreview('');
                  }}
                >
                  <X className="size-4" />
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
                <ImagePlus className="size-8 opacity-60" />
                拖拉圖片到這裡、點選選擇，或直接貼上（Ctrl/⌘+V）
                <span className="text-xs">PNG／JPG／WEBP，最大 20 MB</span>
              </div>
            )}
          </div>
          <input
            ref={input}
            type="file"
            accept={ACCEPT.join(',')}
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <div className="space-y-4 text-sm">
          <label className="block space-y-1">
            <span className="font-medium">中文提示詞</span>
            <Textarea rows={6} value={promptZh} onChange={(e) => setPromptZh(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="font-medium">英文提示詞</span>
            <Textarea rows={6} value={promptEn} onChange={(e) => setPromptEn(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="font-medium">標題（選填）</span>
            <Input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="留空由 AI 產生" />
          </label>
          <div className="flex gap-3">
            <label className="block flex-1 space-y-1">
              <span className="font-medium">分類（選填）</span>
              <select className="h-9 w-full rounded-md border border-input bg-background px-2" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">AI 判斷</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1 space-y-1">
              <span className="font-medium">模式（選填）</span>
              <select className="h-9 w-full rounded-md border border-input bg-background px-2" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="">AI 判斷</option>
                <option value="t2i">文生圖</option>
                <option value="i2i">圖生圖</option>
              </select>
            </label>
          </div>
          <Button onClick={submit} disabled={saving} className="w-full">
            {saving ? '新增中…（AI 判斷約需數秒）' : '新增到提示詞庫'}
          </Button>
        </div>
      </div>
    </div>
  );
}
