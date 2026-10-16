import { neon } from '@neondatabase/serverless';

type Env = { DATABASE_URL?: string; MEDAR_SESSION_DAYS?: string };
type PagesContext = { request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void };
type AuthUser = { id: string; username: string; phone_e164: string; display_name: string; requested_role: string; account_status: string };
const COOKIE = 'medar_session';
const ITERATIONS = 600_000;
const encoder = new TextEncoder();

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  const result = new Headers(headers);
  result.set('content-type', 'application/json; charset=utf-8');
  result.set('cache-control', 'no-store');
  result.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(data), { status, headers: result });
}
function base64url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function fromBase64url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64url(value);
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function passwordHash(password: string, salt = randomToken(16)) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64url(salt), iterations: ITERATIONS }, key, 256);
  return `pbkdf2$${ITERATIONS}$${salt}$${base64url(new Uint8Array(bits))}`;
}
async function verifyPassword(password: string, stored: string) {
  const [algorithm, rounds, salt, expected] = stored.split('$');
  if (algorithm !== 'pbkdf2' || !Number.isInteger(Number(rounds)) || Number(rounds) < 100_000 || Number(rounds) > 1_000_000 || !salt || !expected) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64url(salt), iterations: Number(rounds) }, key, 256);
  const actual = new Uint8Array(bits);
  const wanted = fromBase64url(expected);
  if (actual.length !== wanted.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ wanted[i];
  return difference === 0;
}
function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.trim().replaceAll(' ', '').replaceAll('-', '').replaceAll('(', '').replaceAll(')', '').replace(/[۰-۹]/g, char => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char))).replace(/[٠-٩]/g, char => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)));
  if (/^09\d{9}$/.test(digits)) return '+98' + digits.slice(1);
  if (/^9\d{9}$/.test(digits)) return '+98' + digits;
  if (/^\+989\d{9}$/.test(digits)) return digits;
  return null;
}
function cookie(token: string, request: Request, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
function clearCookie(request: Request) { return cookie('', request, 0); }
function cookieToken(request: Request) {
  const entry = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='));
  return entry ? decodeURIComponent(entry.slice(COOKIE.length + 1)) : null;
}
function originAllowed(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}
async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) return null;
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
function userSafe(user: AuthUser) {
  return { id: user.id, username: user.username, phone: user.phone_e164, displayName: user.display_name, requestedRole: user.requested_role };
}
function sqlFor(env: Env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(env.DATABASE_URL);
}
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('DATABASE_URL is not configured')) return json({ message: 'سرویس پایگاه داده هنوز پیکربندی نشده است.' }, 503);
  return json({ message: 'درخواست انجام نشد. تنظیمات سرویس و پایگاه داده را بررسی کنید.' }, 500);
}
async function createSession(sql: ReturnType<typeof neon>, user: AuthUser, request: Request, env: Env) {
  const token = randomToken();
  const days = Math.min(30, Math.max(1, Number(env.MEDAR_SESSION_DAYS || 14)));
  const maxAge = days * 24 * 60 * 60;
  const tokenHash = await sha256(token);
  const agent = (request.headers.get('user-agent') || '').slice(0, 300);
  await sql`INSERT INTO public.medar_sessions (user_id, token_hash, expires_at, user_agent)
    VALUES (${user.id}::uuid, ${tokenHash}, now() + (${days}::int * interval '1 day'), ${agent})`;
  await sql`UPDATE public.medar_users SET last_login_at = now(), updated_at = now() WHERE id = ${user.id}::uuid`;
  return { token, maxAge };
}
async function currentUser(sql: ReturnType<typeof neon>, request: Request) {
  const token = cookieToken(request);
  if (!token || token.length > 200) return null;
  const tokenHash = await sha256(token);
  const rows = await sql`SELECT u.id, u.username, u.phone_e164, u.display_name, u.requested_role, u.account_status
    FROM public.medar_sessions s JOIN public.medar_users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.revoked_at IS NULL AND s.expires_at > now() AND u.account_status = 'active'
    LIMIT 1`;
  return rows[0] as AuthUser | undefined || null;
}

export async function onRequest(context: PagesContext) {
  const { request, env } = context;
  if (request.method !== 'GET' && !originAllowed(request)) return json({ message: 'درخواست از مبدأ نامعتبر رد شد.' }, 403);
  const path = new URL(request.url).pathname.replace(/\/+$/, '').split('/').pop() || '';
  let sql: ReturnType<typeof neon>;
  try { sql = sqlFor(env); } catch (error) { return failure(error); }

  try {
    if (request.method === 'POST' && path === 'signup') {
      const data = await body(request);
      if (!data) return json({ message: 'بدنه درخواست معتبر نیست.' }, 400);
      const username = typeof data.username === 'string' ? data.username.trim() : '';
      const normalized = username.toLowerCase();
      const displayName = typeof data.displayName === 'string' && data.displayName.trim() ? data.displayName.trim() : username;
      const phone = normalizePhone(data.phone);
      const password = typeof data.password === 'string' ? data.password : '';
      const role = typeof data.requestedRole === 'string' ? data.requestedRole : 'customer';
      if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return json({ message: 'نام کاربری باید ۳ تا ۳۲ نویسه و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.' }, 400);
      if (!phone) return json({ message: 'شماره موبایل ایران معتبر نیست.' }, 400);
      if (displayName.length < 2 || displayName.length > 120) return json({ message: 'نام نمایشی باید بین ۲ تا ۱۲۰ نویسه باشد.' }, 400);
      if (password.length < 10 || password.length > 128) return json({ message: 'رمز عبور باید حداقل ۱۰ نویسه داشته باشد.' }, 400);
      if (!['customer','supplier','driver','staff'].includes(role)) return json({ message: 'نقش انتخابی معتبر نیست.' }, 400);
      const existing = await sql`SELECT id FROM public.medar_users WHERE username_normalized = ${normalized} OR phone_e164 = ${phone} LIMIT 1`;
      if (existing.length) return json({ message: 'این نام کاربری یا شماره موبایل قبلاً ثبت شده است.' }, 409);
      const hash = await passwordHash(password);
      const inserted = await sql`INSERT INTO public.medar_users (username, phone_e164, display_name, password_hash, requested_role)
        VALUES (${username}, ${phone}, ${displayName}, ${hash}, ${role})
        RETURNING id, username, phone_e164, display_name, requested_role, account_status`;
      const user = inserted[0] as AuthUser;
      await sql`INSERT INTO public.medar_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
        VALUES (${user.id}::uuid, 'auth.signup', 'user', ${user.id}, jsonb_build_object('requested_role', ${role}))`;
      const session = await createSession(sql, user, request, env);
      return json({ user: userSafe(user) }, 201, { 'set-cookie': cookie(session.token, request, session.maxAge) });
    }

    if (request.method === 'POST' && path === 'login') {
      const data = await body(request);
      if (!data) return json({ message: 'بدنه درخواست معتبر نیست.' }, 400);
      const username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
      const password = typeof data.password === 'string' ? data.password : '';
      if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username) || !password || password.length > 128) return json({ message: 'نام کاربری یا رمز عبور نادرست است.' }, 401);
      const attempts = await sql`SELECT count(*)::int AS count FROM public.medar_login_attempts WHERE username_normalized = ${username} AND succeeded = false AND attempted_at > now() - interval '15 minutes'`;
      if (Number((attempts[0] as {count:number}).count) >= 10) return json({ message: 'تلاش‌های ورود بیش از حد است. ۱۵ دقیقه دیگر دوباره تلاش کنید.' }, 429);
      const rows = await sql`SELECT id, username, phone_e164, display_name, requested_role, account_status, password_hash
        FROM public.medar_users WHERE username_normalized = ${username} LIMIT 1`;
      const found = rows[0] as (AuthUser & { password_hash: string }) | undefined;
      const valid = Boolean(found && found.account_status === 'active' && await verifyPassword(password, found.password_hash));
      await sql`INSERT INTO public.medar_login_attempts (username_normalized, succeeded) VALUES (${username}, ${valid})`;
      if (!valid || !found) return json({ message: 'نام کاربری یا رمز عبور نادرست است.' }, 401);
      const user: AuthUser = { id: found.id, username: found.username, phone_e164: found.phone_e164, display_name: found.display_name, requested_role: found.requested_role, account_status: found.account_status };
      const session = await createSession(sql, user, request, env);
      await sql`INSERT INTO public.medar_audit_log (actor_user_id, action, entity_type, entity_id) VALUES (${user.id}::uuid, 'auth.login', 'user', ${user.id})`;
      return json({ user: userSafe(user) }, 200, { 'set-cookie': cookie(session.token, request, session.maxAge) });
    }

    if (request.method === 'GET' && path === 'me') {
      const user = await currentUser(sql, request);
      return user ? json({ user: userSafe(user) }) : json({ user: null }, 401);
    }

    if (request.method === 'POST' && path === 'logout') {
      const token = cookieToken(request);
      if (token) await sql`UPDATE public.medar_sessions SET revoked_at = now() WHERE token_hash = ${await sha256(token)} AND revoked_at IS NULL`;
      return json({ ok: true }, 200, { 'set-cookie': clearCookie(request) });
    }

    return json({ message: 'مسیر احراز هویت پیدا نشد.' }, 404);
  } catch (error) {
    return failure(error);
  }
}
