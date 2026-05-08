import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Settings, Users, History, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import type { Card } from '@/lib/types';

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
    const reordered = newOrderIds
      .map((id) => map.get(id))
      .filter((c): c is CardWithUsage => !!c);
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
              {user?.username} {admin && <span className="text-primary">（管理員）</span>}
            </span>
            <Button variant="ghost" size="sm" onClick={() => logout()}>
              登出
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        {loading ? (
          <div className="text-center text-muted-foreground py-12">載入中…</div>
        ) : (
          <CardGrid
            cards={cards}
            isAdmin={admin}
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
