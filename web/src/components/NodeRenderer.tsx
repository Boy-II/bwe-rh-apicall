import { useCallback, useMemo, useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle2, AlertCircle, Brush } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { MaskEditorModal } from './MaskEditorModal';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import type { NodeInfo } from '@/lib/types';
import type { DraftNode } from '@/lib/task-utils';

interface Props {
  nodes: NodeInfo[];
  drafts: DraftNode[];
  onChange: (drafts: DraftNode[]) => void;
}

export function NodeRenderer({ nodes, drafts, onChange }: Props) {
  // 自動偵測 mask editor：admin 把某欄位類型設為 MASK 即觸發
  // 該欄位 = mask（user 端隱藏，由編輯器自動填）、第一個 IMAGE 欄位 = source
  const { sourceIdx, maskIdx } = useMemo(() => {
    const maskIdxFound = nodes.findIndex(
      (n) => (n.fieldType || '').toUpperCase() === 'MASK',
    );
    if (maskIdxFound < 0) return { sourceIdx: -1, maskIdx: -1 };

    const sourceIdxFound = nodes.findIndex(
      (n, i) => i !== maskIdxFound && (n.fieldType || '').toUpperCase() === 'IMAGE',
    );
    if (sourceIdxFound < 0) return { sourceIdx: -1, maskIdx: -1 };

    return { sourceIdx: sourceIdxFound, maskIdx: maskIdxFound };
  }, [nodes]);

  const [editorOpen, setEditorOpen] = useState(false);

  if (nodes.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        此工作流沒有可修改的節點
      </div>
    );
  }

  const setField = (i: number, patch: Partial<DraftNode>) => {
    const next = drafts.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const sourceDraft = sourceIdx >= 0 ? drafts[sourceIdx] : null;
  const maskDraft = maskIdx >= 0 ? drafts[maskIdx] : null;
  const sourceImageUrl = sourceDraft?.localImageUrl || '';
  const hasSource = !!sourceImageUrl && !!sourceDraft?.uploadedFileName;
  const hasMask = !!maskDraft?.uploadedFileName;

  const handleMaskConfirm = async (blob: Blob, previewDataUrl: string) => {
    if (maskIdx < 0) return;
    try {
      const file = new File([blob], 'mask.png', { type: 'image/png' });
      const res = await api.proxy.uploadFile(file);
      setField(maskIdx, {
        uploadedFileName: res.fileName,
        fieldValue: res.fileName,
        localMaskDataUrl: previewDataUrl,
      });
      setEditorOpen(false);
      toast.success('Mask 已上傳');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      {nodes.map((node, i) => {
        // mask editor 模式下隱藏 mask 欄位（由編輯器自動填入）
        if (i === maskIdx) return null;

        const label = node.description || node.descriptionEn || node.fieldName;
        const type = (node.fieldType || 'STRING').toUpperCase();
        const isSource = i === sourceIdx;

        return (
          <div
            key={`${node.nodeId}-${i}`}
            className="rounded-lg border border-border bg-card p-4 shadow-sm"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{label}</span>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono">#{node.nodeId}</span>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-primary">
                  {type}
                </span>
              </div>
            </div>
            <NodeField
              type={type}
              node={node}
              draft={drafts[i] || {}}
              onChange={(p) => {
                // 換來源圖時清空 mask
                if (isSource && p.uploadedFileName && maskIdx >= 0) {
                  setField(maskIdx, {
                    uploadedFileName: null,
                    fieldValue: '',
                    localMaskDataUrl: undefined,
                  });
                }
                setField(i, p);
              }}
              imageOverlay={
                isSource && hasSource ? (
                  <MaskQuickAccess
                    hasMask={hasMask}
                    onOpen={() => setEditorOpen(true)}
                    maskPreview={maskDraft?.localMaskDataUrl}
                  />
                ) : null
              }
              onImagePreviewDoubleClick={
                isSource && hasSource ? () => setEditorOpen(true) : undefined
              }
            />
          </div>
        );
      })}

      {editorOpen && sourceImageUrl && (
        <MaskEditorModal
          imageUrl={sourceImageUrl}
          initialMaskDataUrl={maskDraft?.localMaskDataUrl}
          onConfirm={handleMaskConfirm}
          onCancel={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}

function MaskQuickAccess({
  hasMask,
  onOpen,
  maskPreview,
}: {
  hasMask: boolean;
  onOpen: () => void;
  maskPreview?: string;
}) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black">
        {maskPreview ? (
          <img src={maskPreview} alt="mask" className="h-full w-full object-cover" />
        ) : (
          <Brush className="size-5 text-white/60" />
        )}
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium">
          {hasMask ? '✅ Mask 已就緒' : '請繪製 Mask 區域'}
        </div>
        <div className="text-xs text-muted-foreground">
          點擊預覽圖、雙擊原圖、或按下方按鈕都可開啟編輯器
        </div>
      </div>
      <Button type="button" size="sm" variant={hasMask ? 'outline' : 'default'} onClick={onOpen}>
        <Brush className="size-4" /> {hasMask ? '重新編輯' : '畫 Mask'}
      </Button>
    </div>
  );
}

interface FieldProps {
  type: string;
  node: NodeInfo;
  draft: DraftNode;
  onChange: (patch: Partial<DraftNode>) => void;
  /** 額外渲染區（目前用於 IMAGE 欄位下方的 mask 編輯器入口） */
  imageOverlay?: React.ReactNode;
  /** IMAGE 預覽雙擊時觸發 */
  onImagePreviewDoubleClick?: () => void;
}

function NodeField({ type, node, draft, onChange, imageOverlay, onImagePreviewDoubleClick }: FieldProps) {
  const value =
    draft.fieldValue !== undefined ? draft.fieldValue : node.fieldValue ?? '';

  switch (type) {
    case 'STRING':
      return (
        <Textarea
          rows={4}
          value={String(value ?? '')}
          onChange={(e) => onChange({ fieldValue: e.target.value })}
          placeholder={`輸入 ${node.fieldName}…`}
        />
      );
    case 'INT':
    case 'FLOAT':
      return (
        <Input
          type="number"
          step={type === 'INT' ? 1 : 0.01}
          value={String(value ?? '')}
          onChange={(e) => onChange({ fieldValue: e.target.value })}
        />
      );
    case 'BOOLEAN':
      return (
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === true || value === 'true'}
            onChange={(e) => onChange({ fieldValue: e.target.checked })}
            className="size-4 cursor-pointer"
          />
          {value === true || value === 'true' ? '啟用' : '停用'}
        </label>
      );
    case 'LIST':
      return <ListField node={node} value={String(value ?? '')} onChange={onChange} />;
    case 'IMAGE':
    case 'VIDEO':
    case 'AUDIO':
      return (
        <>
          <FileField
            fileType={type.toLowerCase() as 'image' | 'video' | 'audio'}
            node={node}
            draft={draft}
            onChange={onChange}
            onPreviewDoubleClick={type === 'IMAGE' ? onImagePreviewDoubleClick : undefined}
          />
          {imageOverlay}
        </>
      );
    default:
      return (
        <Textarea
          rows={3}
          value={String(value ?? '')}
          onChange={(e) => onChange({ fieldValue: e.target.value })}
        />
      );
  }
}

function ListField({
  node,
  value,
  onChange,
}: {
  node: NodeInfo;
  value: string;
  onChange: (patch: Partial<DraftNode>) => void;
}) {
  let options: string[] = [];
  if (node.fieldData) {
    try {
      const parsed = typeof node.fieldData === 'string' ? JSON.parse(node.fieldData) : node.fieldData;
      if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
        options = parsed[0].map((x: unknown) => String(x));
      } else if (Array.isArray(parsed)) {
        options = parsed.filter((o) => typeof o === 'string' || typeof o === 'number').map(String);
      }
    } catch {
      options = value ? [value] : [];
    }
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange({ fieldValue: e.target.value })}
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

function FileField({
  fileType,
  node,
  draft,
  onChange,
  onPreviewDoubleClick,
}: {
  fileType: 'image' | 'video' | 'audio';
  node: NodeInfo;
  draft: DraftNode;
  onChange: (patch: Partial<DraftNode>) => void;
  /** 圖片預覽被雙擊時觸發（mask editor 入口之一）*/
  onPreviewDoubleClick?: () => void;
}) {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptMap = { image: 'image/*', video: 'video/*', audio: 'audio/*' } as const;
  const labelText = fileType === 'image' ? '圖片' : fileType === 'video' ? '影片' : '音訊';

  const handleFile = useCallback(
    async (file: File) => {
      if (!file) return;
      if (file.type && !file.type.startsWith(`${fileType}/`)) {
        setStatus('error');
        setErrorMsg(`請選擇${labelText}檔案`);
        return;
      }
      if (fileType === 'image' || fileType === 'video') {
        setPreviewUrl(URL.createObjectURL(file));
      }
      setStatus('uploading');
      setErrorMsg('');
      try {
        const res = await api.proxy.uploadFile(file);
        const patch: Partial<DraftNode> = {
          uploadedFileName: res.fileName,
          fieldValue: res.fileName,
        };
        // 圖片：也把 dataURL 存進 draft，給 mask editor 載入底圖用
        if (fileType === 'image') {
          patch.localImageUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }).catch(() => undefined);
        }
        onChange(patch);
        setStatus('success');
      } catch (e) {
        setStatus('error');
        setErrorMsg((e as Error).message);
      }
    },
    [fileType, labelText, onChange],
  );

  const current = draft.uploadedFileName || node.fieldValue || '';

  return (
    <div
      className={cn(
        'rounded-md border-2 border-dashed border-border p-4 transition-colors',
        dragOver && 'border-primary bg-primary/5',
      )}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFile(file);
      }}
    >
      <div className="text-xs text-muted-foreground">
        {current ? `目前：${String(current)}` : '尚未上傳'}
      </div>
      <div className="mt-3 flex flex-col items-center gap-2 text-center">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Upload className="size-4" /> 選擇{labelText}
        </button>
        <span className="text-xs text-muted-foreground">或將{labelText}拖曳到此處</span>
        <input
          ref={inputRef}
          type="file"
          accept={acceptMap[fileType]}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>
      {previewUrl && fileType === 'image' && (
        <div className={cn('group relative mt-3', onPreviewDoubleClick && 'cursor-pointer')}>
          <img
            src={previewUrl}
            alt="預覽"
            className="max-h-48 w-full rounded-md object-contain"
            onDoubleClick={onPreviewDoubleClick}
            title={onPreviewDoubleClick ? '雙擊開啟遮罩編輯器' : undefined}
          />
          {onPreviewDoubleClick && (
            <button
              type="button"
              onClick={onPreviewDoubleClick}
              className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              ✏️ 編輯 Mask
            </button>
          )}
        </div>
      )}
      {previewUrl && fileType === 'video' && (
        <video src={previewUrl} controls className="mt-3 max-h-48 w-full rounded-md" />
      )}
      <div className="mt-2 text-xs">
        {status === 'uploading' && (
          <span className="inline-flex items-center gap-1 text-primary">
            <Loader2 className="size-3 animate-spin" /> 上傳中…
          </span>
        )}
        {status === 'success' && (
          <span className="inline-flex items-center gap-1 text-primary">
            <CheckCircle2 className="size-3" /> 上傳成功
          </span>
        )}
        {status === 'error' && (
          <span className="inline-flex items-center gap-1 text-destructive">
            <AlertCircle className="size-3" /> {errorMsg}
          </span>
        )}
      </div>
    </div>
  );
}
