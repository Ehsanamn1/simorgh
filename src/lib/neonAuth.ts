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

export const isNeonAuthConfigured = true;
/** Compatibility surface for the existing UI; identity is served by the Medar Pages API, not Neon Auth. */
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
  async signInWithPassword({ email, password }: { email: string; password: string }): Promise<AuthResult> {
    const result = await request<{ user: SessionUser }>('/api/auth/login', { username: email.trim(), password });
    const user = shapeUser(result.data?.user);
    if (user) notify('SIGNED_IN', { user });
    return { data: { user, session: user ? { user } : null }, error: result.error };
  },
  async signUp(input: { email: string; password: string; options?: { data?: Record<string, unknown>; emailRedirectTo?: string } }): Promise<AuthResult> {
    const metadata = input.options?.data ?? {};
    const result = await request<{ user: SessionUser }>('/api/auth/signup', {
      username: input.email.trim(),
      password: input.password,
      phone: metadata.phone,
      displayName: metadata.full_name,
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
  async resetPasswordForEmail(_username?: string, _options?: { redirectTo?: string }) {
    return { error: { name: 'AuthError', message: 'بازیابی رمز عبور در نسخه بدون ایمیل فعال نیست.' } as AuthError };
  },
  async updateUser(_data?: { password?: string }) {
    return { error: { name: 'AuthError', message: 'تغییر رمز عبور در این نسخه هنوز پیاده‌سازی نشده است.' } as AuthError };
  },
};
