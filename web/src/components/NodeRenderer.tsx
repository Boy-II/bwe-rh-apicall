import { useCallback, useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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

  return (
    <div className="space-y-4">
      {nodes.map((node, i) => {
        const label = node.description || node.descriptionEn || node.fieldName;
        const type = (node.fieldType || 'STRING').toUpperCase();
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
            <NodeField type={type} node={node} draft={drafts[i] || {}} onChange={(p) => setField(i, p)} />
          </div>
        );
      })}
    </div>
  );
}

interface FieldProps {
  type: string;
  node: NodeInfo;
  draft: DraftNode;
  onChange: (patch: Partial<DraftNode>) => void;
}

function NodeField({ type, node, draft, onChange }: FieldProps) {
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
        <FileField
          fileType={type.toLowerCase() as 'image' | 'video' | 'audio'}
          node={node}
          draft={draft}
          onChange={onChange}
        />
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
}: {
  fileType: 'image' | 'video' | 'audio';
  node: NodeInfo;
  draft: DraftNode;
  onChange: (patch: Partial<DraftNode>) => void;
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
        onChange({ uploadedFileName: res.fileName, fieldValue: res.fileName });
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
        <img
          src={previewUrl}
          alt="預覽"
          className="mt-3 max-h-48 w-full rounded-md object-contain"
        />
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
