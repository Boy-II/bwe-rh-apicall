import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { PALETTE } from '@/lib/card-utils';
import type { AppListItem, AppSort } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  onCardAdded?: () => void;
}

const SORTS: { value: AppSort; label: string }[] = [
  { value: 'RECOMMEND', label: '推薦' },
  { value: 'HOTTEST', label: '最熱' },
  { value: 'NEWEST', label: '最新' },
];

const PAGE_SIZE = 12;

export function AppBrowserModal({ open, onClose, onCardAdded }: Props) {
  const [sort, setSort] = useState<AppSort>('RECOMMEND');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AppListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const load = async (s: AppSort, p: number) => {
    setLoading(true);
    try {
      const res = await api.adminRh.appList(s, p, PAGE_SIZE);
      setItems(res.items);
      const t = typeof res.total === 'number' ? res.total : parseInt(String(res.total), 10) || 0;
      setTotal(t);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load(sort, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sort, page]);

  useEffect(() => {
    if (!open) return;
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  const addAsCard = async (app: AppListItem) => {
    if (!app.webappId) {
      toast.error('此應用缺少 webappId，無法加入');
      return;
    }
    setAdding(app.webappId);
    try {
      await api.cards.create({
        webappId: app.webappId,
        title: app.title || '未命名應用',
        description: app.description || '',
        coverUrl: app.cover || '',
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      });
      toast.success(`已加入「${app.title}」`);
      onCardAdded?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAdding(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>探索 AI 應用</DialogTitle>
          <DialogDescription>
            從應用市集挑選應用，一鍵加入為平台卡片
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
          <div className="flex gap-1">
            {SORTS.map((s) => (
              <button
                key={s.value}
                onClick={() => setSort(s.value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  sort === s.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={() => load(sort, page)} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          {loading && items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">載入中…</div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">沒有應用</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {items.map((app) => (
                <div
                  key={app.webappId}
                  className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm"
                >
                  {app.cover ? (
                    <img
                      src={app.cover}
                      alt={app.title}
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-muted text-3xl">
                      🎨
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-3">
                    <div className="font-medium text-sm line-clamp-2">{app.title}</div>
                    {app.description && (
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        {app.description}
                      </div>
                    )}
                    <Button
                      size="sm"
                      className="mt-auto w-full"
                      onClick={() => addAsCard(app)}
                      disabled={adding === app.webappId || !app.webappId}
                    >
                      <Plus className="size-3" />
                      {adding === app.webappId ? '加入中…' : '加入為卡片'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            第 {page} / {totalPages} 頁（共 {total} 筆）
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              <ChevronLeft className="size-4" /> 上一頁
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              下一頁 <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
