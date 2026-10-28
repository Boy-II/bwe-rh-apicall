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
import type { UserSummary, UserUsage, AccessSettings } from '@/lib/types';
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
  const [access, setAccess] = useState<AccessSettings>({
    divisions: [],
    allowedDivisions: [],
    lastSync: null,
  });
  const [savingAccess, setSavingAccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [list, accessSettings] = await Promise.all([api.users.list(), api.users.access()]);
      setAccess(accessSettings);
      setUsers(list);
      setUsage({});
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
    if (
      !confirm(
        u.authSource === 'bwhr'
          ? `確定停用「${u.username}」？同步後也會保留此拒絕設定。`
          : `確定刪除用戶「${u.username}」？`,
      )
    )
      return;
    try {
      await api.users.remove(u.id);
      toast.success(u.authSource === 'bwhr' ? '已停用' : '已刪除');
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
            BWHR 員工資料同步後，依開放區處授權；個別拒絕仍可阻擋登入。
          </DialogDescription>
        </DialogHeader>
        <section className="space-y-3 rounded-md border p-4">
          <h3 className="text-sm font-semibold">開放區處</h3>
          <p className="text-xs text-muted-foreground">
            預設健康事業處；全部取消表示不開放一般員工。最後同步：
            {access.lastSync ? new Date(access.lastSync).toLocaleString() : '尚未匯入 BWHR 資料'}
          </p>
          <div className="flex flex-wrap gap-3">
            {Array.from(new Set([...access.divisions, ...access.allowedDivisions])).map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={access.allowedDivisions.includes(d)}
                  onChange={(e) =>
                    setAccess((a) => ({
                      ...a,
                      allowedDivisions: e.target.checked
                        ? [...a.allowedDivisions, d]
                        : a.allowedDivisions.filter((x) => x !== d),
                    }))
                  }
                />
                {d}
              </label>
            ))}
          </div>
          <Button
            size="sm"
            disabled={loading || savingAccess}
            onClick={async () => {
              setSavingAccess(true);
              try {
                await api.users.saveAccess(access.allowedDivisions);
                toast.success('開放區處已更新，既有登入也會套用');
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSavingAccess(false);
              }
            }}
          >
            儲存開放區處
          </Button>
        </section>
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
                      <td className="px-2 py-2">
                        <div className="font-medium">
                          {u.name || u.username}{' '}
                          <span className="text-xs text-muted-foreground">
                            {u.name && u.username}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                        <div className="text-xs text-muted-foreground">
                          {[u.division, u.department, u.unit].filter(Boolean).join(' / ')}
                        </div>
                        {u.authSource === 'bwhr' && u.sourceStatus !== 'ACTIVE' && (
                          <span className="text-xs text-destructive">BWHR 已停用</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <span className={cn('rounded px-2 py-0.5 text-xs', STATUS_COLOR[u.status])}>
                          {STATUS_LABEL[u.status]}
                        </span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-xs">
                        {u.status !== 'approved' ? (
                          <span className="text-muted-foreground">—</span>
                        ) : !stats ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              try {
                                const stats = await api.tasks.userUsage(u.id);
                                setUsage((prev) => ({ ...prev, [u.id]: stats }));
                              } catch (e) {
                                toast.error((e as Error).message);
                              }
                            }}
                          >
                            查看
                          </Button>
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
                            aria-label={u.authSource === 'bwhr' ? '停用' : '刪除'}
                            title={u.authSource === 'bwhr' ? '停用' : '刪除'}
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
