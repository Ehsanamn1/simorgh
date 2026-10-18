import type * as React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './apiClient';
import { setOfflineCachePartition } from './offlineCache';
import { getMedarClientId, MEDAR_APP_VERSION, MEDAR_CLIENT_PLATFORM } from './runtimeConfig';
import type { Membership } from './types';

export type UserShape = { id: string; username: string; phone: string; full_name: string };
type SessionShape = { user: UserShape };
type SessionResponse = { user: UserShape | null; memberships: Membership[] };
type AuthValue = {
  session: SessionShape | null;
  user: UserShape | null;
  memberships: Membership[];
  loading: boolean;
  membershipsLoading: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
  refreshMemberships: () => Promise<void>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionShape | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<SessionResponse>('/api/auth/me');
      setSession(result.user ? { user: result.user } : null);
      setMemberships(result.user ? (result.memberships ?? []) : []);
      if (result.user) {
        setOfflineCachePartition(result.user.id);
        try { window.sessionStorage.setItem('medar-offline-session-v1', JSON.stringify({ user: result.user, memberships: result.memberships ?? [], savedAt: Date.now() })); } catch { /* Offline support is optional when storage is blocked. */ }
      } else {
        setOfflineCachePartition(null);
        try { window.sessionStorage.removeItem('medar-offline-session-v1'); } catch { /* Ignore unavailable storage. */ }
      }
      setError(null);
    } catch (caught) {
      let restored = false;
      try {
        const raw = window.sessionStorage.getItem('medar-offline-session-v1');
        const cached = raw ? JSON.parse(raw) as { user?: UserShape; memberships?: Membership[]; savedAt?: number } : null;
        if (cached?.user?.id && cached.user.username && Array.isArray(cached.memberships) &&
            typeof cached.savedAt === 'number' && Date.now() - cached.savedAt < 7 * 24 * 60 * 60 * 1000) {
          setSession({ user: cached.user });
          setMemberships(cached.memberships);
          setOfflineCachePartition(cached.user.id);
          setError('حالت آفلاین: آخرین هویت و دسترسی شناخته‌شده بارگذاری شد؛ عملیات جدید تا اتصال مجدد تأیید نمی‌شوند.');
          restored = true;
        }
      } catch { /* No local session is available; require a live server session. */ }
      if (!restored) {
        setSession(null);
        setMemberships([]);
        setOfflineCachePartition(null);
        setError(caught instanceof Error ? caught.message : 'ارتباط با سرویس مدار برقرار نشد.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshMemberships = useCallback(async () => {
    if (!session?.user?.id) {
      setMemberships([]);
      setMembershipsLoading(false);
      return;
    }
    setMembershipsLoading(true);
    try {
      const data = await api.get<{ memberships: Membership[] }>('/api/workspace/memberships');
      setMemberships(data.memberships ?? []);
      setError(null);
    } catch (caught) {
      if (typeof navigator === 'undefined' || navigator.onLine) setMemberships([]);
      setError(caught instanceof Error ? caught.message : 'خواندن سطح دسترسی ناموفق بود.');
    } finally {
      setMembershipsLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  // Every signed-in browser/native client reports a heartbeat to the same tenant API.
  // This is operational visibility only; the server still derives access from memberships.
  const membershipCompanies = useMemo(
    () => [...new Set(memberships.map(membership => membership.company_id).filter(Boolean))],
    [memberships],
  );
  useEffect(() => {
    if (!session?.user?.id || membershipCompanies.length === 0) return;
    let stopped = false;
    const clientId = getMedarClientId();
    const reportPresence = () => {
      if (stopped) return;
      void Promise.all(membershipCompanies.map(companyId =>
        api.post('/api/client/heartbeat', {
          companyId,
          clientId,
          platform: MEDAR_CLIENT_PLATFORM,
          appVersion: MEDAR_APP_VERSION,
        }).catch(() => undefined),
      ));
    };
    reportPresence();
    const interval = window.setInterval(reportPresence, 60_000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [session?.user?.id, membershipCompanies]);

  const value = useMemo<AuthValue>(() => ({
    session,
    user: session?.user ?? null,
    memberships,
    loading,
    membershipsLoading,
    error,
    refreshSession,
    refreshMemberships,
    signOut: async () => {
      try {
        await api.post<{ ok: boolean }>('/api/auth/logout');
      } catch {
        // Clear the local view even if the network is down; the server session expires naturally.
      } finally {
        setSession(null);
        setMemberships([]);
        setMembershipsLoading(false);
        setOfflineCachePartition(null);
        try { window.sessionStorage.removeItem('medar-offline-session-v1'); } catch { /* Ignore unavailable storage. */ }
        setError(null);
      }
    },
  }), [session, memberships, loading, membershipsLoading, error, refreshSession, refreshMemberships]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider missing');
  return context;
}
