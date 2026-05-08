import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api, { setAdminToken, setUserToken } from './api';
import type { SessionUser } from './types';

interface AuthState {
  user: SessionUser | null;
  userToken: string | null;
  adminToken: string | null;
  isLoading: boolean;
  error: string | null;
  hasHydrated: boolean;

  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<{ message: string }>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  clearError: () => void;
  setHasHydrated: (b: boolean) => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      userToken: null,
      adminToken: null,
      isLoading: false,
      error: null,
      hasHydrated: false,
      setHasHydrated: (b) => set({ hasHydrated: b }),

      login: async (username, password) => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.auth.login(username, password);
          setUserToken(res.token);
          if (res.adminToken) setAdminToken(res.adminToken);
          set({
            user: { username: res.username, isAdmin: !!res.adminToken },
            userToken: res.token,
            adminToken: res.adminToken ?? null,
            isLoading: false,
          });
        } catch (e) {
          set({ error: (e as Error).message, isLoading: false });
          throw e;
        }
      },

      register: async (username, password) => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.auth.register(username, password);
          set({ isLoading: false });
          return res;
        } catch (e) {
          set({ error: (e as Error).message, isLoading: false });
          throw e;
        }
      },

      logout: async () => {
        const { userToken, adminToken } = get();
        try {
          if (userToken) await api.auth.logout().catch(() => null);
          if (adminToken) await api.auth.adminLogout().catch(() => null);
        } finally {
          setUserToken(null);
          setAdminToken(null);
          set({ user: null, userToken: null, adminToken: null });
        }
      },

      hydrate: async () => {
        const { userToken, adminToken, user } = get();
        if (userToken) setUserToken(userToken);
        if (adminToken) setAdminToken(adminToken);
        if (!userToken) return;

        try {
          const verify = await api.auth.verify();
          if (!verify.valid) throw new Error('invalid');

          let stillAdmin = !!adminToken;
          if (adminToken) {
            try {
              const av = await api.auth.adminVerify();
              stillAdmin = av.valid;
              if (!av.valid) {
                setAdminToken(null);
                set({ adminToken: null });
              }
            } catch {
              stillAdmin = false;
              setAdminToken(null);
              set({ adminToken: null });
            }
          }

          set({
            user: { username: verify.username || user?.username || '', isAdmin: stillAdmin },
          });
        } catch {
          setUserToken(null);
          setAdminToken(null);
          set({ user: null, userToken: null, adminToken: null });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'rhapi-auth',
      partialize: (s) => ({
        userToken: s.userToken,
        adminToken: s.adminToken,
        user: s.user,
      }),
      onRehydrateStorage: () => (state) => {
        // 確保 rehydration 完成時，api 客戶端模組變數也同步拿到 token
        if (state) {
          if (state.userToken) setUserToken(state.userToken);
          if (state.adminToken) setAdminToken(state.adminToken);
          state.setHasHydrated(true);
        }
      },
    },
  ),
);

export function isAdmin(user: SessionUser | null) {
  return !!user?.isAdmin;
}
