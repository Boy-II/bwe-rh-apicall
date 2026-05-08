import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, X, Loader2, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PALETTE } from '@/lib/card-utils';
import type { Card, EditableField, NodeInfo } from '@/lib/types';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  card: Card | null;
  onClose: () => void;
  onSaved: () => void;
}

const empty: Partial<Card> = {
  cardType: 'webapp',
  webappId: '',
  workflowId: '',
  title: '',
  description: '',
  llmNote: '',
  color: PALETTE[0],
  coverUrl: '',
  editableFields: [],
  instanceType: 'default',
  maxDurationSeconds: 0,
};

function fieldKey(f: { nodeId: string; fieldName: string }) {
  return `${f.nodeId}::${f.fieldName}`;
}

export function CardEditModal({ open, card, onClose, onSaved }: Props) {
  const [form, setForm] = useState<Partial<Card>>(empty);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [nodes, setNodes] = useState<NodeInfo[]>([]); // workflow 載入的節點
  const [loadingNodes, setLoadingNodes] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isEdit = !!card;

  useEffect(() => {
    if (open) {
      setForm(card ? { ...card } : { ...empty });
      setNodes([]);
    }
  }, [open, card]);

  const set = <K extends keyof Card>(key: K, value: Card[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onPickFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('請選擇圖片檔案');
      return;
    }
    setUploading(true);
    try {
      const res = await api.cards.uploadCover(file);
      set('coverUrl', res.coverUrl);
      toast.success('預覽圖已上傳');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const loadWorkflowNodes = async () => {
    if (!form.workflowId?.trim()) {
      toast.error('請先填 workflowId');
      return;
    }
    setLoadingNodes(true);
    try {
      const list = await api.proxy.getWorkflowJson(form.workflowId.trim());
      setNodes(list);
      if (list.length === 0) toast.warning('此 workflow 沒有可修改節點');
      else toast.success(`載入 ${list.length} 個節點`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingNodes(false);
    }
  };

  const editableSet = new Set((form.editableFields || []).map(fieldKey));
  const toggleField = (n: NodeInfo) => {
    const key = fieldKey(n);
    const cur = form.editableFields || [];
    const next: EditableField[] = editableSet.has(key)
      ? cur.filter((e) => fieldKey(e) !== key)
      : [...cur, { nodeId: n.nodeId, fieldName: n.fieldName }];
    set('editableFields', next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title?.trim()) {
      toast.error('請填寫卡片名稱');
      return;
    }
    if (form.cardType === 'webapp' && !form.webappId?.trim()) {
      toast.error('webapp 卡片需要 webappId');
      return;
    }
    if (form.cardType === 'workflow' && !form.workflowId?.trim()) {
      toast.error('workflow 卡片需要 workflowId');
      return;
    }
    setSaving(true);
    try {
      if (isEdit && card) {
        await api.cards.update(card.id, {
          title: form.title || '',
          description: form.description || '',
          llmNote: form.llmNote || '',
          coverUrl: form.coverUrl || '',
          color: form.color || PALETTE[0],
          editableFields: form.cardType === 'workflow' ? form.editableFields || [] : undefined,
          instanceType: form.cardType === 'workflow' ? form.instanceType : undefined,
          maxDurationSeconds: form.maxDurationSeconds ?? 0,
        });
        toast.success('卡片已更新');
      } else {
        await api.cards.create({
          cardType: form.cardType,
          webappId: form.cardType === 'webapp' ? form.webappId || '' : '',
          workflowId: form.cardType === 'workflow' ? form.workflowId || '' : '',
          title: form.title || '',
          description: form.description || '',
          llmNote: form.llmNote || '',
          coverUrl: form.coverUrl || '',
          color: form.color || PALETTE[0],
          editableFields: form.cardType === 'workflow' ? form.editableFields || [] : [],
          instanceType: form.cardType === 'workflow' ? form.instanceType : 'default',
          maxDurationSeconds: form.maxDurationSeconds ?? 0,
        });
        toast.success('卡片已建立');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '編輯卡片' : '新增卡片'}</DialogTitle>
          <DialogDescription>
            選擇卡片類型：webapp（直接呼叫 AI 應用）或 workflow（指定可編輯欄位）
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {/* 型別切換 */}
          <div className="space-y-2">
            <Label>卡片類型</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => set('cardType', 'webapp')}
                disabled={isEdit}
                className={cn(
                  'rounded-md border p-3 text-left transition-colors',
                  form.cardType === 'webapp'
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/40',
                  isEdit && 'opacity-60 cursor-not-allowed',
                )}
              >
                <div className="text-sm font-semibold">webapp</div>
                <div className="text-xs text-muted-foreground">AI 應用（webappId）</div>
              </button>
              <button
                type="button"
                onClick={() => set('cardType', 'workflow')}
                disabled={isEdit}
                className={cn(
                  'rounded-md border p-3 text-left transition-colors',
                  form.cardType === 'workflow'
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/40',
                  isEdit && 'opacity-60 cursor-not-allowed',
                )}
              >
                <div className="text-sm font-semibold">workflow</div>
                <div className="text-xs text-muted-foreground">工作流 + 編輯白名單</div>
              </button>
            </div>
            {isEdit && (
              <p className="text-xs text-muted-foreground">建立後類型不可變更</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">卡片名稱</Label>
            <Input
              id="title"
              value={form.title || ''}
              onChange={(e) => set('title', e.target.value)}
              placeholder="例：人像修復"
            />
          </div>

          {form.cardType === 'webapp' ? (
            <div className="space-y-2">
              <Label htmlFor="webappId">webappId</Label>
              <Input
                id="webappId"
                value={form.webappId || ''}
                onChange={(e) => set('webappId', e.target.value)}
                placeholder="AI 應用 ID"
                disabled={isEdit}
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="workflowId">workflowId</Label>
                <div className="flex gap-2">
                  <Input
                    id="workflowId"
                    value={form.workflowId || ''}
                    onChange={(e) => set('workflowId', e.target.value)}
                    placeholder="workflow ID"
                    disabled={isEdit}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    onClick={loadWorkflowNodes}
                    disabled={loadingNodes || !form.workflowId?.trim()}
                  >
                    {loadingNodes ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    載入節點
                  </Button>
                </div>
              </div>

              {/* GPU instance type */}
              <div className="rounded-md border border-border p-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={form.instanceType === 'plus'}
                    onChange={(e) => set('instanceType', e.target.checked ? 'plus' : 'default')}
                    className="size-4 cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">使用 4090 48G（plus）</div>
                    <div className="text-xs text-muted-foreground">
                      預設使用 24G 機器；勾選後切換到 48G 機器（速度較快但較貴）
                    </div>
                  </div>
                </label>
              </div>

              {/* 編輯白名單 */}
              <div className="space-y-2">
                <Label>使用者可編輯的欄位</Label>
                {nodes.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                    點擊「載入節點」抓取此 workflow 的所有可修改欄位，再勾選哪些開放給使用者
                  </p>
                ) : (
                  <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                    {nodes.map((n) => {
                      const key = fieldKey(n);
                      const checked = editableSet.has(key);
                      const label = n.description || n.descriptionEn || n.fieldName;
                      return (
                        <label
                          key={key}
                          className="flex cursor-pointer items-start gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleField(n)}
                            className="mt-0.5 size-4 cursor-pointer"
                          />
                          <div className="flex-1 text-sm">
                            <div className="font-medium">{label}</div>
                            <div className="font-mono text-xs text-muted-foreground">
                              #{n.nodeId} · {n.fieldName} · {n.fieldType || 'STRING'}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  未勾選的欄位會用 workflow 預設值送出，使用者看不到（適合反向提示詞等固定設定）
                </p>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="maxDuration">最長執行時長（秒）</Label>
            <Input
              id="maxDuration"
              type="number"
              min={0}
              max={3600}
              step={60}
              value={form.maxDurationSeconds ?? 0}
              onChange={(e) => set('maxDurationSeconds', parseInt(e.target.value) || 0)}
              placeholder="0 = 用全域預設（10 分鐘）"
            />
            <p className="text-xs text-muted-foreground">
              0 = 全域預設 600 秒；建議 60–3600 秒。RH 平台單任務上限 60 分鐘，超過此值將標記為 TIMEOUT。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">描述（使用者可見）</Label>
            <Textarea
              id="description"
              rows={3}
              value={form.description || ''}
              onChange={(e) => set('description', e.target.value)}
              placeholder="一句話描述應用功能，會顯示在卡片上"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="llmNote">
              🤖 AI 助手說明（不對使用者顯示）
            </Label>
            <Textarea
              id="llmNote"
              rows={6}
              value={form.llmNote || ''}
              onChange={(e) => set('llmNote', e.target.value)}
              placeholder={`給 AI 助手看的功能規格與欄位用途。例：
分塊數量：默認 2，輸出畫質為 4K；1=2K、3=6K、4=8K。
建議使用 2 或 3，當文字或人像佔比小時可調到 4。`}
            />
            <p className="text-xs text-muted-foreground">
              使用者在此卡片下提問時，AI 助手會優先依此說明作答。可寫欄位用途、預設值、建議設定等。
            </p>
          </div>

          <div className="space-y-2">
            <Label>預覽圖</Label>
            <div className="flex items-start gap-3">
              <div
                className="flex aspect-square w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted"
                style={form.coverUrl ? undefined : { backgroundColor: form.color || PALETTE[0] }}
              >
                {form.coverUrl ? (
                  <img src={form.coverUrl} alt="預覽" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-xs text-white/80">尚無圖片</span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPickFile(f);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> 上傳中…
                    </>
                  ) : (
                    <>
                      <Upload className="size-4" /> 上傳圖片
                    </>
                  )}
                </Button>
                {form.coverUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => set('coverUrl', '')}
                  >
                    <X className="size-4" /> 移除圖片
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  PNG/JPG/WEBP/GIF，最大 5 MB
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>主題色（無預覽圖時的背景）</Label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => set('color', c)}
                  className={cn(
                    'size-8 rounded-md border-2 transition-all',
                    form.color === c ? 'scale-110 border-foreground' : 'border-transparent',
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving || uploading}>
              {saving ? '儲存中…' : '儲存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
