import type * as React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './apiClient';
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
      setError(null);
    } catch (caught) {
      setSession(null);
      setMemberships([]);
      setError(caught instanceof Error ? caught.message : 'ارتباط با سرویس مدار برقرار نشد.');
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
      setMemberships([]);
      setError(caught instanceof Error ? caught.message : 'خواندن سطح دسترسی ناموفق بود.');
    } finally {
      setMembershipsLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

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
