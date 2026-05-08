import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, X, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import api from '@/lib/api';
import type { UserSummary, UserUsage } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUS_LABEL: Record<UserSummary['status'], string> = {
  pending: '待審核',
  approved: '已核准',
  rejected: '已拒絕',
};

function currencySymbol(code: string): string {
  return { USD: '$', CNY: '¥', TWD: 'NT$' }[code] || code;
}

function UsageInline({ stats }: { stats: UserUsage }) {
  // consumeMoney 實務上都是 null，真金額在 thirdPartyConsumeMoney；保險取兩者較大
  const money = Math.max(stats.monthMoney || 0, stats.monthThirdPartyMoney || 0);
  const sym = currencySymbol(stats.costCurrency);
  return (
    <span>
      <span className="font-medium">{stats.monthTotal}</span>
      <span className="text-muted-foreground"> 次</span>
      {stats.monthCostTime > 0 && (
        <>
          <span className="text-muted-foreground"> · </span>
          <span className="font-medium">{stats.monthCostTime.toFixed(1)}</span>
          <span className="text-muted-foreground">s</span>
        </>
      )}
      {stats.monthCoins > 0 && (
        <>
          <span className="text-muted-foreground"> · </span>
          <span className="font-medium text-yellow-600 dark:text-yellow-400">
            🪙 {stats.monthCoins}
          </span>
        </>
      )}
      {money > 0 && (
        <>
          <span className="text-muted-foreground"> · </span>
          <span className="font-medium text-primary">
            {sym}
            {money.toFixed(3)}
          </span>
        </>
      )}
      {stats.monthFailed > 0 && (
        <span className="ml-1 text-rose-500">（失敗 {stats.monthFailed}）</span>
      )}
    </span>
  );
}

const STATUS_COLOR: Record<UserSummary['status'], string> = {
  pending: 'text-yellow-600 bg-yellow-100 dark:bg-yellow-950 dark:text-yellow-400',
  approved: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'text-rose-700 bg-rose-100 dark:bg-rose-950 dark:text-rose-400',
};

export function UserManageModal({ open, onClose }: Props) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [usage, setUsage] = useState<Record<string, UserUsage>>({});
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const list = await api.users.list();
      setUsers(list);
      // 並發抓所有 approved 用戶的本月用量
      const approved = list.filter((u) => u.status === 'approved');
      const results = await Promise.allSettled(
        approved.map(async (u) => [u.id, await api.tasks.userUsage(u.id)] as const),
      );
      const next: Record<string, UserUsage> = {};
      for (const r of results) {
        if (r.status === 'fulfilled') next[r.value[0]] = r.value[1];
      }
      setUsage(next);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) reload();
  }, [open]);

  const approve = async (u: UserSummary) => {
    try {
      await api.users.approve(u.id);
      toast.success(`已核准 ${u.username}`);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const reject = async (u: UserSummary) => {
    try {
      await api.users.reject(u.id);
      toast.success(`已拒絕 ${u.username}`);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (u: UserSummary) => {
    if (!confirm(`確定刪除用戶「${u.username}」？`)) return;
    try {
      await api.users.remove(u.id);
      toast.success('已刪除');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const updateNote = async (u: UserSummary, note: string) => {
    if (note === u.note) return;
    try {
      await api.users.updateNote(u.id, note);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, note } : x)));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>用戶管理</DialogTitle>
          <DialogDescription>
            核准 / 拒絕 / 刪除用戶，加備註方便辨識；本月用量為任務次數與累計時長
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="py-8 text-center text-muted-foreground">載入中…</div>
        ) : users.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">目前沒有用戶</div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">帳號</th>
                  <th className="px-2 py-2 text-left font-medium">狀態</th>
                  <th className="px-2 py-2 text-left font-medium">本月用量</th>
                  <th className="px-2 py-2 text-left font-medium">備註</th>
                  <th className="px-2 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => {
                  const stats = usage[u.id];
                  return (
                  <tr key={u.id}>
                    <td className="px-2 py-2 font-medium">{u.username}</td>
                    <td className="px-2 py-2">
                      <span className={cn('rounded px-2 py-0.5 text-xs', STATUS_COLOR[u.status])}>
                        {STATUS_LABEL[u.status]}
                      </span>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-xs">
                      {u.status !== 'approved' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : !stats ? (
                        <span className="text-muted-foreground">…</span>
                      ) : (
                        <UsageInline stats={stats} />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <NoteCell user={u} onSave={updateNote} />
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex justify-end gap-1">
                        {u.status !== 'approved' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-emerald-600 hover:text-emerald-700"
                            onClick={() => approve(u)}
                            aria-label="核准"
                            title="核准"
                          >
                            <Check className="size-4" />
                          </Button>
                        )}
                        {u.status !== 'rejected' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            onClick={() => reject(u)}
                            aria-label="拒絕"
                            title="拒絕"
                          >
                            <X className="size-4" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => remove(u)}
                          aria-label="刪除"
                          title="刪除"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoteCell({
  user,
  onSave,
}: {
  user: UserSummary;
  onSave: (u: UserSummary, note: string) => Promise<void>;
}) {
  const [value, setValue] = useState(user.note || '');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(user.note || '');
  }, [user.note]);

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={async () => {
        if (value === user.note) return;
        await onSave(user, value);
        setSaved(true);
        setTimeout(() => setSaved(false), 800);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          setValue(user.note || '');
          (e.target as HTMLInputElement).blur();
        }
      }}
      placeholder="加備註…"
      className={cn('h-8 text-sm', saved && 'border-primary')}
      maxLength={500}
    />
  );
}
