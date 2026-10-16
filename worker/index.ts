import { neon } from '@neondatabase/serverless';
import { Hono } from 'hono';

type Bindings = { DATABASE_URL?: string; MEDAR_SESSION_DAYS?: string; ASSETS?: { fetch(request: Request): Promise<Response> } };
type AuthUser = { id: string; username: string; phone_e164: string; display_name: string; requested_role: string; account_status: string };
type App = { Bindings: Bindings };
export const app = new Hono<App>();
const COOKIE = 'medar_session';
const ITERATIONS = 600_000;
const encoder = new TextEncoder();

export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.trim().replaceAll(' ', '').replaceAll('-', '').replaceAll('(', '').replaceAll(')', '').replace(/[۰-۹]/g, char => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char))).replace(/[٠-٩]/g, char => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)));
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
export async function passwordHash(password: string) {
  const salt = randomToken(16);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64url(salt), iterations: ITERATIONS }, key, 256);
  return `pbkdf2$${ITERATIONS}$${salt}$${base64url(new Uint8Array(bits))}`;
}
export async function verifyPassword(password: string, stored: string) {
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
async function rateLimit(sql: ReturnType<typeof neon>, key: string, maxAttempts: number, windowMinutes: number) {
  const keyHash = await sha256(key);
  const rows = await sql`INSERT INTO public.medar_rate_limits AS existing_limit(key_hash,window_started_at,attempts,updated_at)
    VALUES(${keyHash},now(),1,now())
    ON CONFLICT (key_hash) DO UPDATE SET
      attempts=CASE WHEN existing_limit.window_started_at < now()-(${windowMinutes}::int * interval '1 minute') THEN 1 ELSE existing_limit.attempts+1 END,
      window_started_at=CASE WHEN current.window_started_at < now()-(${windowMinutes}::int * interval '1 minute') THEN now() ELSE current.window_started_at END,
      updated_at=now()
    RETURNING attempts`;
  return Number((rows[0] as {attempts:number}).attempts) > maxAttempts;
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
app.get('/api/health', async c => {
  if (!c.env.DATABASE_URL) return c.json({ ok: false, service: 'medar-api', database: false }, 503);
  try {
    const rows = await neon(c.env.DATABASE_URL)`SELECT 1 AS ready`;
    return c.json({ ok: true, service: 'medar-api', database: Number((rows[0] as {ready:number}).ready) === 1, auth: 'username-password' });
  } catch {
    return c.json({ ok: false, service: 'medar-api', database: false }, 503);
  }
});

app.post('/api/auth/signup', async c => {
  if (!c.env.DATABASE_URL) return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503);
  let data: Record<string, unknown>;
  try { data = await c.req.json(); } catch { return jsonError(c, 'بدنه درخواست معتبر نیست.', 400); }
  const username = typeof data.username === 'string' ? data.username.trim() : '';
  const normalized = username.toLowerCase();
  const displayName = typeof data.displayName === 'string' && data.displayName.trim() ? data.displayName.trim() : username;
  const phone = normalizePhone(data.phone);
  const password = typeof data.password === 'string' ? data.password : '';
  const role = typeof data.requestedRole === 'string' ? data.requestedRole : 'customer';
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return jsonError(c, 'نام کاربری باید ۳ تا ۳۲ نویسه و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.', 400);
  if (!phone) return jsonError(c, 'شماره موبایل ایران معتبر نیست.', 400);
  if (displayName.length < 2 || displayName.length > 120) return jsonError(c, 'نام نمایشی باید بین ۲ تا ۱۲۰ نویسه باشد.', 400);
  if (password.length < 10 || password.length > 128) return jsonError(c, 'رمز عبور باید حداقل ۱۰ نویسه داشته باشد.', 400);
  if (!['owner','customer','supplier','driver','staff'].includes(role)) return jsonError(c, 'نقش انتخابی معتبر نیست.', 400);
  try {
    const sql = sqlFor(c);
    const ip = c.req.header('cf-connecting-ip') || '';
    if (ip && await rateLimit(sql, 'signup-ip:' + ip, 8, 60)) return jsonError(c, 'تعداد تلاش‌های ثبت‌نام زیاد است. یک ساعت دیگر دوباره تلاش کنید.', 429);
    const existing = await sql`SELECT id FROM public.medar_users WHERE username_normalized=${normalized} OR phone_e164=${phone} LIMIT 1`;
    if (existing.length) return jsonError(c, 'این نام کاربری یا شماره موبایل قبلاً ثبت شده است.', 409);
    const hash = await passwordHash(password);
    const rows = await sql`WITH new_user AS (
        INSERT INTO public.medar_users(username,phone_e164,display_name,password_hash,requested_role)
        VALUES(${username},${phone},${displayName},${hash},${role})
        RETURNING id,username,phone_e164,display_name,requested_role,account_status
      ),
      new_company AS (
        INSERT INTO public.companies(name)
        SELECT username || ' · مجموعه' FROM new_user WHERE requested_role='owner'
        RETURNING id
      ),
      new_profile AS (
        INSERT INTO public.profiles(id,full_name,phone)
        SELECT id,display_name,phone_e164 FROM new_user
        RETURNING id
      ),
      new_membership AS (
        INSERT INTO public.memberships(company_id,user_id,role,active,created_by)
        SELECT company.id, user_row.id, 'owner', true, user_row.id
        FROM new_user user_row CROSS JOIN new_company company
        WHERE user_row.requested_role='owner'
        RETURNING user_id
      )
      SELECT user_row.id,user_row.username,user_row.phone_e164,user_row.display_name,user_row.requested_role,user_row.account_status
      FROM new_user user_row
      LEFT JOIN new_profile profile ON profile.id=user_row.id
      LEFT JOIN new_membership membership ON membership.user_id=user_row.id`;
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
    const ip = c.req.header('cf-connecting-ip') || '';
    if (ip && await rateLimit(sql, 'login-ip:' + ip, 60, 15)) return jsonError(c, 'تعداد تلاش‌های ورود از این اتصال زیاد است. ۱۵ دقیقه دیگر دوباره تلاش کنید.', 429);
    const attempts = await sql`SELECT count(*)::int AS count FROM public.medar_login_attempts WHERE username_normalized=${username} AND succeeded = false AND attempted_at>now()-interval '15 minutes'`;
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
  const organization = typeof data.organizationName === 'string' ? data.organizationName.trim().slice(0,160) : '';
  const fullName = typeof data.fullName === 'string' && data.fullName.trim() ? data.fullName.trim().slice(0,160) : user.display_name;
  const phone = typeof data.phone === 'string' && data.phone.trim() ? normalizePhone(data.phone) : user.phone_e164;
  if (!['customer','supplier','driver','staff'].includes(role)) return jsonError(c, 'نقش انتخابی معتبر نیست.', 400);
  if (organization.length < 2) return jsonError(c, 'نام شرکت یا مجموعه هدف ضروری است.', 400);
  if (fullName.length < 2 || !phone) return jsonError(c, 'نام نمایشی یا شماره تماس معتبر نیست.', 400);
  try {
    const sql = sqlFor(c);
    const companies = await sql`SELECT id FROM public.companies WHERE lower(trim(name))=lower(trim(${organization})) LIMIT 1`;
    if (!companies[0]) return jsonError(c, 'این مجموعه پیدا نشد. نام دقیق شرکت یا مزرعه را وارد کن.', 404);
    const companyId = String((companies[0] as {id:string}).id);
    const rows = await sql`INSERT INTO public.access_requests(user_id,company_id,requested_role,full_name,phone,company_name,organization_name,notes,status)
      VALUES(${user.id}::uuid,${companyId}::uuid,${role}::public.app_role,${fullName},${phone},${organization},${organization},${typeof data.notes === 'string' ? data.notes.slice(0,1000) : null},'pending')
      RETURNING id,status`;
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,'access.requested','access_request',${String((rows[0] as {id:string}).id)},jsonb_build_object('role',${role},'company_id',${companyId}))`;
    return c.json({ requestId:(rows[0] as {id:string}).id,status:(rows[0] as {status:string}).status },201);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('duplicate key') || message.includes('unique constraint')) return jsonError(c, 'برای این مجموعه درخواست فعالی داری.', 409);
    return jsonError(c, 'ثبت درخواست انجام نشد. اجرای مهاجرت دیتابیس را بررسی کنید.', 500);
  }
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
      FROM public.access_requests WHERE user_id=${user.id}::uuid ORDER BY created_at DESC LIMIT 20`;
    return c.json({ memberships:rows,accessRequests:requests });
  } catch { return jsonError(c, 'خواندن فضای کاری انجام نشد. اجرای مهاجرت دیتابیس را بررسی کنید.', 500); }
});

app.get('/api/workspace/members', async c => {
  let user: AuthUser | null;
  try { user = await currentUser(c); } catch { return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503); }
  if (!user) return jsonError(c, 'برای مدیریت اعضا ابتدا وارد حساب شو.', 401);
  const companyId = c.req.query('companyId') || '';
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return jsonError(c, 'شناسه مجموعه معتبر نیست.', 400);
  try {
    const sql = sqlFor(c);
    const access = await sql`SELECT role::text AS role FROM public.memberships
      WHERE company_id=${companyId}::uuid AND user_id=${user.id}::uuid AND active=true AND role::text IN ('owner','admin') LIMIT 1`;
    if (!access.length) return jsonError(c, 'برای مدیریت اعضای این مجموعه مجوز نداری.', 403);
    const [members, customers, suppliers, requests] = await Promise.all([
      sql`SELECT m.id AS membership_id,m.id,m.company_id,m.user_id,m.role::text AS role,m.active,m.created_at,
        u.username,u.display_name AS full_name,u.phone
        FROM public.memberships m JOIN public.medar_users u ON u.id=m.user_id
        WHERE m.company_id=${companyId}::uuid ORDER BY m.created_at DESC`,
      sql`SELECT id,name FROM public.customers WHERE company_id=${companyId}::uuid ORDER BY name`,
      sql`SELECT id,name FROM public.suppliers WHERE company_id=${companyId}::uuid ORDER BY name`,
      sql`SELECT ar.id,ar.user_id,ar.company_id,ar.requested_role::text AS requested_role,ar.full_name,ar.phone,
        ar.organization_name,ar.notes,ar.status,ar.created_at,u.username
        FROM public.access_requests ar JOIN public.medar_users u ON u.id=ar.user_id
        WHERE ar.company_id=${companyId}::uuid AND ar.status='pending' ORDER BY ar.created_at ASC`,
    ]);
    return c.json({ members, customers, suppliers, requests });
  } catch { return jsonError(c, 'خواندن اعضای مجموعه انجام نشد. مهاجرت دیتابیس را بررسی کن.', 500); }
});

app.post('/api/workspace/members', async c => {
  let user: AuthUser | null;
  try { user = await currentUser(c); } catch { return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503); }
  if (!user) return jsonError(c, 'برای افزودن عضو ابتدا وارد حساب شو.', 401);
  let data: Record<string, unknown>;
  try { data = await c.req.json(); } catch { return jsonError(c, 'بدنه درخواست معتبر نیست.', 400); }
  const companyId = typeof data.companyId === 'string' ? data.companyId : '';
  const username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
  const role = typeof data.role === 'string' ? data.role : '';
  const customerId = typeof data.customerId === 'string' && data.customerId ? data.customerId : null;
  const supplierId = typeof data.supplierId === 'string' && data.supplierId ? data.supplierId : null;
  if (!/^[0-9a-f-]{36}$/i.test(companyId) || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return jsonError(c, 'شناسه مجموعه یا نام کاربری معتبر نیست.', 400);
  if (!['admin','staff','customer','supplier','driver'].includes(role)) return jsonError(c, 'نقش قابل تخصیص نیست.', 400);
  try {
    const sql = sqlFor(c);
    const actor = await sql`SELECT role::text AS role FROM public.memberships WHERE company_id=${companyId}::uuid AND user_id=${user.id}::uuid AND active=true AND role::text IN ('owner','admin') ORDER BY CASE WHEN role::text='owner' THEN 0 ELSE 1 END LIMIT 1`;
    if (!actor.length) return jsonError(c, 'برای افزودن عضو به این مجموعه مجوز نداری.', 403);
    if (role === 'admin' && String((actor[0] as {role:string}).role) !== 'owner') return jsonError(c, 'فقط مالک مجموعه می‌تواند مدیر جدید تعیین کند.', 403);
    const users = await sql`SELECT id,username FROM public.medar_users WHERE username_normalized=${username} AND account_status='active' LIMIT 1`;
    if (!users[0]) return jsonError(c, 'این نام کاربری هنوز در مدار ثبت‌نام نکرده است.', 404);
    const targetUserId = String((users[0] as {id:string}).id);
    if (role === 'customer') {
      const valid = customerId ? await sql`SELECT id FROM public.customers WHERE id=${customerId}::uuid AND company_id=${companyId}::uuid LIMIT 1` : [];
      if (!valid.length) return jsonError(c, 'برای نقش مشتری، حساب مشتری همین مجموعه را انتخاب کن.', 400);
    }
    if (role === 'supplier') {
      const valid = supplierId ? await sql`SELECT id FROM public.suppliers WHERE id=${supplierId}::uuid AND company_id=${companyId}::uuid LIMIT 1` : [];
      if (!valid.length) return jsonError(c, 'برای نقش تأمین‌کننده، حساب تأمین‌کننده همین مجموعه را انتخاب کن.', 400);
    }
    const rows = await sql`INSERT INTO public.memberships(company_id,user_id,role,active,created_by,customer_id,supplier_id)
      VALUES(${companyId}::uuid,${targetUserId}::uuid,${role}::public.app_role,true,${user.id}::uuid,${customerId}::uuid,${supplierId}::uuid)
      ON CONFLICT(company_id,user_id,role) DO UPDATE SET active=true,created_by=EXCLUDED.created_by,customer_id=EXCLUDED.customer_id,supplier_id=EXCLUDED.supplier_id
      RETURNING id,company_id,user_id,role::text AS role,active,created_at`;
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,'membership.granted','membership',${String((rows[0] as {id:string}).id)},jsonb_build_object('company_id',${companyId},'role',${role},'target_username',${username}))`;
    return c.json({ membership:rows[0] },201);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('duplicate key') || message.includes('unique constraint')) return jsonError(c, 'این عضویت از قبل ثبت شده است.', 409);
    return jsonError(c, 'افزودن عضو انجام نشد. مهاجرت دیتابیس را بررسی کن.', 500);
  }
});

app.post('/api/workspace/members/:id/deactivate', async c => {
  let user: AuthUser | null;
  try { user = await currentUser(c); } catch { return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503); }
  if (!user) return jsonError(c, 'برای تغییر دسترسی ابتدا وارد حساب شو.', 401);
  let data: Record<string, unknown>;
  try { data = await c.req.json(); } catch { return jsonError(c, 'بدنه درخواست معتبر نیست.', 400); }
  const companyId = typeof data.companyId === 'string' ? data.companyId : '';
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return jsonError(c, 'شناسه مجموعه معتبر نیست.', 400);
  try {
    const sql = sqlFor(c);
    const rows = await sql`SELECT m.id,m.user_id,m.role::text AS role FROM public.memberships m
      JOIN public.memberships actor ON actor.company_id=m.company_id
      WHERE m.id=${c.req.param('id')}::uuid AND m.company_id=${companyId}::uuid
        AND actor.user_id=${user.id}::uuid AND actor.active=true AND actor.role::text IN ('owner','admin') LIMIT 1`;
    if (!rows[0]) return jsonError(c, 'عضویت پیدا نشد یا اجازه تغییر آن را نداری.', 404);
    const target = rows[0] as {id:string;user_id:string;role:string};
    const actorRows = await sql`SELECT role::text AS role FROM public.memberships WHERE company_id=${companyId}::uuid AND user_id=${user.id}::uuid AND active=true AND role::text IN ('owner','admin') ORDER BY CASE WHEN role::text='owner' THEN 0 ELSE 1 END LIMIT 1`;
    const actorRole = String((actorRows[0] as {role:string}).role);
    if (target.role === 'owner') return jsonError(c, 'مالک مجموعه را نمی‌توان غیرفعال کرد؛ ابتدا مالکیت را منتقل کن.', 400);
    if (target.role === 'admin' && actorRole !== 'owner') return jsonError(c, 'فقط مالک مجموعه می‌تواند مدیر را غیرفعال کند.', 403);
    if (target.user_id === user.id) return jsonError(c, 'برای جلوگیری از قفل‌شدن دسترسی، نمی‌توانی عضویت خودت را از اینجا غیرفعال کنی.', 400);
    await sql`UPDATE public.memberships SET active=false WHERE id=${target.id}::uuid AND company_id=${companyId}::uuid`;
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,'membership.deactivated','membership',${target.id},jsonb_build_object('company_id',${companyId}))`;
    return c.json({ ok:true });
  } catch { return jsonError(c, 'غیرفعال‌سازی دسترسی انجام نشد.', 500); }
});

app.get('/api/admin/access-requests', async c => {
  let user: AuthUser | null;
  try { user = await currentUser(c); } catch { return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503); }
  if (!user) return jsonError(c, 'برای مشاهده درخواست‌ها ابتدا وارد حساب شو.', 401);
  try {
    const sql = sqlFor(c);
    const admins = await sql`SELECT company_id FROM public.memberships WHERE user_id=${user.id}::uuid AND active=true AND role::text IN ('owner','admin')`;
    if (!admins.length) return jsonError(c, 'این عملیات فقط برای مالک یا مدیر مجموعه مجاز است.', 403);
    const requests = await sql`SELECT ar.id,ar.company_id AS "companyId",co.name AS "companyName",ar.user_id AS "userId",
        u.username,u.display_name AS "displayName",ar.full_name AS "fullName",ar.phone,ar.requested_role::text AS role,
        ar.organization_name AS "organizationName",ar.status,ar.created_at AS "createdAt"
      FROM public.access_requests ar
      JOIN public.companies co ON co.id=ar.company_id
      JOIN public.medar_users u ON u.id=ar.user_id
      WHERE ar.status='pending'
        AND EXISTS (SELECT 1 FROM public.memberships m WHERE m.company_id=ar.company_id AND m.user_id=${user.id}::uuid AND m.active=true AND m.role::text IN ('owner','admin'))
      ORDER BY ar.created_at ASC LIMIT 100`;
    return c.json({ requests });
  } catch { return jsonError(c, 'خواندن درخواست‌ها انجام نشد.', 500); }
});

app.post('/api/admin/access-requests/:id/review', async c => {
  let user: AuthUser | null;
  try { user = await currentUser(c); } catch { return jsonError(c, 'پایگاه داده پیکربندی نشده است.', 503); }
  if (!user) return jsonError(c, 'برای بررسی درخواست ابتدا وارد حساب شو.', 401);
  let data: Record<string, unknown>;
  try { data = await c.req.json(); } catch { return jsonError(c, 'بدنه درخواست معتبر نیست.', 400); }
  const decision = data.decision;
  if (decision !== 'approve' && decision !== 'reject') return jsonError(c, 'تصمیم بررسی معتبر نیست.', 400);
  try {
    const sql = sqlFor(c);
    const rows = await sql`SELECT ar.id,ar.company_id,ar.user_id,ar.requested_role::text AS role
      FROM public.access_requests ar JOIN public.memberships m ON m.company_id=ar.company_id
      WHERE ar.id=${c.req.param('id')}::uuid AND ar.status='pending'
        AND m.user_id=${user.id}::uuid AND m.active=true AND m.role::text IN ('owner','admin') LIMIT 1`;
    if (!rows[0]) return jsonError(c, 'درخواست پیدا نشد یا اجازه بررسی آن را نداری.', 404);
    const item = rows[0] as {id:string;company_id:string;user_id:string;role:string};
    if (decision === 'approve') {
      if (!['customer','supplier','driver','staff'].includes(item.role)) return jsonError(c, 'نقش درخواستی قابل تأیید نیست.', 400);
      await sql`INSERT INTO public.memberships(company_id,user_id,role,active,created_by)
        VALUES(${item.company_id}::uuid,${item.user_id}::uuid,${item.role}::public.app_role,true,${user.id}::uuid)
        ON CONFLICT(company_id,user_id,role) DO UPDATE SET active=true`;
    }
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await sql`UPDATE public.access_requests SET status=${status},reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now()
      WHERE id=${item.id}::uuid`;
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,${decision === 'approve' ? 'access.approved' : 'access.rejected'},'access_request',${item.id},jsonb_build_object('company_id',${item.company_id},'role',${item.role}))`;
    return c.json({ ok:true,status });
  } catch { return jsonError(c, 'بررسی درخواست انجام نشد.', 500); }
});
app.notFound(c => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ message:'مسیر پیدا نشد.' },404));
export default app;
