import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api, { type MediaResultItem } from '@/lib/api';

const PAGE = 60;

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('zh-TW', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function daysLeft(expiresAt: string) {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000));
}

const isVideo = (url: string) => /\.(mp4|webm)$/i.test(url);

export function MediaManagePage() {
  const [items, setItems] = useState<MediaResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [retentionDays, setRetentionDays] = useState(45);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const page = await api.adminMedia.list(offset, PAGE);
      setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
      setTotal(page.total);
      setTotalSize(page.totalSize);
      setRetentionDays(page.retentionDays);
      setNextOffset(page.nextOffset);
      if (offset === 0) setSelected(new Set());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(0);
  }, [load]);

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const allSelected = items.length > 0 && items.every((i) => selected.has(i.name));

  const remove = async (names: string[]) => {
    if (names.length === 0) return;
    if (!confirm(`確定刪除 ${names.length} 張圖片？刪除後使用者的生成紀錄也看不到這些結果，無法復原。`)) return;
    setDeleting(true);
    try {
      const res = await api.adminMedia.remove(names);
      toast.success(`已刪除 ${res.deleted} 張圖片`);
      await load(0);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">圖片管理</h1>
          <p className="text-sm text-muted-foreground">
            伺服器上保存的生成結果：共 {total.toLocaleString()} 個，{formatSize(totalSize)}。超過 {retentionDays}{' '}
            天自動刪除。
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => load(0)} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> 重新整理
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">已選取 {selected.size} 個</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.name)))}
          disabled={items.length === 0}
        >
          {allSelected ? '取消全選' : '全選已載入'}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => remove([...selected])} disabled={selected.size === 0 || deleting}>
          <Trash2 /> {deleting ? '刪除中…' : `刪除選取 (${selected.size})`}
        </Button>
      </div>

      {items.length === 0 && !loading ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          目前沒有保存的生成圖片
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((it) => {
            const on = selected.has(it.name);
            const left = daysLeft(it.expiresAt);
            return (
              <div
                key={it.name}
                className={
                  'overflow-hidden rounded-lg border bg-card shadow-sm ' +
                  (on ? 'border-destructive ring-2 ring-destructive' : 'border-border')
                }
              >
                <button
                  type="button"
                  onClick={() => toggle(it.name)}
                  aria-pressed={on}
                  aria-label={`選取 ${it.name}`}
                  className="relative block w-full bg-muted"
                >
                  {isVideo(it.url) ? (
                    <video src={it.url} muted preload="metadata" className="aspect-square w-full object-cover" />
                  ) : (
                    <img src={it.url} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                  )}
                  <span
                    className={
                      'absolute right-2 top-2 flex size-6 items-center justify-center rounded-full border-2 border-white shadow ' +
                      (on ? 'bg-destructive text-white' : 'bg-black/30')
                    }
                  >
                    {on && <Check className="size-4" />}
                  </span>
                </button>
                <div className="space-y-0.5 px-2.5 py-2 text-xs">
                  <div className="truncate font-medium" title={it.task?.cardTitle || ''}>
                    {it.task?.cardTitle || <span className="text-muted-foreground">（無任務紀錄）</span>}
                  </div>
                  <div className="truncate text-muted-foreground">{it.task?.userName || '—'}</div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>{formatDate(it.savedAt)}</span>
                    <span>{formatSize(it.size)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={left <= 7 ? 'text-destructive' : 'text-muted-foreground'}>
                      {left} 天後刪除
                    </span>
                    <a href={it.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      開啟
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {nextOffset !== null && (
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={() => load(nextOffset)} disabled={loading}>
            {loading ? '載入中…' : '載入更多'}
          </Button>
        </div>
      )}
    </div>
  );
}
