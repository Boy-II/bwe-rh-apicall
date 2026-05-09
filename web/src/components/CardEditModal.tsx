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
import { PALETTE, isVideoCover } from '@/lib/card-utils';
import { compressImageToJpegFile } from '@/lib/image-compress';
import type { Card, EditableField, NodeInfo } from '@/lib/types';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  card: Card | null;
  onClose: () => void;
  onSaved: () => void;
}

function TagEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const t = draft.trim().slice(0, 30);
    if (!t) return;
    if (value.includes(t)) {
      setDraft('');
      return;
    }
    if (value.length >= 10) {
      toast.error('最多 10 個標籤');
      return;
    }
    onChange([...value, t]);
    setDraft('');
  };

  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div className="rounded-md border border-input bg-transparent p-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((t, i) => (
          <span
            key={`${t}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
          >
            {t}
            <button
              type="button"
              onClick={() => remove(i)}
              className="rounded-full hover:bg-primary/20"
              aria-label={`移除 ${t}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Backspace' && !draft && value.length > 0) {
              e.preventDefault();
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={value.length === 0 ? '輸入後按 Enter…' : ''}
          className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
        />
      </div>
    </div>
  );
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
  tags: [],
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
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      toast.error('請選擇圖片或影片檔案');
      return;
    }
    setUploading(true);
    try {
      // 圖片：client-side 壓 JPG（maxDim 800 / quality 0.85）；影片：原檔上傳（≤ 10 MB）
      const toUpload = isImage
        ? await compressImageToJpegFile(file, { maxDim: 800, quality: 0.85 })
        : file;
      const res = await api.cards.uploadCover(toUpload);
      set('coverUrl', res.coverUrl);
      toast.success(isVideo ? '影片封面已上傳' : '預覽圖已上傳');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const loadNodes = async () => {
    const isWebapp = form.cardType === 'webapp';
    const id = (isWebapp ? form.webappId : form.workflowId)?.trim();
    if (!id) {
      toast.error(`請先填 ${isWebapp ? 'webappId' : 'workflowId'}`);
      return;
    }
    setLoadingNodes(true);
    try {
      const list = isWebapp
        ? await api.proxy.getNodeInfo(id)
        : await api.proxy.getWorkflowJson(id);
      setNodes(list);
      if (list.length === 0) toast.warning('沒有可修改節點');
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
      : [
          ...cur,
          {
            nodeId: n.nodeId,
            fieldName: n.fieldName,
            // 勾選時把 parser 推斷的類型存下來當預設；admin 可後續改
            fieldType: (n.fieldType || 'STRING').toUpperCase(),
          },
        ];
    set('editableFields', next);
  };

  const setFieldType = (n: NodeInfo, fieldType: string) => {
    const key = fieldKey(n);
    const cur = form.editableFields || [];
    const next = cur.map((e) =>
      fieldKey(e) === key ? { ...e, fieldType } : e,
    );
    set('editableFields', next);
  };

  const setDisplayName = (n: NodeInfo, displayName: string) => {
    const key = fieldKey(n);
    const cur = form.editableFields || [];
    const next = cur.map((e) =>
      fieldKey(e) === key ? { ...e, displayName } : e,
    );
    set('editableFields', next);
  };

  const getFieldType = (n: NodeInfo): string => {
    const key = fieldKey(n);
    const hit = (form.editableFields || []).find((e) => fieldKey(e) === key);
    return (hit?.fieldType || n.fieldType || 'STRING').toUpperCase();
  };

  const getDisplayName = (n: NodeInfo): string => {
    const key = fieldKey(n);
    const hit = (form.editableFields || []).find((e) => fieldKey(e) === key);
    return hit?.displayName || '';
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
          tags: form.tags || [],
          editableFields: form.editableFields || [],
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
          tags: form.tags || [],
          editableFields: form.editableFields || [],
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
              <div className="flex gap-2">
                <Input
                  id="webappId"
                  value={form.webappId || ''}
                  onChange={(e) => set('webappId', e.target.value)}
                  placeholder="AI 應用 ID"
                  disabled={isEdit}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={loadNodes}
                  disabled={loadingNodes || !form.webappId?.trim()}
                  title="重新從 RH 抓 webapp 節點"
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
                    onClick={loadNodes}
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

              {/* GPU instance type — workflow only */}
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
            </>
          )}

          {/* 編輯欄位（webapp / workflow 共用） */}
          <div className="space-y-2">
            <Label>使用者可編輯的欄位</Label>
            {nodes.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                點擊上方「載入節點」抓取目前可修改欄位
                {form.cardType === 'webapp'
                  ? '（webapp：未勾選則 user 端顯示全部欄位、用 RH 推斷類型）'
                  : '（workflow：勾選哪些開放給 user）'}
              </p>
            ) : (
              <div className="max-h-96 overflow-y-auto rounded-md border border-border">
                {nodes.map((n) => {
                  const key = fieldKey(n);
                  const checked = editableSet.has(key);
                  const defaultLabel = n.description || n.descriptionEn || n.fieldName;
                  return (
                    <div
                      key={key}
                      className="border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50"
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleField(n)}
                          className="mt-1 size-4 cursor-pointer"
                          id={`ed-${key}`}
                        />
                        <label
                          htmlFor={`ed-${key}`}
                          className="flex-1 cursor-pointer text-sm"
                        >
                          <div className="font-medium">{defaultLabel}</div>
                          <div className="font-mono text-xs text-muted-foreground">
                            #{n.nodeId} · {n.fieldName}
                          </div>
                        </label>
                        {checked ? (
                          <select
                            value={getFieldType(n)}
                            onChange={(e) => setFieldType(n, e.target.value)}
                            className="h-7 rounded-md border border-input bg-transparent px-2 text-xs"
                            title="渲染類型（admin 指定）"
                          >
                            <option value="STRING">STRING</option>
                            <option value="INT">INT</option>
                            <option value="IMAGE">IMAGE</option>
                            <option value="MASK">MASK 🎨</option>
                            <option value="VIDEO">VIDEO</option>
                            <option value="AUDIO">AUDIO</option>
                            <option value="LIST">LIST</option>
                          </select>
                        ) : (
                          <span className="self-center text-[10px] text-muted-foreground">
                            {(n.fieldType || 'STRING').toUpperCase()}
                          </span>
                        )}
                      </div>
                      {checked && (
                        <input
                          type="text"
                          value={getDisplayName(n)}
                          onChange={(e) => setDisplayName(n, e.target.value)}
                          placeholder={`使用者顯示名（留空＝用「${defaultLabel}」）`}
                          className="mt-1.5 ml-6 block w-[calc(100%-1.5rem)] rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-xs"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              <b>類型</b>決定 user 表單渲染方式（圖片上傳 / 文字框 / 數字 / 下拉…）；
              自動推斷對 IMAGE/VIDEO/AUDIO/MASK 不可靠，請手動選擇。
              <br />
              {form.cardType === 'webapp'
                ? '未勾選任何欄位 = 用 RH 預設行為（全部顯示 + RH 推斷類型）；勾選後變白名單。'
                : '未勾選的欄位會用 workflow 預設值送出（適合反向提示詞等固定設定）。'}
            </p>
          </div>

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

          {form.cardType === 'workflow' && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              <div className="text-sm font-medium text-foreground">🎨 遮罩編輯器自動觸發</div>
              <div className="mt-1">
                把任一欄位的<b className="text-foreground">類型設為 MASK</b>，使用者端就會自動開啟遮罩編輯器：
                <ul className="ml-4 mt-1 list-disc space-y-0.5">
                  <li>該 MASK 欄位對 user 隱藏</li>
                  <li>另一個 IMAGE 欄位視為來源圖（user 上傳）</li>
                  <li>user 畫 mask → 自動上傳填入該 MASK 欄位</li>
                </ul>
                匯出：白色 = 重繪區、黑色 = 保留區（含羽化漸層）。
              </div>
            </div>
          )}

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
            <Label>標籤（協助使用者搜尋）</Label>
            <TagEditor
              value={form.tags || []}
              onChange={(next) => set('tags', next)}
            />
            <p className="text-xs text-muted-foreground">
              Enter 或逗號加入；最多 10 個，每個 30 字內。例：「放大」「人像」「修復」
            </p>
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
                onMouseEnter={(e) => {
                  const v = e.currentTarget.querySelector('video');
                  v?.play().catch(() => {});
                }}
                onMouseLeave={(e) => {
                  const v = e.currentTarget.querySelector('video');
                  if (v) {
                    v.pause();
                    v.currentTime = 0;
                  }
                }}
              >
                {form.coverUrl ? (
                  isVideoCover(form.coverUrl) ? (
                    <video
                      src={form.coverUrl}
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <img src={form.coverUrl} alt="預覽" className="h-full w-full object-cover" />
                  )
                ) : (
                  <span className="text-xs text-white/80">尚無圖片</span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
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
                  圖片 PNG/JPG/WEBP/GIF（≤ 5 MB，自動壓 JPG）；影片 MP4/WEBM/MOV（≤ 10 MB，原檔上傳）
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
