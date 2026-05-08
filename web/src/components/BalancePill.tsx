import { useEffect, useState } from 'react';
import { Wallet, Coins, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import type { AccountStatusData } from '@/lib/types';

const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: '¥',
  USD: '$',
};

export function BalancePill() {
  const [data, setData] = useState<AccountStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.adminRh.accountStatus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
        <RefreshCw className="size-3 animate-spin" /> 查詢中
      </div>
    );
  }

  if (error) {
    return (
      <button
        type="button"
        onClick={reload}
        className="rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-destructive hover:bg-destructive/20"
        title={error}
      >
        ⚠️ 餘額查詢失敗（點擊重試）
      </button>
    );
  }

  if (!data) return null;

  const symbol = CURRENCY_SYMBOL[data.currency] || data.currency || '';
  return (
    <button
      type="button"
      onClick={reload}
      className="group flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs hover:border-primary"
      title={`執行中任務：${data.currentTaskCounts}（點擊重新整理）`}
    >
      <Wallet className="size-3 text-primary" />
      <span className="font-medium">
        {symbol}
        {data.remainMoney}
      </span>
      <span className="text-muted-foreground">·</span>
      <Coins className="size-3 text-yellow-500" />
      <span className="font-medium">{data.remainCoins}</span>
      {loading && <RefreshCw className="size-3 animate-spin text-muted-foreground" />}
    </button>
  );
}
