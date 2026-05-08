import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { useAuth } from '@/lib/auth-store';
import { initTheme } from '@/lib/theme-store';
import { LoginPanel } from '@/components/LoginPanel';
import { HomePage } from '@/components/HomePage';
import { TaskView } from '@/components/TaskView';
import { TaskHistoryView } from '@/components/TaskHistoryView';
import type { Card, NodeInfo, TaskHistoryResult } from '@/lib/types';

export interface RerunPrefill {
  nodeInput: NodeInfo[];
  prevResults?: TaskHistoryResult[];
  prevCostTime?: number | null;
  prevCreatedAt?: string | null;
}

type Route =
  | { kind: 'home' }
  | { kind: 'task'; card: Card; prefill?: RerunPrefill }
  | { kind: 'history' };

function App() {
  const user = useAuth((s) => s.user);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const hydrate = useAuth((s) => s.hydrate);
  const [route, setRoute] = useState<Route>({ kind: 'home' });

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

  return (
    <>
      {route.kind === 'task' ? (
        <TaskView
          card={route.card}
          prefill={route.prefill}
          onBack={() => setRoute({ kind: 'home' })}
        />
      ) : route.kind === 'history' ? (
        <TaskHistoryView
          onBack={() => setRoute({ kind: 'home' })}
          onRerun={(card, prefill) => setRoute({ kind: 'task', card, prefill })}
        />

      ) : (
        <HomePage
          onSelect={(card) => setRoute({ kind: 'task', card })}
          onOpenHistory={() => setRoute({ kind: 'history' })}
        />
      )}
      <Toaster richColors position="top-right" />
    </>
  );
}

export default App;
