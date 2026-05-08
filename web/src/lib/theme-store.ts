import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const STORAGE_KEY = 'rhapi-theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'system') return systemPrefersDark();
  return mode === 'dark';
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const dark = resolveDark(mode);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'system',
      setMode: (mode) => {
        applyTheme(mode);
        set({ mode });
      },
      toggle: () => {
        const current = get().mode;
        // light → dark → system → light …
        const next: ThemeMode =
          current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
        applyTheme(next);
        set({ mode: next });
      },
    }),
    {
      name: STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.mode);
      },
    },
  ),
);

/** Call once at app boot to apply theme + listen to system changes when in 'system' mode. */
export function initTheme() {
  applyTheme(useTheme.getState().mode);

  if (typeof window === 'undefined' || !window.matchMedia) return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = () => {
    if (useTheme.getState().mode === 'system') applyTheme('system');
  };
  mq.addEventListener?.('change', listener);
}
