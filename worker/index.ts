import { neon } from '@neondatabase/serverless';
import { Hono } from 'hono';

type Bindings = { DATABASE_URL?: string; MEDAR_SESSION_DAYS?: string; ASSETS?: { fetch(request: Request): Promise<Response> } };
type AuthUser = { id: string; username: string; phone_e164: string; display_name: string; requested_role: string; account_status: string };
type App = { Bindings: Bindings };
const app = new Hono<App>();
const COOKIE = 'medar_session';
const ITERATIONS = 210_000;
const encoder = new TextEncoder();

function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.trim().replace(/[\s()\-]/g, '').replace(/[۰-۹]/g, char => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char))).replace(/[٠-٩]/g, char => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)));
  if (/^09\d{9}$/.test(digits)) return '+98' + digits.slice(1);
  if (/^9\d{9}$/.test(digits)) return '+98' + digits;
  if (/^\+989\d{9}$/.test(digits)) return digits;
  return null;
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
async function passwordHash(password: string) {
  const salt = randomToken(16);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64url(salt), iterations: ITERATIONS }, key, 256);
  return `pbkdf2$${ITERATIONS}$${salt}$${base64url(new Uint8Array(bits))}`;
}
async function verifyPassword(password: string, stored: string) {
  const [algorithm, rounds, salt, expected] = stored.split('$');
  if (algorithm !== 'pbkdf2' || !Number.isInteger(Number(rounds)) || Number(rounds) < 100_000 || !salt || !expected) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64url(salt), iterations: Number(rounds) }, key, 256);
  const actual = new Uint8Array(bits);
  const wanted = fromBase64url(expected);
  if (actual.length !== wanted.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ wanted[i];
  return difference === 0;
}
function jsonError(c: any, message: string, status: number) {
  return c.json({ message }, status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
}
function cookie(token: string, request: Request, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
function getCookie(request: Request) {
  const entry = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='));
  return entry ? decodeURIComponent(entry.slice(COOKIE.length + 1)) : null;
}
function originAllowed(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}
function safeUser(user: AuthUser) {
  return { id: user.id, username: user.username, phone: user.phone_e164, displayName: user.display_name, requestedRole: user.requested_role };
}
function sqlFor(c: any) {
  if (!c.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(c.env.DATABASE_URL);
}
async function currentUser(c: any): Promise<AuthUser | null> {
  const token = getCookie(c.req.raw);
  if (!token || token.length > 200) return null;
  const sql = sqlFor(c);
  const hash = await sha256(token);
  const rows = await sql`SELECT u.id,u.username,u.phone_e164,u.display_name,u.requested_role,u.account_status
    FROM public.medar_sessions s JOIN public.medar_users u ON u.id=s.user_id
    WHERE s.token_hash=${hash} AND s.revoked_at IS NULL AND s.expires_at>now() AND u.account_status='active' LIMIT 1`;
  return rows[0] as AuthUser | undefined || null;
}
async function makeSession(c: any, user: AuthUser) {
  const token = randomToken();
  const days = Math.min(30, Math.max(1, Number(c.env.MEDAR_SESSION_DAYS || 14)));
  const hash = await sha256(token);
  await sqlFor(c)`INSERT INTO public.medar_sessions(user_id,token_hash,expires_at,user_agent)
    VALUES(${user.id}::uuid,${hash},now()+(${days}::int * interval '1 day'),${(c.req.header('user-agent') || '').slice(0,300)})`;
  await sqlFor(c)`UPDATE public.medar_users SET last_login_at=now(),updated_at=now() WHERE id=${user.id}::uuid`;
  c.header('Set-Cookie', cookie(token, c.req.raw, days * 86400));
}
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  if (c.req.method !== 'GET' && !originAllowed(c.req.raw)) return c.json({ message: 'درخواست از مبدأ نامعتبر رد شد.' }, 403);
  await next();
});
app.get('/api/health', c => c.json({ ok: true, service: 'medar-api', database: Boolean(c.env.DATABASE_URL), auth: 'username-password' }));

app.post('/api/auth/signup', async c => {
  if (!c.env.DATABASE_URL) return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503);
  let data: Record<string, unknown>;
  try { data = await c.req.json(); } catch { return jsonError(c, 'بدنه درخواست معتبر نیست.', 400); }
  const username = typeof data.username === 'string' ? data.username.trim() : '';
  const normalized = username.toLowerCase();
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  const phone = normalizePhone(data.phone);
  const password = typeof data.password === 'string' ? data.password : '';
  const role = typeof data.requestedRole === 'string' ? data.requestedRole : 'customer';
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return jsonError(c, 'نام کاربری باید ۳ تا ۳۲ نویسه و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.', 400);
  if (!phone) return jsonError(c, 'شماره موبایل ایران معتبر نیست.', 400);
  if (displayName.length < 2 || displayName.length > 120) return jsonError(c, 'نام نمایشی باید بین ۲ تا ۱۲۰ نویسه باشد.', 400);
  if (password.length < 10 || password.length > 128) return jsonError(c, 'رمز عبور باید حداقل ۱۰ نویسه داشته باشد.', 400);
  if (!['customer','supplier','driver','staff'].includes(role)) return jsonError(c, 'نقش انتخابی معتبر نیست.', 400);
  try {
    const sql = sqlFor(c);
    const existing = await sql`SELECT id FROM public.medar_users WHERE username_normalized=${normalized} OR phone_e164=${phone} LIMIT 1`;
    if (existing.length) return jsonError(c, 'این نام کاربری یا شماره موبایل قبلاً ثبت شده است.', 409);
    const hash = await passwordHash(password);
    const rows = await sql`INSERT INTO public.medar_users(username,phone_e164,display_name,password_hash,requested_role)
      VALUES(${username},${phone},${displayName},${hash},${role})
      RETURNING id,username,phone_e164,display_name,requested_role,account_status`;
    const user = rows[0] as AuthUser;
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,'auth.signup','user',${user.id},jsonb_build_object('requested_role',${role}))`;
    await makeSession(c,user);
    return c.json({ user: safeUser(user) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('DATABASE_URL is not configured')) return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503);
    if (message.includes('duplicate key') || message.includes('unique constraint')) return jsonError(c, 'این نام کاربری یا شماره موبایل قبلاً ثبت شده است.', 409);
    return jsonError(c, 'ثبت‌نام انجام نشد. مهاجرت دیتابیس و اتصال سرویس را بررسی کنید.', 500);
  }
});

app.post('/api/auth/login', async c => {
  if (!c.env.DATABASE_URL) return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503);
  let data: Record<string, unknown>;
  try { data = await c.req.json(); } catch { return jsonError(c, 'بدنه درخواست معتبر نیست.', 400); }
  const username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
  const password = typeof data.password === 'string' ? data.password : '';
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username) || !password || password.length > 128) return jsonError(c, 'نام کاربری یا رمز عبور نادرست است.', 401);
  try {
    const sql = sqlFor(c);
    const attempts = await sql`SELECT count(*)::int AS count FROM public.medar_login_attempts WHERE username_normalized=${username} AND attempted_at>now()-interval '15 minutes'`;
    if (Number((attempts[0] as {count:number}).count) >= 10) return jsonError(c, 'تلاش‌های ورود بیش از حد است. ۱۵ دقیقه دیگر دوباره تلاش کنید.', 429);
    const rows = await sql`SELECT id,username,phone_e164,display_name,requested_role,account_status,password_hash
      FROM public.medar_users WHERE username_normalized=${username} LIMIT 1`;
    const found = rows[0] as (AuthUser & {password_hash:string}) | undefined;
    const valid = Boolean(found && found.account_status === 'active' && await verifyPassword(password,found.password_hash));
    await sql`INSERT INTO public.medar_login_attempts(username_normalized,succeeded) VALUES(${username},${valid})`;
    if (!valid || !found) return jsonError(c, 'نام کاربری یا رمز عبور نادرست است.', 401);
    const user: AuthUser = { id:found.id,username:found.username,phone_e164:found.phone_e164,display_name:found.display_name,requested_role:found.requested_role,account_status:found.account_status };
    await makeSession(c,user);
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id) VALUES(${user.id}::uuid,'auth.login','user',${user.id})`;
    return c.json({ user:safeUser(user) });
  } catch { return jsonError(c, 'ورود انجام نشد. اتصال پایگاه داده را بررسی کنید.', 500); }
});

app.get('/api/auth/me', async c => {
  if (!c.env.DATABASE_URL) return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503);
  try {
    const user = await currentUser(c);
    return user ? c.json({ user:safeUser(user) }) : c.json({ user:null }, 401);
  } catch { return jsonError(c, 'خواندن نشست کاربری انجام نشد.', 500); }
});
app.post('/api/auth/logout', async c => {
  if (!c.env.DATABASE_URL) return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503);
  try {
    const token = getCookie(c.req.raw);
    if (token) await sqlFor(c)`UPDATE public.medar_sessions SET revoked_at=now() WHERE token_hash=${await sha256(token)} AND revoked_at IS NULL`;
    c.header('Set-Cookie', cookie('', c.req.raw, 0));
    return c.json({ ok:true });
  } catch { return jsonError(c, 'خروج انجام نشد.', 500); }
});
app.post('/api/access-requests', async c => {
  let user: AuthUser | null;
  try { user = await currentUser(c); } catch { return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503); }
  if (!user) return jsonError(c, 'برای ثبت درخواست ابتدا وارد حساب شو.', 401);
  let data: Record<string, unknown>;
  try { data = await c.req.json(); } catch { return jsonError(c, 'بدنه درخواست معتبر نیست.', 400); }
  const role = typeof data.role === 'string' ? data.role : '';
  const organization = typeof data.organizationName === 'string' ? data.organizationName.trim().slice(0,160) : null;
  if (!['customer','supplier','driver','staff'].includes(role)) return jsonError(c, 'نقش انتخابی معتبر نیست.', 400);
  if (['customer','supplier'].includes(role) && (!organization || organization.length < 2)) return jsonError(c, 'برای این نقش نام شرکت یا مزرعه ضروری است.', 400);
  try {
    const sql = sqlFor(c);
    const rows = await sql`INSERT INTO public.medar_access_requests(user_id,requested_role,organization_name)
      VALUES(${user.id}::uuid,${role},${organization})
      ON CONFLICT(user_id,requested_role,status) DO UPDATE SET organization_name=EXCLUDED.organization_name
      RETURNING id,status`;
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,'access.requested','access_request',${String((rows[0] as {id:string}).id)},jsonb_build_object('role',${role}))`;
    return c.json({ requestId:(rows[0] as {id:string}).id,status:(rows[0] as {status:string}).status },201);
  } catch { return jsonError(c, 'ثبت درخواست انجام نشد. اجرای مهاجرت دیتابیس را بررسی کنید.', 500); }
});
app.get('/api/workspace/memberships', async c => {
  let user: AuthUser | null;
  try { user = await currentUser(c); } catch { return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503); }
  if (!user) return jsonError(c, 'برای مشاهده فضای کاری ابتدا وارد حساب شو.', 401);
  try {
    const sql = sqlFor(c);
    const rows = await sql`SELECT m.id,m.company_id,m.user_id,m.role,m.active,json_build_object('name',co.name) AS company
      FROM public.memberships m JOIN public.companies co ON co.id=m.company_id
      WHERE m.user_id=${user.id}::uuid AND m.active=true ORDER BY m.created_at`;
    const requests = await sql`SELECT id,requested_role AS role,organization_name AS "organizationName",status,created_at AS "createdAt"
      FROM public.medar_access_requests WHERE user_id=${user.id}::uuid ORDER BY created_at DESC LIMIT 20`;
    return c.json({ memberships:rows,accessRequests:requests });
  } catch { return jsonError(c, 'خواندن فضای کاری انجام نشد. اجرای مهاجرت دیتابیس را بررسی کنید.', 500); }
});

app.notFound(c => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ message:'مسیر پیدا نشد.' },404));
export default app;
