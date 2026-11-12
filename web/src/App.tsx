import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { useAuth } from '@/lib/auth-store';
import { initTheme } from '@/lib/theme-store';
import { LoginPanel } from '@/components/LoginPanel';
import { AppsPage } from '@/components/HomePage';
import { TaskView } from '@/components/TaskView';
import { TaskHistoryView } from '@/components/TaskHistoryView';
import { AppShell, type NavKey } from '@/components/layout/AppShell';
import { GalleryPage } from '@/components/gallery/GalleryPage';
import { GeneratePage } from '@/components/generate/GeneratePage';
import type { Card, NodeInfo, TaskHistoryResult } from '@/lib/types';

export interface RerunPrefill {
  nodeInput: NodeInfo[];
  prevResults?: TaskHistoryResult[];
  prevCostTime?: number | null;
  prevCreatedAt?: string | null;
}

export interface GeneratePrefill {
  modelKey: string;
  nodeInput: NodeInfo[];
}

export type Route =
  | { kind: 'gallery' }
  | { kind: 'favorites' }
  | { kind: 'generate'; templateId?: string; prefill?: GeneratePrefill; nonce?: number }
  | { kind: 'apps' }
  | { kind: 'task'; card: Card; prefill?: RerunPrefill }
  | { kind: 'history' };

function App() {
  const user = useAuth((s) => s.user);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const hydrate = useAuth((s) => s.hydrate);
  const [route, setRoute] = useState<Route>({ kind: 'gallery' });
  const [modelsOpen, setModelsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  useEffect(() => {
    initTheme();
  }, []);

  useEffect(() => {
    if (hasHydrated) hydrate();
  }, [hasHydrated, hydrate]);

  // rehydration 還沒完成（讀 localStorage 中），先 hold 避免閃 LoginPanel
  if (!hasHydrated) {
    return <div className="min-h-screen bg-background" />;
  }

  if (!user) {
    return (
      <>
        <LoginPanel />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  // AI 應用的工作流頁維持原本的全版面
  if (route.kind === 'task') {
    return (
      <>
        <TaskView card={route.card} prefill={route.prefill} onBack={() => setRoute({ kind: 'apps' })} />
        <Toaster richColors position="top-right" />
      </>
    );
  }

  const navigate = (key: NavKey) =>
    setRoute(key === 'generate' ? { kind: 'generate', nonce: Date.now() } : { kind: key });

  return (
    <>
      <AppShell
        active={route.kind}
        onNavigate={navigate}
        onOpenModels={() => setModelsOpen(true)}
        onOpenCategories={() => setCategoriesOpen(true)}
      >
        {route.kind === 'gallery' || route.kind === 'favorites' ? (
          <GalleryPage
            key={route.kind}
            favoritesOnly={route.kind === 'favorites'}
            onUse={(templateId) => setRoute({ kind: 'generate', templateId, nonce: Date.now() })}
          />
        ) : route.kind === 'generate' ? (
          <GeneratePage key={route.nonce} templateId={route.templateId} prefill={route.prefill} />
        ) : route.kind === 'apps' ? (
          <AppsPage onSelect={(card) => setRoute({ kind: 'task', card })} />
        ) : route.kind === 'history' ? (
          <TaskHistoryView
            onBack={() => setRoute({ kind: 'gallery' })}
            onRerun={(card, prefill) => setRoute({ kind: 'task', card, prefill })}
            onRerunModel={(prefill) => setRoute({ kind: 'generate', prefill, nonce: Date.now() })}
          />
        ) : null}
      </AppShell>
      {/* modelsOpen / categoriesOpen：Task 15 接上管理介面 */}
      {modelsOpen && categoriesOpen && null}
      <Toaster richColors position="top-right" />
    </>
  );
}

export default App;
