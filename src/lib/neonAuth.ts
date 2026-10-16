import type { AuthError } from '@supabase/supabase-js';

type SessionUser = { id: string; username: string; phone: string; displayName: string; requestedRole: string; user_metadata: Record<string, unknown> };
type AuthResult = { data: { user: SessionUser | null; session: { user: SessionUser } | null }; error: AuthError | null };
type Listener = (event: string, session: { user: SessionUser } | null) => void;

function notify(event: string, session: { user: SessionUser } | null) {
  window.dispatchEvent(new CustomEvent('medar-auth-change', { detail: { event, session } }));
}
async function request<T>(path: string, body?: unknown): Promise<{ data: T | null; error: AuthError | null }> {
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as T & { message?: string; user?: SessionUser } | null;
    if (!response.ok) return { data: null, error: { name: 'AuthError', message: payload?.message || 'درخواست احراز هویت ناموفق بود.', status: response.status } as AuthError };
    return { data: payload, error: null };
  } catch {
    return { data: null, error: { name: 'AuthError', message: 'ارتباط با سرویس احراز هویت برقرار نشد.' } as AuthError };
  }
}
function shapeUser(user: SessionUser | null | undefined) {
  if (!user) return null;
  return { ...user, user_metadata: { ...user.user_metadata, full_name: user.displayName, phone: user.phone, requested_role: user.requestedRole } };
}
type SignupInput = {
  username: string; password: string;
  options?: { data?: Record<string, unknown> };
};
export const isNeonAuthConfigured = true;
/** Compatibility surface for the existing UI; all identity operations use the Medar Worker and username, never email. */
export const neonAuth = {
  async getSession() {
    const result = await request<{ user: SessionUser | null }>('/api/auth/me');
    const user = shapeUser(result.data?.user);
    return { data: { session: user ? { user } : null, user }, error: result.error };
  },
  onAuthStateChange(callback: Listener) {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ event: string; session: { user: SessionUser } | null }>).detail;
      callback(detail.event, detail.session);
    };
    window.addEventListener('medar-auth-change', handler);
    return { data: { subscription: { unsubscribe: () => window.removeEventListener('medar-auth-change', handler) } } };
  },
  async signInWithPassword({ username, password }: { username: string; password: string }): Promise<AuthResult> {
    const result = await request<{ user: SessionUser }>('/api/auth/login', { username: username.trim(), password });
    const user = shapeUser(result.data?.user);
    if (user) notify('SIGNED_IN', { user });
    return { data: { user, session: user ? { user } : null }, error: result.error };
  },
  async signUp(input: SignupInput): Promise<AuthResult> {
    const metadata = input.options?.data ?? {};
    const result = await request<{ user: SessionUser }>('/api/auth/signup', {
      username: input.username.trim(),
      password: input.password,
      phone: metadata.phone,
      displayName: metadata.full_name ?? metadata.displayName,
      organizationName: metadata.organizationName ?? metadata.organization_name,
      requestedRole: metadata.requested_role || 'customer',
    });
    const user = shapeUser(result.data?.user);
    if (user) notify('SIGNED_IN', { user });
    return { data: { user, session: user ? { user } : null }, error: result.error };
  },
  async signOut() {
    const result = await request<{ ok: boolean }>('/api/auth/logout', {});
    notify('SIGNED_OUT', null);
    return { error: result.error };
  },
  async changePassword({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) {
    return request<{ ok: boolean; message: string }>('/api/auth/change-password', { currentPassword, newPassword });
  },
  async resetPasswordForUsername(_username?: string) {
    void _username;
    return { error: { name: 'AuthError', message: 'برای بازیابی رمز عبور، فعلاً باید مالک مجموعه پس از احراز هویت کاربر رمز را بازنشانی کند.' } as AuthError };
  },
};
