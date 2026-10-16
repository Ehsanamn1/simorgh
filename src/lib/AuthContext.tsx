import type * as React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { Membership } from './types';
import { supabase } from './supabase';

type AuthValue = {
  session: Session | null; user: User | null; memberships: Membership[]; loading: boolean; membershipsLoading: boolean; error: string | null;
  refreshMemberships: () => Promise<void>; signOut: () => Promise<void>;
};
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [membershipsLoading, setMembershipsLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);
  const refreshMemberships = useCallback(async () => {
    if (!supabase || !session?.user) {
      setMemberships([]);
      setMembershipsLoading(false);
      return;
    }
    setMembershipsLoading(true);
    try {
      const { data, error: queryError } = await supabase.from('memberships')
        .select('id,company_id,user_id,role,customer_id,supplier_id,active,companies(name)')
        .eq('user_id', session.user.id).eq('active', true);
      if (queryError) {
        setError(queryError.message);
        setMemberships([]);
        return;
      }
      setError(null);
      setMemberships((data ?? []).map((m: any) => ({ ...m, company: Array.isArray(m.companies) ? m.companies[0] : m.companies })) as Membership[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'خواندن سطح دسترسی ناموفق بود.');
      setMemberships([]);
    } finally {
      setMembershipsLoading(false);
    }
  }, [session?.user?.id]);
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) { setSession(data.session); setLoading(false); setMembershipsLoading(Boolean(data.session)); } });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!alive) return;
      setSession(newSession); setLoading(false); setMembershipsLoading(Boolean(newSession));
    });
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);
  useEffect(() => { void refreshMemberships(); }, [refreshMemberships, session?.user?.id]);
  const value = useMemo<AuthValue>(() => ({ session, user: session?.user ?? null, memberships, loading, membershipsLoading, error, refreshMemberships, signOut: async () => { if (supabase) await supabase.auth.signOut(); setMemberships([]); } }), [session, memberships, loading, membershipsLoading, error, refreshMemberships]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('AuthProvider missing'); return context; }
