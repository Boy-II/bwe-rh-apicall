import { useEffect, useState } from 'react';
import { ArrowLeft, Download, RefreshCw, ImageOff, Clock, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from './ThemeToggle';
import api from '@/lib/api';
import type { Card, TaskHistoryItem, TaskHistoryResult } from '@/lib/types';
import type { RerunPrefill } from '@/App';

interface Props {
  onBack: () => void;
  onRerun: (card: Card, prefill: RerunPrefill) => void;
}

const STATUS_LABEL: Record<string, string> = {
  QUEUED: '排隊中',
  RUNNING: '執行中',
  SUCCESS: '完成',
  FAILED: '失敗',
  TIMEOUT: '逾時',
  CANCELED: '已取消',
};

function statusColor(status: string) {
  if (status === 'SUCCESS') return 'text-emerald-700 bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-400';
  if (status === 'FAILED' || status === 'TIMEOUT') return 'text-rose-700 bg-rose-100 dark:bg-rose-950 dark:text-rose-400';
  if (status === 'CANCELED') return 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300';
  return 'text-yellow-700 bg-yellow-100 dark:bg-yellow-950 dark:text-yellow-400';
}

function isImageUrl(r: TaskHistoryResult) {
  const t = (r.fileType || '').toLowerCase();
  if (/png|jpe?g|webp|gif|image/.test(t)) return true;
  return /\.(png|jpe?g|webp|gif)/i.test(r.url || '');
}

function isVideoUrl(r: TaskHistoryResult) {
  const t = (r.fileType || '').toLowerCase();
  if (/mp4|webm|mov|video/.test(t)) return true;
  return /\.(mp4|webm|mov)/i.test(r.url || '');
}

function formatDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

export function TaskHistoryView({ onBack, onRerun }: Props) {
  const [items, setItems] = useState<TaskHistoryItem[]>([]);
  const [cardsById, setCardsById] = useState<Record<string, Card>>({});
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const [list, cards] = await Promise.all([api.tasks.myHistory(50, 30), api.cards.list()]);
      setItems(list);
      setCardsById(Object.fromEntries(cards.map((c) => [c.id, c])));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const handleRerun = (task: TaskHistoryItem) => {
    if (!task.cardId) {
      toast.error('此任務沒有對應的卡片資訊');
      return;
    }
    const card = cardsById[task.cardId];
    if (!card) {
      toast.error('原卡片已被刪除，無法重跑');
      return;
    }
    onRerun(card, {
      nodeInput: task.nodeInput || [],
      prevResults: task.results || [],
      prevCostTime: task.costTime,
      prevCreatedAt: task.createdAt,
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="size-4" /> 返回
            </Button>
            <h1 className="text-lg font-semibold">📋 我的生成歷史</h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> 重新整理
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-6">
        {loading ? (
          <div className="py-12 text-center text-muted-foreground">載入中…</div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            最近 30 天內沒有任務記錄
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                canRerun={!!task.cardId && !!cardsById[task.cardId]}
                onRerun={() => handleRerun(task)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function TaskRow({
  task,
  canRerun,
  onRerun,
}: {
  task: TaskHistoryItem;
  canRerun: boolean;
  onRerun: () => void;
}) {
  const hasResults = task.results.length > 0;
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{task.cardTitle || '未命名應用'}</span>
          <span className={`rounded px-2 py-0.5 text-xs ${statusColor(task.status)}`}>
            {STATUS_LABEL[task.status] || task.status}
          </span>
          {canRerun && (
            <Button variant="outline" size="sm" onClick={onRerun} title="用相同輸入重跑">
              <RotateCw className="size-3" /> 重跑
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {task.costTime ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" /> {task.costTime.toFixed(1)}s
            </span>
          ) : null}
          {task.consumeCoins ? (
            <span className="text-yellow-600 dark:text-yellow-400">🪙 {task.consumeCoins}</span>
          ) : null}
          {(() => {
            // consumeMoney 通常為 null，真金額在 thirdPartyConsumeMoney
            const money = Math.max(task.consumeMoney || 0, task.thirdPartyConsumeMoney || 0);
            return money > 0 ? <span className="text-primary">${money.toFixed(3)}</span> : null;
          })()}
          <span>{formatDate(task.createdAt)}</span>
        </div>
      </div>

      {task.errorMessage && (
        <div className="mb-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {task.errorMessage}
        </div>
      )}

      {hasResults ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {task.results.map((r, i) => (
            <ResultThumb key={`${task.id}-${i}`} result={r} />
          ))}
        </div>
      ) : task.status === 'SUCCESS' ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ImageOff className="size-4" /> 沒有結果檔案
        </div>
      ) : null}
    </div>
  );
}

function ResultThumb({ result }: { result: TaskHistoryResult }) {
  const url = result.url;
  if (!url) return null;
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {isImageUrl(result) ? (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          <img src={url} alt="result" loading="lazy" className="h-32 w-full object-cover" />
        </a>
      ) : isVideoUrl(result) ? (
        <video src={url} controls className="h-32 w-full object-cover" />
      ) : (
        <div className="flex h-32 items-center justify-center bg-muted text-xs text-muted-foreground">
          檔案
        </div>
      )}
      <a
        href={url}
        download
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-1 border-t border-border bg-muted/50 px-2 py-1.5 text-xs text-primary hover:underline"
      >
        <Download className="size-3" /> 下載
      </a>
    </div>
  );
}
