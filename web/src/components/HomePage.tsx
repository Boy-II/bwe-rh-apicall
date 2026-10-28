import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Settings, Users, History, Compass, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CardGrid } from './CardGrid';
import { CardEditModal } from './CardEditModal';
import { ChatSidebar } from './ChatSidebar';
import { UserManageModal } from './UserManageModal';
import { AiConfigModal } from './AiConfigModal';
import { AppBrowserModal } from './AppBrowserModal';
import { BalancePill } from './BalancePill';
import { ThemeToggle } from './ThemeToggle';
import { useAuth, isAdmin } from '@/lib/auth-store';
import { mergeLastUsed, sortCards, type CardWithUsage } from '@/lib/card-utils';
import api from '@/lib/api';
import { filterModelCards } from '@/lib/model-utils';
import type { Card, Category, ImageMode } from '@/lib/types';

interface Props {
  onSelect: (card: Card) => void;
  onOpenHistory: () => void;
}

export function HomePage({ onSelect, onOpenHistory }: Props) {
  const { user, logout } = useAuth();
  const admin = isAdmin(user);
  const [cards, setCards] = useState<CardWithUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<Card | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [imageMode, setImageMode] = useState<ImageMode>('');

  // 卡片所有 tags 集合（去重）
  const allTags = useMemo(() => {
    const set = new Set<string>();
    cards.forEach((c) => (c.tags || []).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [cards]);

  // 過濾後的清單：title / description / tags 任一命中
  const visibleCards = useMemo(
    () => filterModelCards(cards, category, imageMode, search),
    [cards, category, imageMode, search],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.cards.list();
      // admin 看 sort_order；普通用戶混合 lastUsedAt（最近用過排前面）
      const merged = mergeLastUsed(list);
      setCards(admin ? merged : sortCards(merged));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleDelete = async (c: Card) => {
    if (!confirm(`確定刪除「${c.title}」？`)) return;
    try {
      await api.cards.remove(c.id);
      toast.success('卡片已刪除');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleReorder = async (newOrderIds: string[]) => {
    // 樂觀更新：先在本地重排，後台失敗才復原
    const map = new Map(cards.map((c) => [c.id, c]));
    const reordered = newOrderIds.map((id) => map.get(id)).filter((c): c is CardWithUsage => !!c);
    setCards(reordered);
    try {
      await api.cards.reorder(newOrderIds);
    } catch (e) {
      toast.error((e as Error).message);
      reload();
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-3">
          <h1 className="text-xl font-semibold">
            <span className="text-primary">BWE</span> AI 應用平台
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {admin && <BalancePill />}
            {admin && (
              <>
                <Button variant="outline" size="sm" onClick={() => setBrowserOpen(true)}>
                  <Compass className="size-4" /> 探索
                </Button>
                <Button variant="outline" size="sm" onClick={() => setUsersOpen(true)}>
                  <Users className="size-4" /> 用戶
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAiOpen(true)}>
                  <Settings className="size-4" /> AI
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={onOpenHistory}>
              <History className="size-4" /> 我的歷史
            </Button>
            <ThemeToggle />
            <span className="text-sm text-muted-foreground">
              {user?.name || user?.username}{' '}
              {admin && <span className="text-primary">（管理員）</span>}
            </span>
            <Button variant="ghost" size="sm" onClick={() => logout()}>
              登出
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <nav aria-label="應用分類" className="mb-4 flex flex-wrap gap-2">
          {(
            [
              ['all', '全部'],
              ['image', '圖片'],
              ['video', '影片'],
              ['audio', '音源'],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              variant="outline"
              aria-pressed={category === key}
              className={category === key ? 'border-primary bg-primary/10 text-foreground' : ''}
              size="sm"
              onClick={() => {
                setCategory(key);
                setImageMode('');
              }}
            >
              {label}
            </Button>
          ))}
        </nav>
        {category === 'image' && (
          <nav aria-label="圖片生成方式" className="mb-6 flex gap-2">
            {(
              [
                ['', '全部圖片'],
                ['text-to-image', '文生圖'],
                ['image-to-image', '圖生圖'],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                variant={imageMode === key ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setImageMode(key)}
              >
                {label}
              </Button>
            ))}
          </nav>
        )}
        {!loading && cards.length > 0 && (
          <div className="mb-6 space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋卡片名稱、描述、標籤…"
                className="pl-9 pr-9"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="清除搜尋"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {allTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {allTags.map((t) => {
                  const active = search.toLowerCase() === t.toLowerCase();
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSearch(active ? '' : t)}
                      className={
                        'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ' +
                        (active
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                          : 'border-primary/40 bg-primary/5 text-primary hover:bg-primary/15 hover:border-primary/60')
                      }
                    >
                      #{t}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-center text-muted-foreground py-12">載入中…</div>
        ) : visibleCards.length === 0 && search ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
            沒有符合「{search}」的卡片
          </div>
        ) : (
          <CardGrid
            cards={visibleCards}
            isAdmin={admin}
            disableSort={!!search.trim() || category !== 'all' || !!imageMode}
            onSelect={onSelect}
            onEdit={(c) => {
              setEditTarget(c);
              setEditOpen(true);
            }}
            onDelete={handleDelete}
            onCreate={() => {
              setEditTarget(null);
              setEditOpen(true);
            }}
            onReorder={handleReorder}
          />
        )}
      </main>
      <CardEditModal
        open={editOpen}
        card={editTarget}
        onClose={() => setEditOpen(false)}
        onSaved={reload}
      />
      <UserManageModal open={usersOpen} onClose={() => setUsersOpen(false)} />
      <AiConfigModal open={aiOpen} onClose={() => setAiOpen(false)} />
      <AppBrowserModal
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onCardAdded={reload}
      />
      <ChatSidebar />
    </div>
  );
}
