import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { prepareModelImage } from '@/lib/image-compress';
import api from '@/lib/api';
import type { ModelParam } from '@/lib/types';

interface Item {
  id: string;
  preview: string;
  url?: string;
  error?: string;
  file?: File;
  size?: string;
}
interface Props {
  cardId: string;
  param: ModelParam;
  initial: string[];
  disabled: boolean;
  onChange: (urls: string[], busy: boolean) => void;
}

export function MultiImageInput({ cardId, param, initial, disabled, onChange }: Props) {
  const [items, setItems] = useState<Item[]>(() =>
    initial.map((url) => ({ id: crypto.randomUUID(), preview: url, url })),
  );
  const current = useRef(items);
  const alive = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const [selectionError, setSelectionError] = useState('');
  const limit = param.multipleInputs ? param.maxInputNum || 1 : 1;
  const commit = (next: Item[]) => {
    current.current = next;
    setItems(next);
    callback.current(
      next.flatMap((i) => (i.url ? [i.url] : [])),
      next.some((i) => !i.url),
    );
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const i of current.current)
        if (i.preview.startsWith('blob:')) URL.revokeObjectURL(i.preview);
    };
  }, []);
  const update = (id: string, patch: Partial<Item>) => {
    if (alive.current) commit(current.current.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };
  const upload = async (item: Item) => {
    if (!item.file) return;
    update(item.id, { error: undefined });
    try {
      const prepared = await prepareModelImage(item.file, (param.maxSize || 10) * 1024 * 1024);
      if (!alive.current || !current.current.some((i) => i.id === item.id)) return;
      const preview = URL.createObjectURL(prepared.file);
      if (item.preview.startsWith('blob:')) URL.revokeObjectURL(item.preview);
      update(item.id, {
        preview,
        size: `${prepared.width} × ${prepared.height} · ${(prepared.file.size / 1024).toFixed(0)} KB`,
      });
      const result = await api.models.upload(cardId, param.fieldKey, prepared.file);
      // Removed rows stay removed even if their network response arrives later.
      update(item.id, { url: result.url });
    } catch (e) {
      update(item.id, { error: (e as Error).message });
    }
  };
  const add = (files: FileList | null) => {
    if (!files) return;
    const room = limit - current.current.length;
    if (files.length > room) setSelectionError(`此欄位最多 ${limit} 張，超出的檔案未加入`);
    else setSelectionError('');
    const added = Array.from(files)
      .slice(0, Math.max(0, room))
      .map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) }));
    commit([...current.current, ...added]);
    // Sequential upload avoids a burst from a fourteen-image selection.
    void (async () => {
      for (const item of added) await upload(item);
    })();
    if (input.current) input.current.value = '';
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {items.length} / {limit} 張 · 自動等比縮圖至長邊 1024 px，PNG 保留透明度 · 每張最多{' '}
        {param.maxSize || 10} MB
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item, index) => (
          <div key={item.id} className="overflow-hidden rounded-lg border bg-muted/20 p-2">
            <img
              src={item.preview}
              alt={`參考圖片 ${index + 1}`}
              className="h-28 w-full rounded object-contain"
            />
            <p className="mt-2 break-all text-xs text-muted-foreground">
              {item.size || item.file?.name || '已上傳圖片'}
            </p>
            <p
              className={item.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
              role={item.error ? 'alert' : undefined}
            >
              {item.error || (!item.url ? '處理／上傳中…' : '已上傳')}
            </p>
            <div className="mt-2 flex gap-1">
              {item.error && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void upload(item)}
                >
                  重試
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                aria-label={`移除參考圖片 ${index + 1}`}
                onClick={() => {
                  if (item.preview.startsWith('blob:')) URL.revokeObjectURL(item.preview);
                  commit(current.current.filter((i) => i.id !== item.id));
                }}
              >
                移除
              </Button>
            </div>
          </div>
        ))}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple={limit > 1}
        className="hidden"
        onChange={(e) => add(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        disabled={disabled || items.length >= limit}
        onClick={() => input.current?.click()}
      >
        新增圖片{limit > 1 ? '（可多選）' : ''}
      </Button>
      {selectionError && (
        <p className="text-xs text-destructive" role="alert">
          {selectionError}
        </p>
      )}
    </div>
  );
}
