import type * as React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { neonAuth } from './neonAuth';
import { api } from './apiClient';
import type { Membership } from './types';

type UserShape = { id: string; email?: string; user_metadata?: Record<string, string | undefined> };
type SessionShape = { user: UserShape };
type AuthValue = { session: SessionShape | null; user: UserShape | null; memberships: Membership[]; loading: boolean; membershipsLoading: boolean; error: string | null; refreshMemberships: () => Promise<void>; signOut: () => Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionShape | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    let alive = true;
    if (!neonAuth) { setLoading(false); return () => { alive = false; }; }
    void neonAuth.getSession().then((result) => {
      if (!alive) return;
      const data = result?.data as { session?: SessionShape; user?: UserShape } | null;
      setSession(data?.session ?? (data?.user ? { user: data.user } : null));
      setLoading(false);
    }).catch((caught: unknown) => {
      if (!alive) return;
      setError(caught instanceof Error ? caught.message : 'خواندن نشست کاربری ناموفق بود.');
      setLoading(false);
    });
    const listener = neonAuth.onAuthStateChange?.((_event: string, nextSession: unknown) => {
      if (!alive) return;
      setSession(nextSession as SessionShape | null);
      setLoading(false);
      if (!nextSession) { setMemberships([]); setError(null); }
    });
    return () => { alive = false; listener?.data?.subscription?.unsubscribe?.(); };
  }, []);

  useEffect(() => { void refreshMemberships(); }, [refreshMemberships]);

  const value = useMemo<AuthValue>(() => ({
    session, user: session?.user ?? null, memberships, loading, membershipsLoading, error, refreshMemberships,
    signOut: async () => { if (neonAuth) await neonAuth.signOut(); setSession(null); setMemberships([]); setMembershipsLoading(false); },
  }), [session, memberships, loading, membershipsLoading, error, refreshMemberships]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('AuthProvider missing'); return context; }
