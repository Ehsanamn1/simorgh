import type * as React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './apiClient';
import type { Membership } from './types';

type UserShape = {
  id: string;
  username: string;
  phone?: string;
  display_name?: string;
  user_metadata?: Record<string, unknown>;
};
type SessionShape = { user: UserShape };
type AuthValue = {
  session: SessionShape | null; user: UserShape | null; memberships: Membership[];
  loading: boolean; membershipsLoading: boolean; error: string | null;
  refreshMemberships: () => Promise<void>; refreshSession: () => Promise<void>; signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionShape | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const result = await api.get<{ user: null | { id: string; username: string; phone: string; displayName: string; requestedRole: string } }>('/api/auth/me');
      if (!result.user) { setSession(null); setMemberships([]); return; }
      const u = result.user;
      setSession({ user: { id: u.id, username: u.username, phone: u.phone, display_name: u.displayName,
        user_metadata: { requested_role: u.requestedRole, full_name: u.displayName, phone: u.phone } } });
      setError(null);
    } catch (caught) {
      setSession(null);
      if (caught instanceof Error && 'status' in caught && (caught as { status?: number }).status !== 401) {
        setError(caught.message);
      }
    } finally { setLoading(false); }
  }, []);

  const refreshMemberships = useCallback(async () => {
    if (!session?.user?.id) { setMemberships([]); setMembershipsLoading(false); return; }
    setMembershipsLoading(true);
    try {
      const data = await api.get<{ memberships: Membership[] }>('/api/workspace/memberships');
      setMemberships(data.memberships ?? []);
      setError(null);
    } catch (caught) {
      setMemberships([]);
      setError(caught instanceof Error ? caught.message : 'خواندن سطح دسترسی ناموفق بود.');
    } finally { setMembershipsLoading(false); }
  }, [session?.user?.id]);

  useEffect(() => { void refreshSession(); }, [refreshSession]);
  useEffect(() => { void refreshMemberships(); }, [refreshMemberships]);

  const value = useMemo<AuthValue>(() => ({
    session, user: session?.user ?? null, memberships, loading, membershipsLoading, error,
    refreshMemberships, refreshSession,
    signOut: async () => {
      try { await api.post('/api/auth/logout', {}); }
      finally { setSession(null); setMemberships([]); setMembershipsLoading(false); }
    },
  }), [session, memberships, loading, membershipsLoading, error, refreshMemberships, refreshSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('AuthProvider missing'); return context; }
