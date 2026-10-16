import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { Hono } from 'hono';

type EvidenceBucket = {
  put(key:string,value:ArrayBuffer|ReadableStream|string,options?:{httpMetadata?:{contentType?:string};customMetadata?:Record<string,string>}):Promise<unknown>;
  get(key:string):Promise<{body:ReadableStream;httpMetadata?:{contentType?:string};customMetadata?:Record<string,string>;size:number}|null>;
  delete(key:string):Promise<void>;
};
type Bindings = { DATABASE_URL?: string; MEDAR_SESSION_DAYS?: string; EVIDENCE_BUCKET?: EvidenceBucket; ASSETS?: { fetch(request: Request): Promise<Response> } };
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
  if (/^\\$2[aby]\\$\\d{2}\\$/.test(stored)) {
    try { return await bcrypt.compare(password, stored); } catch { return false; }
  }
  const [algorithm, rounds, salt, expected] = stored.split('
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
    if (/^\\$2[aby]\\$\\d{2}\\$/.test(found.password_hash)) {
      const upgraded=await passwordHash(password);
      await sql`UPDATE public.medar_users SET password_hash=${upgraded},updated_at=now() WHERE id=${found.id}::uuid`;
    }
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
    const rows = await sql`SELECT m.id,m.company_id,m.user_id,m.role::text AS role,m.customer_id,m.supplier_id,m.active,json_build_object('name',co.name) AS company
      FROM public.memberships m JOIN public.companies co ON co.id=m.company_id
      WHERE m.user_id=${user.id}::uuid AND m.active=true ORDER BY m.created_at`;
    const requests = await sql`SELECT id,requested_role AS role,organization_name AS "organizationName",status,created_at AS "createdAt"
      FROM public.access_requests WHERE user_id=${user.id}::uuid ORDER BY created_at DESC LIMIT 20`;
    return c.json({ memberships:rows,accessRequests:requests });
  } catch { return jsonError(c, 'خواندن فضای کاری انجام نشد. اجرای مهاجرت دیتابیس را بررسی کنید.', 500); }
});

app.post('/api/workspace/members/:id/reset-credentials', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'ابتدا وارد حساب شو.',401);
  let data:Record<string,unknown>;
  try{data=await c.req.json();}catch{return jsonError(c,'بدنه درخواست معتبر نیست.',400);}
  const companyId=typeof data.companyId==='string'?data.companyId:'';
  const phone=normalizePhone(data.phone);
  const password=typeof data.password==='string'?data.password:'';
  if(!validUuid(companyId)||!validUuid(c.req.param('id')))return jsonError(c,'شناسه مجموعه یا عضویت معتبر نیست.',400);
  if(!phone)return jsonError(c,'شماره موبایل ایران معتبر نیست.',400);
  if(password.length<10||password.length>128)return jsonError(c,'رمز عبور موقت باید ۱۰ تا ۱۲۸ نویسه باشد.',400);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||membership.role!=='owner')return jsonError(c,'بازنشانی رمز فقط برای مالک مجموعه مجاز است.',403);
    const targetRows=await sql`SELECT m.user_id,m.role::text AS role,u.username FROM public.memberships m JOIN public.medar_users u ON u.id=m.user_id WHERE m.id=${c.req.param('id')}::uuid AND m.company_id=${companyId}::uuid LIMIT 1`;
    if(!targetRows[0])return jsonError(c,'عضویت پیدا نشد.',404);
    const target=targetRows[0] as {user_id:string;role:string;username:string};
    if(target.role==='owner'||target.user_id===user.id)return jsonError(c,'برای امنیت، بازنشانی مالک یا حساب خودت از این مسیر مجاز نیست.',403);
    const duplicate=await sql`SELECT id FROM public.medar_users WHERE phone_e164=${phone} AND id<>${target.user_id}::uuid LIMIT 1`;
    if(duplicate.length)return jsonError(c,'این شماره موبایل به حساب دیگری متصل است.',409);
    const hash=await passwordHash(password);
    await sql`UPDATE public.medar_users SET phone_e164=${phone},password_hash=${hash},account_status='active',updated_at=now() WHERE id=${target.user_id}::uuid`;
    await sql`UPDATE public.medar_sessions SET revoked_at=now() WHERE user_id=${target.user_id}::uuid AND revoked_at IS NULL`;
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,'member.credentials.reset','user',${target.user_id},jsonb_build_object('company_id',${companyId},'target_role',${target.role}))`;
    return c.json({ok:true,username:target.username});
  }catch(error){const message=error instanceof Error?error.message:'';if(message.includes('duplicate key'))return jsonError(c,'این شماره موبایل قبلاً ثبت شده است.',409);return jsonError(c,'بازنشانی رمز و شماره انجام نشد.',500);}
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
        u.username,u.display_name AS full_name,u.phone_e164 AS phone
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
    let customerId:string|null=null,supplierId:string|null=null;
    if (decision === 'approve') {
      if (!['customer','supplier','driver','staff'].includes(item.role)) return jsonError(c, 'نقش درخواستی قابل تأیید نیست.', 400);
      if(item.role==='customer'){
        customerId=typeof data.customerId==='string'?data.customerId:'';
        if(!validUuid(customerId))return jsonError(c,'برای تأیید مشتری باید حساب مشتری همین مجموعه انتخاب شود.',400);
        const linked=await sql`SELECT id FROM public.customers WHERE id=${customerId}::uuid AND company_id=${item.company_id}::uuid LIMIT 1`;
        if(!linked.length)return jsonError(c,'حساب مشتری متعلق به این مجموعه نیست.',400);
      }else if(item.role==='supplier'){
        supplierId=typeof data.supplierId==='string'?data.supplierId:'';
        if(!validUuid(supplierId))return jsonError(c,'برای تأیید تأمین‌کننده باید حساب تأمین‌کننده همین مجموعه انتخاب شود.',400);
        const linked=await sql`SELECT id FROM public.suppliers WHERE id=${supplierId}::uuid AND company_id=${item.company_id}::uuid LIMIT 1`;
        if(!linked.length)return jsonError(c,'حساب تأمین‌کننده متعلق به این مجموعه نیست.',400);
      }
      await sql`INSERT INTO public.memberships(company_id,user_id,role,active,created_by,customer_id,supplier_id)
        VALUES(${item.company_id}::uuid,${item.user_id}::uuid,${item.role}::public.app_role,true,${user.id}::uuid,${customerId}::uuid,${supplierId}::uuid)
        ON CONFLICT(company_id,user_id,role) DO UPDATE SET active=true,created_by=EXCLUDED.created_by,customer_id=EXCLUDED.customer_id,supplier_id=EXCLUDED.supplier_id`;
    }
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await sql`UPDATE public.access_requests SET status=${status},customer_id=${customerId}::uuid,supplier_id=${supplierId}::uuid,reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now()
      WHERE id=${item.id}::uuid`;
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,${decision === 'approve' ? 'access.approved' : 'access.rejected'},'access_request',${item.id},jsonb_build_object('company_id',${item.company_id},'role',${item.role}))`;
    return c.json({ ok:true,status });
  } catch { return jsonError(c, 'بررسی درخواست انجام نشد.', 500); }
});
type OperationKind = 'farm-sites'|'flock-cycles'|'production-batches'|'daily-production'|'task-templates'|'operational-tasks'|'incidents'|'partnership-agreements'|'partner-finance'|'partner-settlements';
type OperationConfig = { table:string; fields:string[]; managerOnly?:boolean; readOnly?:boolean };
const operationConfigs: Record<OperationKind,OperationConfig> = {
  'farm-sites': {table:'farm_sites',fields:['site_code','name','site_type','supplier_id','province','city','address','registration_reference','license_expires_on','timezone','active','latitude','longitude']},
  'flock-cycles': {table:'flock_cycles',fields:['farm_site_id','cycle_code','species','arrived_on','planned_end_on','ended_on','initial_bird_count','status','source_reference','notes','cycle_type','initial_quantity','quantity_unit']},
  'production-batches': {table:'production_batches',fields:['farm_site_id','supplier_id','agreement_id','flock_cycle_id','product_id','lot_id','batch_code','production_kind','status','unit','planned_quantity','produced_quantity','rejected_quantity','started_on','expected_on','completed_on','quality_status','manager_notes']},
  'daily-production': {table:'daily_production_records',fields:['batch_id','record_date','shift_label','feed_consumed_kg','mortality_count','eggs_collected','eggs_rejected','produced_quantity','average_weight_grams','note','resource_name','input_quantity','input_unit','loss_quantity','loss_unit','rejected_quantity']},
  'task-templates': {table:'task_templates',fields:['template_code','version','title','instructions','category','priority','evidence_required','expected_evidence_types','status'],managerOnly:true},
  'operational-tasks': {table:'operational_tasks',fields:['farm_site_id','batch_id','template_id','assignee_user_id','assignee_supplier_id','title','instructions_snapshot','category','priority','status','due_at','evidence_required','completion_note']},
  incidents: {table:'operational_incidents',fields:['farm_site_id','batch_id','task_id','reported_supplier_id','severity','category','title','description','status','resolution_note']},
  'partnership-agreements': {table:'partnership_agreements',fields:['supplier_id','agreement_code','version','status','effective_from','effective_to','company_profit_share_pct','partner_profit_share_pct','shared_expense_categories','settlement_basis','settlement_due_days','terms','signed_document_path','signed_at','supersedes_agreement_id'],managerOnly:true},
  'partner-finance': {table:'partner_financial_entries',fields:['supplier_id','agreement_id','entry_type','status','direction','amount','paid_amount','currency','expense_category','is_shared_cost','paid_by','payment_status','recognized_on','external_reference','source_table','source_record_id','linked_entry_id','adjustment_effect','notes'],managerOnly:true},
  'partner-settlements': {table:'partner_settlement_periods',fields:[],managerOnly:true,readOnly:true},
};
const supplierReadFilters: Partial<Record<OperationKind,string>> = {
  'farm-sites':'supplier_id=$2',
  'flock-cycles':'farm_site_id IN (SELECT id FROM public.farm_sites WHERE company_id=$1 AND supplier_id=$2)',
  'production-batches':'supplier_id=$2',
  'daily-production':'batch_id IN (SELECT id FROM public.production_batches WHERE company_id=$1 AND supplier_id=$2)',
  'operational-tasks':'assignee_supplier_id=$2',
  incidents:'(reported_supplier_id=$2 OR farm_site_id IN (SELECT id FROM public.farm_sites WHERE company_id=$1 AND supplier_id=$2) OR batch_id IN (SELECT id FROM public.production_batches WHERE company_id=$1 AND supplier_id=$2))',
  'partnership-agreements':'supplier_id=$2',
  'partner-finance':'supplier_id=$2',
  'partner-settlements':'supplier_id=$2',
};
async function queryRows(sql: ReturnType<typeof neon>, statement: string, params: unknown[] = []): Promise<Record<string,unknown>[]> {
  return await sql.query(statement, params) as Record<string,unknown>[];
}
async function operationMembership(sql: ReturnType<typeof neon>, userId: string, companyId: string) {
  const rows=await sql`SELECT role::text AS role,supplier_id,customer_id FROM public.memberships
    WHERE company_id=${companyId}::uuid AND user_id=${userId}::uuid AND active=true
    ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 WHEN 'supplier' THEN 3 ELSE 4 END LIMIT 1`;
  return rows[0] as {role:string;supplier_id:string|null;customer_id:string|null}|undefined;
}
function validUuid(value: string) { return /^[0-9a-f-]{36}$/i.test(value); }
async function sameCompanyRow(sql: ReturnType<typeof neon>, table: string, id: unknown, companyId: string) {
  if(typeof id!=='string'||!validUuid(id)) return false;
  const rows=await queryRows(sql,`SELECT id FROM public.${table} WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1`,[id,companyId]);
  return rows.length>0;
}
type DataFilter={column:string;op:string;value:unknown};
type DataTableConfig={readRoles:string[];writeRoles:string[];managerOnly?:boolean;readOnly?:boolean};
const dataTableConfigs:Record<string,DataTableConfig>={
  orders:{readRoles:['owner','admin','staff','customer','supplier'],writeRoles:['owner','admin','staff','customer']},
  order_items:{readRoles:['owner','admin','staff','customer','supplier'],writeRoles:['owner','admin','staff','customer']},
  customers:{readRoles:['owner','admin','staff','customer'],writeRoles:['owner','admin','staff']},
  suppliers:{readRoles:['owner','admin','staff','supplier'],writeRoles:['owner','admin','staff']},
  products:{readRoles:['owner','admin','staff','customer','supplier'],writeRoles:['owner','admin','staff']},
  price_agreements:{readRoles:['owner','admin','staff','customer'],writeRoles:['owner','admin']},
  capacity_commitments:{readRoles:['owner','admin','staff','supplier'],writeRoles:['owner','admin','staff','supplier']},
  shipments:{readRoles:['owner','admin','staff','driver','customer','supplier'],writeRoles:['owner','admin','staff','driver']},
  shipment_locations:{readRoles:['owner','admin','staff','driver','customer','supplier'],writeRoles:['owner','admin','staff','driver']},
  delivery_evidence:{readRoles:['owner','admin','staff','driver','customer','supplier'],writeRoles:['owner','admin','staff','driver']},
  invoices:{readRoles:['owner','admin','staff','customer'],writeRoles:['owner','admin','staff']},
  settlements:{readRoles:['owner','admin','staff','supplier'],writeRoles:['owner','admin']},
  farm_sites:{readRoles:['owner','admin','staff','supplier'],writeRoles:[]},
  lots:{readRoles:['owner','admin','staff','supplier'],writeRoles:['owner','admin','staff','supplier']},
  quality_reviews:{readRoles:['owner','admin','staff','supplier'],writeRoles:['owner','admin','staff']},
  inventory_movements:{readRoles:['owner','admin','staff','supplier'],writeRoles:[],readOnly:true},
  inventory_balances:{readRoles:['owner','admin','staff'],writeRoles:[],readOnly:true},
  company_goals:{readRoles:['owner','admin','staff'],writeRoles:['owner','admin','staff']},
  operational_tasks:{readRoles:['owner','admin','staff','supplier'],writeRoles:[],readOnly:true},
  operational_incidents:{readRoles:['owner','admin','staff','supplier'],writeRoles:[],readOnly:true},
  access_requests:{readRoles:['owner','admin'],writeRoles:[],managerOnly:true,readOnly:true},
  audit_events:{readRoles:['owner','admin'],writeRoles:[],managerOnly:true,readOnly:true},
};
type SelectNode={fields:string[];relations:{name:string;alias:string;fields:string[];relations:SelectNode['relations']}[]};
function splitTopLevel(value:string):string[]{
  const out:string[]=[];let depth=0,start=0;
  for(let i=0;i<value.length;i++){const ch=value[i];if(ch==='(')depth++;else if(ch===')')depth--;else if(ch===','&&depth===0){out.push(value.slice(start,i).trim());start=i+1;}}
  const tail=value.slice(start).trim();if(tail)out.push(tail);return out;
}
function parseSelect(value:string):SelectNode{
  const fields:string[]=[],relations:SelectNode['relations']=[];
  for(const token of splitTopLevel(value||'*')){
    const open=token.indexOf('(');
    if(open>0&&token.endsWith(')')){
      const head=token.slice(0,open).trim(),parts=head.split(':');
      const name=(parts.length>1?parts[1]:parts[0]).trim(),alias=(parts.length>1?parts[0]:parts[0]).trim();
      const nested=parseSelect(token.slice(open+1,-1));
      relations.push({name,alias,fields:nested.fields,relations:nested.relations});
    }else if(token)fields.push(token.trim());
  }
  return {fields,relations};
}
const dataRelations:Record<string,Record<string,{table:string;parentKey:string;relatedKey:string;many?:boolean}>>={
  orders:{customers:{table:'customers',parentKey:'customer_id',relatedKey:'id'},order_items:{table:'order_items',parentKey:'id',relatedKey:'order_id',many:true}},
  order_items:{products:{table:'products',parentKey:'product_id',relatedKey:'id'},orders:{table:'orders',parentKey:'order_id',relatedKey:'id'},suppliers:{table:'suppliers',parentKey:'supplier_id',relatedKey:'id'},capacity_commitments:{table:'capacity_commitments',parentKey:'capacity_commitment_id',relatedKey:'id'},lots:{table:'lots',parentKey:'lot_id',relatedKey:'id'}},
  capacity_commitments:{suppliers:{table:'suppliers',parentKey:'supplier_id',relatedKey:'id'},products:{table:'products',parentKey:'product_id',relatedKey:'id'}},
  price_agreements:{customers:{table:'customers',parentKey:'customer_id',relatedKey:'id'},products:{table:'products',parentKey:'product_id',relatedKey:'id'}},
  lots:{suppliers:{table:'suppliers',parentKey:'supplier_id',relatedKey:'id'},products:{table:'products',parentKey:'product_id',relatedKey:'id'}},
  quality_reviews:{lots:{table:'lots',parentKey:'lot_id',relatedKey:'id'}},
  shipments:{orders:{table:'orders',parentKey:'order_id',relatedKey:'id'}},
  invoices:{customers:{table:'customers',parentKey:'customer_id',relatedKey:'id'},orders:{table:'orders',parentKey:'order_id',relatedKey:'id'}},
  settlements:{suppliers:{table:'suppliers',parentKey:'supplier_id',relatedKey:'id'}},
  shipment_locations:{shipments:{table:'shipments',parentKey:'shipment_id',relatedKey:'id'}},
  delivery_evidence:{shipments:{table:'shipments',parentKey:'shipment_id',relatedKey:'id'}},
  access_requests:{profiles:{table:'profiles',parentKey:'user_id',relatedKey:'id'}},
};
const dataColumnCache=new Map<string,Promise<Set<string>>>();
async function dataColumns(sql:ReturnType<typeof neon>,table:string):Promise<Set<string>>{
  let cached=dataColumnCache.get(table);if(!cached){cached=queryRows(sql,'SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',['public',table]).then(rows=>new Set(rows.map(row=>String(row.column_name))));dataColumnCache.set(table,cached);}
  return cached;
}
function splitOrExpression(expression:string):{column:string;op:string;value:string|null}[]{
  return expression.split(',').map(part=>part.trim()).filter(Boolean).map(part=>{
    const bits=part.split('.');
    if(bits.length<3)throw new Error('فیلتر OR معتبر نیست');
    const column=bits[0],op=bits[1],value=bits.slice(2).join('.');
    if(!/^[a-z_][a-z0-9_]*$/i.test(column)||!['eq','neq','gte','gt','lte','lt','is'].includes(op))throw new Error('عملگر فیلتر OR مجاز نیست');
    return {column,op,value:value==='null'?null:value};
  });
}
function dataRoleScope(table:string,membership:{role:string;supplier_id:string|null;customer_id:string|null},userId:string,params:unknown[]):string|null{
  const role=membership.role;
  if(['owner','admin','staff'].includes(role))return null;
  if(role==='supplier'){
    if(!membership.supplier_id)return 'FALSE';
    params.push(membership.supplier_id);const n=params.length;
    if(['customers','invoices','price_agreements','company_goals','inventory_balances','access_requests','audit_events'].includes(table))return 'FALSE';
    if(['farm_sites','lots','capacity_commitments','inventory_movements','settlements'].includes(table))return `t.supplier_id=$${n}::uuid`;
    if(table==='quality_reviews')return `EXISTS(SELECT 1 FROM public.lots l WHERE l.company_id=t.company_id AND l.id=t.lot_id AND l.supplier_id=$${n}::uuid)`;
    if(table==='operational_tasks')return `t.assignee_supplier_id=$${n}::uuid`;
    if(table==='operational_incidents')return `(t.reported_supplier_id=$${n}::uuid OR t.farm_site_id IN (SELECT id FROM public.farm_sites WHERE company_id=t.company_id AND supplier_id=$${n}::uuid) OR t.batch_id IN (SELECT id FROM public.production_batches WHERE company_id=t.company_id AND supplier_id=$${n}::uuid))`;
    if(table==='orders')return `EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.company_id=t.company_id AND oi.order_id=t.id AND oi.supplier_id=$${n}::uuid)`;
    if(table==='order_items')return `t.supplier_id=$${n}::uuid`;
    if(table==='shipments')return `EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.company_id=t.company_id AND oi.order_id=t.order_id AND oi.supplier_id=$${n}::uuid)`;
    if(table==='shipment_locations'||table==='delivery_evidence')return `EXISTS(SELECT 1 FROM public.shipments s JOIN public.order_items oi ON oi.company_id=s.company_id AND oi.order_id=s.order_id WHERE s.company_id=t.company_id AND s.id=t.shipment_id AND oi.supplier_id=$${n}::uuid)`;
    return null;
  }
  if(role==='customer'){
    if(!membership.customer_id)return 'FALSE';
    params.push(membership.customer_id);const n=params.length;
    if(table==='customers')return `t.id=$${n}::uuid`;
    if(table==='orders')return `t.customer_id=$${n}::uuid`;
    if(table==='order_items')return `t.order_id IN (SELECT id FROM public.orders WHERE company_id=t.company_id AND customer_id=$${n}::uuid)`;
    if(table==='invoices'||table==='price_agreements')return `t.customer_id=$${n}::uuid`;
    if(table==='shipments')return `t.order_id IN (SELECT id FROM public.orders WHERE company_id=t.company_id AND customer_id=$${n}::uuid)`;
    if(table==='shipment_locations'||table==='delivery_evidence')return `EXISTS(SELECT 1 FROM public.shipments s JOIN public.orders o ON o.company_id=s.company_id AND o.id=s.order_id WHERE s.company_id=t.company_id AND s.id=t.shipment_id AND o.customer_id=$${n}::uuid)`;
    if(['products'].includes(table))return null;
    return 'FALSE';
  }
  if(role==='driver'){
    params.push(userId);const n=params.length;
    if(table==='shipments')return `t.driver_user_id=$${n}::uuid`;
    if(table==='shipment_locations'||table==='delivery_evidence')return `EXISTS(SELECT 1 FROM public.shipments s WHERE s.company_id=t.company_id AND s.id=t.shipment_id AND s.driver_user_id=$${n}::uuid)`;
    return 'FALSE';
  }
  return 'FALSE';
}
async function hydrateDataRows(sql:ReturnType<typeof neon>,table:string,rows:Record<string,unknown>[],nodes:SelectNode['relations'],companyId:string,membership:{role:string;supplier_id:string|null;customer_id:string|null},userId:string):Promise<void>{
  if(!rows.length)return;
  if(table==='access_requests'&&rows.some(row=>typeof row.user_id==='string')){
    const ids=[...new Set(rows.map(row=>row.user_id).filter((id):id is string=>typeof id==='string'&&validUuid(id)))];
    if(ids.length){const users=await queryRows(sql,'SELECT id,username,display_name,phone_e164 FROM public.medar_users WHERE id=ANY($1::uuid[])',[ids]);const byId=new Map(users.map(u=>[String(u.id),u]));for(const row of rows){const u=byId.get(String(row.user_id));if(u){row.username=u.username;row.display_name=u.display_name;row.phone=u.phone_e164;}}}
  }
  for(const node of nodes){
    const relation=dataRelations[table]?.[node.name];
    if(!relation)throw new Error('رابطه داده‌ای مجاز نیست: '+table+'.'+node.name);
    const ids=[...new Set(rows.map(row=>row[relation.parentKey]).filter((id):id is string=>typeof id==='string'&&validUuid(id)))];
    if(!ids.length){for(const row of rows)row[node.alias]=relation.many?[]:null;continue;}
    const relatedColumns=await dataColumns(sql,relation.table);
    const hasCompany=relatedColumns.has('company_id');
    const params:unknown[]=hasCompany?[companyId,ids]:[ids];let extra='';
    const companyParam=hasCompany?'$1::uuid':null;
    const idArrayParam=hasCompany?'$2::uuid[]':'$1::uuid[]';
    if(hasCompany&&membership.role==='supplier'&&relation.table==='order_items'&&membership.supplier_id){params.push(membership.supplier_id);extra+=` AND supplier_id=${params.length}::uuid`;}
    if(hasCompany&&membership.role==='customer'&&relation.table==='order_items'&&membership.customer_id){params.push(membership.customer_id);extra+=` AND order_id IN (SELECT id FROM public.orders WHERE company_id=${companyParam} AND customer_id=${params.length}::uuid)`;}
    if(hasCompany&&membership.role==='customer'&&relation.table==='orders'&&membership.customer_id){params.push(membership.customer_id);extra+=` AND customer_id=${params.length}::uuid`;}
    if(hasCompany&&membership.role==='supplier'&&relation.table==='orders'&&membership.supplier_id){params.push(membership.supplier_id);extra+=` AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.company_id=orders.company_id AND oi.order_id=orders.id AND oi.supplier_id=${params.length}::uuid)`;}
    const related=await queryRows(sql,`SELECT * FROM public.${relation.table} WHERE ${hasCompany?'company_id=$1::uuid AND ':''}${relation.relatedKey}=ANY(${idArrayParam})${extra}`,params);
    await hydrateDataRows(sql,relation.table,related,node.relations,companyId,membership,userId);
    const byKey=new Map<string,Record<string,unknown>[]>();
    for(const item of related){const key=String(item[relation.relatedKey]??'');const list=byKey.get(key)??[];list.push(item);byKey.set(key,list);}
    for(const row of rows){
      const key=String(row[relation.parentKey]??'');const matches=byKey.get(key)??[];
      row[node.alias]=relation.many?matches.map(item=>projectDataRow(item,node.fields,node.relations)):matches.length?projectDataRow(matches[0],node.fields,node.relations):null;
    }
  }
}
function projectDataRow(row:Record<string,unknown>,fields:string[],relations:SelectNode['relations']):Record<string,unknown>{
  const output:Record<string,unknown>={};
  const blocked=new Set(['password_hash','email','encrypted_password','token_hash','refresh_token']);
  if(fields.includes('*')){for(const [key,value] of Object.entries(row))if(!blocked.has(key))output[key]=value;}
  else for(const field of fields)if(!blocked.has(field)&&Object.prototype.hasOwnProperty.call(row,field))output[field]=row[field];
  for(const relation of relations)if(Object.prototype.hasOwnProperty.call(row,relation.alias))output[relation.alias]=row[relation.alias];
  return output;
}
function addDataRoleFilter(table:string,membership:{role:string;supplier_id:string|null;customer_id:string|null},userId:string,params:unknown[],where:string[]){
  const scope=dataRoleScope(table,membership,userId,params);if(scope)where.push(scope);
}
function buildDataWhere(table:string,columns:Set<string>,filters:DataFilter[],companyId:string,membership:{role:string;supplier_id:string|null;customer_id:string|null},userId:string){
  const params:unknown[]=[companyId],where=['t.company_id=$1::uuid'];
  addDataRoleFilter(table,membership,userId,params,where);
  for(const filter of filters){
    if(filter.column==='company_id')continue;
    if(filter.column==='__onConflict')continue;
    if(filter.column==='__or'){
      for(const cond of splitOrExpression(String(filter.value??''))){
        if(!columns.has(cond.column))throw new Error('فیلد فیلتر مجاز نیست: '+cond.column);
        const col='t.'+cond.column;
        if(cond.op==='is'&&cond.value===null)where.push(`(${col} IS NULL)`);
        else if(cond.op==='is')where.push(`(${col} IS NOT NULL)`);
        else{params.push(cond.value);const n=params.length;const op=cond.op==='eq'?'=':cond.op==='neq'?'<>':cond.op==='gte'?'>=':cond.op==='gt'?'>':cond.op==='lte'?'<=':'<';where.push(`(${col} ${op} $${n})`);}
      }
      continue;
    }
    if(!/^[a-z_][a-z0-9_]*$/i.test(filter.column)||!columns.has(filter.column))throw new Error('فیلد فیلتر مجاز نیست: '+filter.column);
    const col='t.'+filter.column,op=filter.op;
    if(op==='is'&&filter.value===null){where.push(`${col} IS NULL`);continue;}
    if(op==='not_is'&&filter.value===null){where.push(`${col} IS NOT NULL`);continue;}
    if(op==='in'||op==='not_in'){
      const values=Array.isArray(filter.value)?filter.value.map(String):[];
      params.push(values);const n=params.length;where.push(op==='in'?`${col}::text=ANY($${n}::text[])`:`${col}::text<>ALL($${n}::text[])`);continue;
    }
    const operators:Record<string,string>={eq:'=',neq:'<>',gte:'>=',gt:'>',lte:'<=',lt:'<',not_eq:'<>',not_gte:'<',not_lte:'>'};
    const sqlOp=operators[op];if(!sqlOp)throw new Error('عملگر فیلتر مجاز نیست');
    if(filter.value===null&&op==='eq'){where.push(`${col} IS NULL`);continue;}
    params.push(filter.value);where.push(`${col} ${sqlOp} $${params.length}`);
  }
  return {params,where:where.join(' AND ')};
}
app.post('/api/rpc/:name', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای اجرای عملیات ابتدا وارد حساب شو.',401);
  const name=c.req.param('name');
  let args:Record<string,unknown>;
  try{args=await c.req.json();}catch{return jsonError(c,'پارامترهای عملیات معتبر نیست.',400);}
  const companyId=typeof args._company==='string'?args._company:typeof args.company_id==='string'?args.company_id:'';
  if(!validUuid(companyId))return jsonError(c,'شناسه مجموعه معتبر نیست.',400);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership)return jsonError(c,'عضویت فعال در این مجموعه پیدا نشد.',403);
    if(name==='company_members'){
      if(!['owner','admin','staff'].includes(membership.role))return jsonError(c,'فهرست اعضای مجموعه برای این نقش مجاز نیست.',403);
      const rows=await sql`SELECT m.id,m.user_id,m.role::text AS role,m.active,m.created_at,u.username,u.display_name,u.phone_e164
        FROM public.memberships m JOIN public.medar_users u ON u.id=m.user_id
        WHERE m.company_id=${companyId}::uuid
        ORDER BY m.created_at DESC`;
      const data=rows.map(row=>({id:row.id,user_id:row.user_id,role:row.role,active:row.active,created_at:row.created_at,username:row.username,profiles:{full_name:row.display_name,phone:row.phone_e164}}));
      return c.json({data,count:data.length});
    }
    if(name==='allocate_order_item'){
      if(!['owner','admin'].includes(membership.role))return jsonError(c,'تخصیص ظرفیت فقط برای مالک یا مدیر مجاز است.',403);
      const orderItem=typeof args._order_item==='string'?args._order_item:'',capacity=typeof args._capacity==='string'?args._capacity:'';
      if(!validUuid(orderItem)||!validUuid(capacity))return jsonError(c,'ردیف سفارش یا ظرفیت معتبر نیست.',400);
      await sql`SELECT public.medar_allocate_order_item(${user.id}::uuid,${companyId}::uuid,${orderItem}::uuid,${capacity}::uuid)`;
      await sql`INSERT INTO public.audit_events(company_id,actor_id,table_name,record_id,action,changes,occurred_at)
        VALUES(${companyId}::uuid,${user.id}::uuid,'order_items',${orderItem},'order.item.allocated',jsonb_build_object('capacity_commitment_id',${capacity}),now())`;
      return c.json({data:null,count:null});
    }
    if(name==='record_inventory_movement'){
      if(!['owner','admin','staff'].includes(membership.role))return jsonError(c,'ثبت گردش انبار برای این نقش مجاز نیست.',403);
      const product=typeof args._product==='string'?args._product:'',movementType=typeof args._movement_type==='string'?args._movement_type:'',quantity=Number(args._quantity);
      if(!validUuid(product)||!Number.isFinite(quantity)||quantity<=0)return jsonError(c,'محصول یا مقدار گردش معتبر نیست.',400);
      const unitCost=args._unit_cost===null||args._unit_cost===undefined?null:Number(args._unit_cost);
      const supplier=typeof args._supplier==='string'?args._supplier:null,order=typeof args._order==='string'?args._order:null,lot=typeof args._lot==='string'?args._lot:null;
      const reference=typeof args._reference_code==='string'?args._reference_code:null,note=typeof args._note==='string'?args._note:null;
      const rows=await sql`SELECT public.medar_record_inventory_movement(${user.id}::uuid,${companyId}::uuid,${product}::uuid,${movementType},${quantity},${unitCost},${supplier}::uuid,${order}::uuid,${lot}::uuid,${reference},${note}) AS id`;
      return c.json({data:(rows[0] as {id:string}).id,count:null});
    }
    return jsonError(c,'این عملیات سروری پشتیبانی نمی‌شود.',404);
  }catch(error){const message=error instanceof Error?error.message:'';return jsonError(c,message||'اجرای عملیات انجام نشد.',400);}
});
app.post('/api/data/:table/query', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای مشاهده داده ابتدا وارد حساب شو.',401);
  const table=c.req.param('table');
  const config=dataTableConfigs[table];
  if(!config)return jsonError(c,'این منبع داده در API مجاز نیست.',404);
  let body:Record<string,unknown>;
  try{body=await c.req.json();}catch{return jsonError(c,'درخواست خواندن داده معتبر نیست.',400);}
  const query=(body.query&&typeof body.query==='object'?body.query:{}) as {select?:string;filters?:DataFilter[];orders?:{column:string;ascending:boolean}[];limit?:number|null;offset?:number;count?:string|null;head?:boolean};
  const filters=Array.isArray(query.filters)?query.filters:[];
  const companyFilter=filters.find(filter=>filter.column==='company_id'&&filter.op==='eq')?.value;
  let companyId=typeof companyFilter==='string'?companyFilter:typeof body.companyId==='string'?body.companyId:'';
  try{
    const sql=sqlFor(c);
    if(!validUuid(companyId)){
      const first=await sql`SELECT company_id FROM public.memberships WHERE user_id=${user.id}::uuid AND active=true ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 WHEN 'supplier' THEN 3 ELSE 4 END,created_at LIMIT 1`;
      companyId=first[0]?String((first[0] as {company_id:string}).company_id):'';
    }
    if(!validUuid(companyId))return jsonError(c,'برای مشاهده داده، عضویت فعال در یک مجموعه لازم است.',403);
    const membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!config.readRoles.includes(membership.role))return jsonError(c,'برای مشاهده این داده مجوز نداری.',403);
    const columns=await dataColumns(sql,table);
    if(!columns.has('company_id'))return jsonError(c,'منبع داده فاقد مرز مجموعه است و از API عمومی قابل خواندن نیست.',403);
    const selection=parseSelect(typeof query.select==='string'?query.select:'*');
    const virtualFields=table==='access_requests'?new Set(['username','display_name','phone']):new Set<string>();
    for(const field of selection.fields){
      if(field==='*'||field==='count(*)')continue;
      if(!columns.has(field)&&!virtualFields.has(field))return jsonError(c,'فیلد انتخاب‌شده مجاز نیست: '+field,400);
    }
    for(const relation of selection.relations)if(!dataRelations[table]?.[relation.name])return jsonError(c,'رابطه انتخاب‌شده مجاز نیست: '+relation.name,400);
    const built=buildDataWhere(table,columns,filters,companyId,membership,user.id);
    let count:number|null=null;
    if(query.count==='exact'||query.head){
      const countRows=await queryRows(sql,`SELECT count(*)::int AS count FROM public.${table} t WHERE ${built.where}`,built.params);
      count=Number((countRows[0] as {count:number}).count);
    }
    if(query.head)return c.json({data:null,count});
    const orders=Array.isArray(query.orders)?query.orders:[];
    const orderSql=orders.map(order=>{
      if(!/^[a-z_][a-z0-9_]*$/i.test(order.column)||!columns.has(order.column))throw new Error('فیلد مرتب‌سازی مجاز نیست: '+order.column);
      return `t.${order.column} ${order.ascending===false?'DESC':'ASC'}`;
    }).join(',');
    const limit=Math.min(1000,Math.max(0,Number.isFinite(Number(query.limit))?Number(query.limit):500));
    const offset=Math.max(0,Number.isFinite(Number(query.offset))?Number(query.offset):0);
    const params=[...built.params,limit,offset];
    const rows=await queryRows(sql,`SELECT t.* FROM public.${table} t WHERE ${built.where}${orderSql?' ORDER BY '+orderSql:''} LIMIT $${params.length-1} OFFSET $${params.length}`,params);
    await hydrateDataRows(sql,table,rows,selection.relations,companyId,membership,user.id);
    const data=rows.map(row=>projectDataRow(row,selection.fields,selection.relations));
    return c.json({data,count});
  }catch(error){const message=error instanceof Error?error.message:'';return jsonError(c,message||'خواندن داده انجام نشد.',400);}
});
const serverManagedDataFields=new Set(['id','company_id','created_at','updated_at','created_by','updated_by','recorded_by','captured_by','reviewer_id','reviewed_at','approved_by','approved_at','submitted_by','submitted_at','posted_by','posted_at','paid_by','paid_at','issued_at','delivered_at','departed_at','returned_at','resolved_by','resolved_at','reported_by','assigned_by']);
const dataReferenceTables:Record<string,string>={customer_id:'customers',supplier_id:'suppliers',product_id:'products',order_id:'orders',shipment_id:'shipments',lot_id:'lots',capacity_commitment_id:'capacity_commitments',farm_site_id:'farm_sites',batch_id:'production_batches',template_id:'task_templates',task_id:'operational_tasks',agreement_id:'partnership_agreements'};
async function validateDataReferences(sql:ReturnType<typeof neon>,table:string,row:Record<string,unknown>,companyId:string,userId:string,membership:{role:string;supplier_id:string|null;customer_id:string|null}){
  for(const [field,related] of Object.entries(dataReferenceTables)){
    if(row[field]!==undefined&&row[field]!==null&&row[field]!==''&&!await sameCompanyRow(sql,related,row[field],companyId))throw new Error('ارجاع '+field+' متعلق به این مجموعه نیست.');
  }
  if(row.assignee_user_id){
    const linked=await queryRows(sql,"SELECT id FROM public.memberships WHERE company_id=$1::uuid AND user_id=$2::uuid AND active=true AND role::text IN ('owner','admin','staff') LIMIT 1",[companyId,row.assignee_user_id]);
    if(!linked.length)throw new Error('مسئول وظیفه عضو فعال همین مجموعه نیست.');
  }
  if(row.owner_user_id){
    const linked=await queryRows(sql,"SELECT id FROM public.memberships WHERE company_id=$1::uuid AND user_id=$2::uuid AND active=true LIMIT 1",[companyId,row.owner_user_id]);
    if(!linked.length)throw new Error('مالک هدف عضو فعال همین مجموعه نیست.');
  }
  if(row.driver_user_id){
    const linked=await queryRows(sql,"SELECT id FROM public.memberships WHERE company_id=$1::uuid AND user_id=$2::uuid AND active=true AND role::text='driver' LIMIT 1",[companyId,row.driver_user_id]);
    if(!linked.length)throw new Error('راننده انتخاب‌شده عضو فعال راننده در این مجموعه نیست.');
  }
  if(table==='order_items'&&row.order_id){
    const order=await queryRows(sql,'SELECT customer_id,status FROM public.orders WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1',[row.order_id,companyId]);
    if(!order.length||String(order[0].status)!=='draft')throw new Error('قلم فقط به سفارش پیش‌نویس همین مجموعه اضافه می‌شود.');
    if(membership.role==='customer'&&String(order[0].customer_id)!==membership.customer_id)throw new Error('این سفارش متعلق به حساب مشتری شما نیست.');
    const quantity=Number(row.quantity);
    if(!Number.isFinite(quantity)||quantity<=0)throw new Error('مقدار سفارش باید بیشتر از صفر باشد.');
    const agreement=await queryRows(sql,`SELECT unit_price FROM public.price_agreements WHERE company_id=$1::uuid AND customer_id=$2::uuid AND product_id=$3::uuid AND valid_from<=current_date AND (valid_to IS NULL OR valid_to>=current_date) AND min_qty<=$4 ORDER BY valid_from DESC LIMIT 1`,[companyId,order[0].customer_id,row.product_id,quantity]);
    if(!agreement.length)throw new Error('برای این مشتری، محصول و مقدار، توافق قیمت معتبر وجود ندارد.');
    row.unit_price=agreement[0].unit_price;
  }
  if(table==='invoices'&&row.order_id){
    const order=await queryRows(sql,'SELECT customer_id,status FROM public.orders WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1',[row.order_id,companyId]);
    if(!order.length||String(order[0].customer_id)!==String(row.customer_id))throw new Error('مشتری فاکتور باید با مشتری سفارش یکسان باشد.');
    if(!['confirmed','allocated','in_fulfillment','dispatched','delivered'].includes(String(order[0].status)))throw new Error('برای این وضعیت سفارش، صدور فاکتور مجاز نیست.');
  }
  if(table==='shipments'&&row.order_id){
    const order=await queryRows(sql,'SELECT status FROM public.orders WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1',[row.order_id,companyId]);
    if(!order.length||!['allocated','in_fulfillment'].includes(String(order[0].status)))throw new Error('ارسال فقط برای سفارش تخصیص‌یافته یا در حال اجرا ساخته می‌شود.');
  }
  if(table==='delivery_evidence'){
    const shipmentId=String(row.shipment_id??''),path=typeof row.storage_path==='string'?row.storage_path:'';
    const shipment=await queryRows(sql,'SELECT driver_user_id FROM public.shipments WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1',[shipmentId,companyId]);
    if(!shipment.length)throw new Error('محموله متعلق به این مجموعه نیست.');
    if(membership.role==='driver'&&String(shipment[0].driver_user_id)!==userId)throw new Error('این محموله به راننده فعلی تخصیص داده نشده است.');
    if(path){
      if(!path.startsWith(companyId+'/'+shipmentId+'/')||path.split('/').length!==3)throw new Error('مسیر فایل مدرک با شرکت یا محموله مطابقت ندارد.');
      if(!await (await Promise.resolve(null as unknown)).value){} 
    }else if(!String(row.note??'').trim()&&!String(row.recipient_name??'').trim()&&row.reading_celsius===undefined)throw new Error('برای ثبت مدرک، فایل یا یادداشت معتبر لازم است.');
  }
  if(table==='shipment_locations'){
    const shipmentId=String(row.shipment_id??''),lat=Number(row.latitude),lon=Number(row.longitude);
    if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lon)||lon < -180||lon > 180)throw new Error('مختصات GPS معتبر نیست.');
    const shipment=await queryRows(sql,'SELECT driver_user_id FROM public.shipments WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1',[shipmentId,companyId]);
    if(!shipment.length)throw new Error('محموله متعلق به این مجموعه نیست.');
    if(membership.role==='driver'&&String(shipment[0].driver_user_id)!==userId)throw new Error('این محموله به راننده فعلی تخصیص داده نشده است.');
  }
}
async function auditDataChange(sql:ReturnType<typeof neon>,companyId:string,userId:string,table:string,id:string,action:string,changes:Record<string,unknown>={}){
  await sql`INSERT INTO public.audit_events(company_id,actor_id,table_name,record_id,action,changes,occurred_at)
    VALUES(${companyId}::uuid,${userId}::uuid,${table},${id}::uuid,${action},${JSON.stringify(changes)}::jsonb,now())`;
}
app.post('/api/data/:table', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای تغییر داده ابتدا وارد حساب شو.',401);
  const table=c.req.param('table'),config=dataTableConfigs[table];
  if(!config)return jsonError(c,'این منبع داده در API مجاز نیست.',404);
  let body:Record<string,unknown>;
  try{body=await c.req.json();}catch{return jsonError(c,'درخواست تغییر داده معتبر نیست.',400);}
  const operation=String(body.operation||''),query=(body.query&&typeof body.query==='object'?body.query:{}) as {select?:string;filters?:DataFilter[];orders?:{column:string;ascending:boolean}[];limit?:number|null;offset?:number;count?:string|null;head?:boolean};
  const filters=Array.isArray(query.filters)?query.filters:[];
  const companyFilter=filters.find(filter=>filter.column==='company_id'&&filter.op==='eq')?.value;
  let companyId=typeof companyFilter==='string'?companyFilter:typeof body.companyId==='string'?body.companyId:'';
  if(!['insert','update','delete','upsert'].includes(operation))return jsonError(c,'نوع تغییر داده معتبر نیست.',400);
  try{
    const sql=sqlFor(c);
    if(!validUuid(companyId)){
      const first=await sql`SELECT company_id FROM public.memberships WHERE user_id=${user.id}::uuid AND active=true ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 WHEN 'supplier' THEN 3 ELSE 4 END,created_at LIMIT 1`;
      companyId=first[0]?String((first[0] as {company_id:string}).company_id):'';
    }
    if(!validUuid(companyId))return jsonError(c,'برای تغییر داده، عضویت فعال در یک مجموعه لازم است.',403);
    const membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!config.writeRoles.includes(membership.role)||config.readOnly)return jsonError(c,'برای تغییر این داده مجوز نداری.',403);
    const manager=['owner','admin'].includes(membership.role),columns=await dataColumns(sql,table);
    const selection=parseSelect(typeof query.select==='string'?query.select:'*');
    if(operation==='insert'){
      if(table==='shipments'&&membership.role==='driver')return jsonError(c,'راننده نمی‌تواند محموله جدید بسازد.',403);
      if(table==='quality_reviews'){
        const payload=Array.isArray(body.values)?body.values[0]:body.values;
        if(!payload||typeof payload!=='object')return jsonError(c,'داده بازبینی کیفیت معتبر نیست.',400);
        const row=payload as Record<string,unknown>,lotId=String(row.lot_id??''),result=String(row.result??'');
        if(!validUuid(lotId))return jsonError(c,'سری محصول معتبر نیست.',400);
        const inserted=await sql`SELECT public.medar_record_quality_review(${user.id}::uuid,${companyId}::uuid,${lotId}::uuid,${result},${typeof row.notes==='string'?row.notes:null},${JSON.stringify(row.checklist??{})}::jsonb) AS id`;
        const id=String((inserted[0] as {id:string}).id);
        await auditDataChange(sql,companyId,user.id,table,id,'quality.review.recorded',{lot_id:lotId,result});
        return c.json({data:body.returning?[{id,company_id:companyId,lot_id:lotId,result}]:null,count:1},201);
      }
      if(table==='orders'&&membership.role==='customer'&&!membership.customer_id)return jsonError(c,'حساب مشتری به عضویت متصل نیست.',403);
      if(table==='order_items'&&membership.role==='customer'&&!membership.customer_id)return jsonError(c,'حساب مشتری به عضویت متصل نیست.',403);
      const inputs=Array.isArray(body.values)?body.values:[body.values];
      if(!inputs.length||inputs.some(value=>!value||typeof value!=='object'||Array.isArray(value)))return jsonError(c,'محتوای رکورد معتبر نیست.',400);
      if(inputs.length>50)return jsonError(c,'در هر درخواست حداکثر ۵۰ رکورد ثبت می‌شود.',413);
      const inserted:Record<string,unknown>[]=[];
      for(const raw of inputs){
        const input=raw as Record<string,unknown>,row:Record<string,unknown>={};
        for(const [field,value] of Object.entries(input)){
          if(!columns.has(field)||serverManagedDataFields.has(field)||field==='company_id')continue;
          if(table==='order_items'&&['supplier_id','lot_id','capacity_commitment_id'].includes(field))continue;
          if(table==='shipments'&&field==='stage')continue;
          if(table==='orders'&&field==='status')continue;
          if(table==='capacity_commitments'&&field==='status')continue;
          if(table==='invoices'&&['status','paid_amount','payment_reference','paid_at','paid_by'].includes(field))continue;
          if(table==='settlements'&&['status','paid_at','paid_by'].includes(field))continue;
          if(table==='lots'&&field==='status')continue;
          if(table==='company_goals'&&field==='status')continue;
          row[field]=value;
        }
        row.company_id=companyId;
        if(table==='orders'){row.status='draft';if(membership.role==='customer')row.customer_id=membership.customer_id;}
        if(table==='order_items'){
          if(!row.order_id||!row.product_id)return jsonError(c,'سفارش و محصول لازم است.',400);
          if(membership.role==='customer'){
            const ownOrder=await queryRows(sql,'SELECT customer_id FROM public.orders WHERE id=$1::uuid AND company_id=$2::uuid AND status=\'draft\' LIMIT 1',[row.order_id,companyId]);
            if(!ownOrder.length||String(ownOrder[0].customer_id)!==membership.customer_id)return jsonError(c,'قلم فقط به سفارش پیش‌نویس خودت اضافه می‌شود.',403);
          }
        }
        if(table==='shipments')row.stage='planned';
        if(table==='capacity_commitments'){
          row.status='declared';if(membership.role==='supplier')row.supplier_id=membership.supplier_id;
          if(!Number.isFinite(Number(row.declared_qty))||Number(row.declared_qty)<=0)return jsonError(c,'ظرفیت اعلامی باید بیشتر از صفر باشد.',400);
          if(String(row.period_end)<String(row.period_start))return jsonError(c,'پایان بازه ظرفیت قبل از شروع آن است.',400);
        }
        if(table==='invoices'){row.status='draft';row.paid_amount=0;}
        if(table==='settlements')row.status='pending';
        if(table==='lots'){row.status='pending_review';if(membership.role==='supplier')row.supplier_id=membership.supplier_id;}
        if(table==='company_goals')row.status='planned';
        if(table==='customers'||table==='suppliers'||table==='products')if(row.active===undefined)row.active=true;
        if(table==='quality_reviews')return jsonError(c,'بازبینی کیفیت باید از مسیر ثبت تخصصی انجام شود.',400);
        if(table==='delivery_evidence'&&membership.role==='driver'){
          const shipmentId=String(row.shipment_id??'');
          const assigned=await queryRows(sql,'SELECT id FROM public.shipments WHERE id=$1::uuid AND company_id=$2::uuid AND driver_user_id=$3::uuid LIMIT 1',[shipmentId,companyId,user.id]);
          if(!assigned.length)return jsonError(c,'این محموله به راننده فعلی تخصیص داده نشده است.',403);
        }
        if(table==='shipment_locations'&&membership.role==='driver')row.driver_user_id=user.id;
        if(columns.has('created_by'))row.created_by=user.id;
        if(columns.has('updated_by'))row.updated_by=user.id;
        if(columns.has('captured_by')&&table==='delivery_evidence')row.captured_by=user.id;
        if(columns.has('reviewer_id')&&table==='quality_reviews')row.reviewer_id=user.id;
        if(table==='invoices'){
          const amount=Number(row.amount);
          if(!Number.isFinite(amount)||amount<=0)return jsonError(c,'مبلغ فاکتور باید بیشتر از صفر باشد.',400);
        }
        if(table==='settlements'){
          const amount=Number(row.amount);
          if(!Number.isFinite(amount)||amount<=0)return jsonError(c,'مبلغ تسویه باید بیشتر از صفر باشد.',400);
        }
        if(table==='price_agreements'){
          if(Number(row.unit_price)<0||Number(row.min_qty)<=0||!row.customer_id||!row.product_id||!row.valid_from)return jsonError(c,'قیمت، حداقل مقدار، مشتری، محصول و تاریخ شروع لازم است.',400);
          if(row.valid_to&&String(row.valid_to)<String(row.valid_from))return jsonError(c,'پایان توافق قیمت قبل از شروع آن است.',400);
        }
        if(table==='delivery_evidence'){
          const path=typeof row.storage_path==='string'?row.storage_path:'';
          if(path&&(!path.startsWith(companyId+'/'+String(row.shipment_id)+'/')||path.split('/').length!==3))return jsonError(c,'مسیر فایل مدرک با محموله مطابقت ندارد.',400);
        }
        await validateDataReferences(sql,table,row,companyId,user.id,membership);
        const fields=Object.keys(row).filter(field=>columns.has(field)&&/^[a-z_][a-z0-9_]*$/i.test(field));
        if(!fields.length)return jsonError(c,'هیچ فیلد قابل ثبت ارسال نشده است.',400);
        const params=fields.map(field=>row[field]),placeholders=params.map((_,i)=>'$'+(i+1));
        const rows=await queryRows(sql,`INSERT INTO public.${table}(${fields.join(',')}) VALUES(${placeholders.join(',')}) RETURNING *`,params);
        const created=rows[0];if(created){inserted.push(created);await auditDataChange(sql,companyId,user.id,table,String(created.id),'data.inserted',{fields});}
      }
      if(body.returning){
        await hydrateDataRows(sql,table,inserted,selection.relations,companyId,membership,user.id);
        return c.json({data:inserted.map(row=>projectDataRow(row,selection.fields,selection.relations)),count:inserted.length},201);
      }
      return c.json({data:null,count:inserted.length},201);
    }
    if(operation==='update'){
      if(!filters.some(filter=>filter.column==='id'&&filter.op==='eq'&&typeof filter.value==='string'&&validUuid(filter.value)))return jsonError(c,'برای تغییر رکورد باید شناسه دقیق آن مشخص باشد.',400);
      const built=buildDataWhere(table,columns,filters,companyId,membership,user.id);
      const existing=await queryRows(sql,`SELECT t.* FROM public.${table} t WHERE ${built.where} LIMIT 2`,built.params);
      if(!existing.length)return jsonError(c,'رکورد پیدا نشد یا دسترسی به آن مجاز نیست.',404);
      if(existing.length>1)return jsonError(c,'فیلتر تغییر رکورد یکتا نیست.',400);
      const old=existing[0],input=body.values&&typeof body.values==='object'?body.values as Record<string,unknown>:{};
      const patch:Record<string,unknown>={};
      for(const [field,value] of Object.entries(input)){
        if(!columns.has(field)||serverManagedDataFields.has(field)||['id','company_id','created_at','created_by'].includes(field))continue;
        if(table==='order_items')return jsonError(c,'تغییر تخصیص قلم سفارش فقط از مسیر تخصیص ظرفیت مجاز است.',403);
        if(table==='lots'&&field==='status')return jsonError(c,'وضعیت سری محصول فقط از مسیر بازبینی کیفیت تغییر می‌کند.',403);
        if(table==='shipments'&&field==='driver_user_id'&&!manager)return jsonError(c,'فقط مالک یا مدیر می‌تواند راننده محموله را تغییر دهد.',403);
        patch[field]=value;
      }
      if(!Object.keys(patch).length)return jsonError(c,'هیچ فیلد قابل تغییر ارسال نشده است.',400);
      if(table==='orders'&&patch.status!==undefined){
        const current=String(old.status),next=String(patch.status);
        const transitions:Record<string,string[]>={draft:['submitted','cancelled'],submitted:['confirmed','cancelled'],confirmed:['allocated','cancelled'],allocated:['in_fulfillment','cancelled'],in_fulfillment:['dispatched','cancelled'],dispatched:['delivered','partially_delivered','returned'],partially_delivered:['delivered','returned']};
        if(membership.role==='customer'){if(String(old.customer_id)!==membership.customer_id||current!=='draft'||!['submitted','cancelled'].includes(next))return jsonError(c,'این گذار وضعیت سفارش برای حساب مشتری مجاز نیست.',403);}
        else if(!['owner','admin','staff'].includes(membership.role)||!(transitions[current]??[]).includes(next))return jsonError(c,'گذار وضعیت سفارش معتبر نیست.',409);
      }
      if(table==='shipments'&&patch.stage!==undefined){
        const current=String(old.stage),next=String(patch.stage),transitions:Record<string,string[]>={planned:['loading'],loading:['in_transit'],in_transit:['arrived','failed'],arrived:['delivered','failed','returned']};
        if(!(transitions[current]??[]).includes(next))return jsonError(c,'گذار مرحله محموله معتبر نیست.',409);
        if(membership.role==='driver'&&String(old.driver_user_id)!==user.id)return jsonError(c,'این محموله به راننده فعلی تخصیص داده نشده است.',403);
        if(next==='failed'&&!String(patch.failure_reason??old.failure_reason??'').trim())return jsonError(c,'برای ثبت عدم تحویل، علت لازم است.',400);
        if(next==='in_transit')patch.departed_at=new Date().toISOString();
        if(next==='delivered')patch.delivered_at=new Date().toISOString();
      }
      if(table==='capacity_commitments'&&(patch.status!==undefined||patch.confirmed_qty!==undefined)){
        if(!manager)return jsonError(c,'تأیید ظرفیت فقط برای مالک یا مدیر مجاز است.',403);
        const current=String(old.status),next=String(patch.status??current),declared=Number(old.declared_qty),committed=Number(old.committed_qty??0),confirmed=Number(patch.confirmed_qty??old.confirmed_qty??0);
        if(next==='confirmed'){
          if(!['declared','confirmed'].includes(current)||!Number.isFinite(confirmed)||confirmed<committed||confirmed>declared)return jsonError(c,'مقدار تأییدشده باید بین تعهد فعلی و ظرفیت اعلامی باشد.',400);
          patch.confirmed_qty=confirmed;
        }else if(['released','cancelled'].includes(next)){
          if(!['declared','confirmed'].includes(current))return jsonError(c,'این ظرفیت در وضعیت فعلی قابل آزادسازی نیست.',409);
        }else if(next!==current)return jsonError(c,'گذار وضعیت ظرفیت معتبر نیست.',409);
      }
      if(table==='invoices'&&patch.status!==undefined){
        if(!manager&&!['staff'].includes(membership.role))return jsonError(c,'تغییر وضعیت فاکتور برای این نقش مجاز نیست.',403);
        const current=String(old.status),next=String(patch.status);
        if(next==='issued'&&current==='draft')patch.issued_at=new Date().toISOString();
        else if(next==='paid'&&['issued','overdue'].includes(current)){
          const paidAmount=Number(patch.paid_amount??old.paid_amount),reference=String(patch.payment_reference??'').trim();
          if(paidAmount<Number(old.amount)||!reference)return jsonError(c,'برای ثبت پرداخت فاکتور، مبلغ کامل و مرجع پرداخت لازم است.',400);
          patch.paid_at=new Date().toISOString();patch.paid_by=user.id;
        }else if(next==='overdue'&&current==='issued'){}
        else return jsonError(c,'گذار وضعیت فاکتور معتبر نیست.',409);
      }
      if(table==='settlements'&&patch.status!==undefined){
        if(!manager)return jsonError(c,'تغییر وضعیت تسویه فقط برای مالک یا مدیر مجاز است.',403);
        const current=String(old.status),next=String(patch.status);
        if(next==='approved'&&current==='pending'){}
        else if(next==='paid'&&current==='approved'){
          if(!String(patch.payment_reference??'').trim())return jsonError(c,'برای ثبت پرداخت تسویه، مرجع پرداخت لازم است.',400);
          patch.paid_at=new Date().toISOString();patch.paid_by=user.id;
        }else if(next==='cancelled'&&['pending','approved'].includes(current)){}
        else return jsonError(c,'گذار وضعیت تسویه معتبر نیست.',409);
      }
      if(table==='company_goals'&&patch.status!==undefined&&!['planned','active','completed','paused'].includes(String(patch.status)))return jsonError(c,'وضعیت هدف معتبر نیست.',400);
      if(columns.has('updated_at'))patch.updated_at=new Date().toISOString();
      if(columns.has('updated_by'))patch.updated_by=user.id;
      await validateDataReferences(sql,table,patch,companyId,user.id,membership);
      const fields=Object.keys(patch).filter(field=>columns.has(field)&&/^[a-z_][a-z0-9_]*$/i.test(field));
      const params=[...fields.map(field=>patch[field]),...built.params];
      const assignments=fields.map((field,i)=>field+'=$'+(i+1)).join(',');
      const where=built.where.replace(/\$(\d+)/g,(_,n)=>'$'+(Number(n)+fields.length));
      const updated=await queryRows(sql,`UPDATE public.${table} t SET ${assignments} WHERE ${where} RETURNING t.*`,params);
      for(const row of updated)await auditDataChange(sql,companyId,user.id,table,String(row.id),'data.updated',patch);
      if(body.returning){
        await hydrateDataRows(sql,table,updated,selection.relations,companyId,membership,user.id);
        return c.json({data:updated.map(row=>projectDataRow(row,selection.fields,selection.relations)),count:updated.length});
      }
      return c.json({data:null,count:updated.length});
    }
    if(operation==='delete'){
      if(!filters.some(filter=>filter.column==='id'&&filter.op==='eq'&&typeof filter.value==='string'&&validUuid(filter.value)))return jsonError(c,'برای حذف باید شناسه دقیق رکورد مشخص باشد.',400);
      if(!['orders','price_agreements','company_goals'].includes(table))return jsonError(c,'حذف این نوع داده مجاز نیست.',403);
      const built=buildDataWhere(table,columns,filters,companyId,membership,user.id);
      const existing=await queryRows(sql,`SELECT t.* FROM public.${table} t WHERE ${built.where} LIMIT 2`,built.params);
      if(!existing.length)return jsonError(c,'رکورد پیدا نشد.',404);
      if(existing.length>1)return jsonError(c,'فیلتر حذف رکورد یکتا نیست.',400);
      if(table==='orders'){
        if(String(existing[0].status)!=='draft')return jsonError(c,'فقط سفارش پیش‌نویس قابل حذف است.',409);
        const items=await queryRows(sql,'SELECT id FROM public.order_items WHERE company_id=$1::uuid AND order_id=$2::uuid LIMIT 1',[companyId,existing[0].id]);
        if(items.length)return jsonError(c,'سفارشی که قلم دارد قابل حذف نیست.',409);
      }
      if(table==='price_agreements'&&!manager)return jsonError(c,'حذف توافق قیمت فقط برای مالک یا مدیر مجاز است.',403);
      if(table==='company_goals'&&!['owner','admin','staff'].includes(membership.role))return jsonError(c,'حذف هدف برای این نقش مجاز نیست.',403);
      const deleted=await queryRows(sql,`DELETE FROM public.${table} t WHERE ${built.where} RETURNING t.*`,built.params);
      for(const row of deleted)await auditDataChange(sql,companyId,user.id,table,String(row.id),'data.deleted',{});
      return c.json({data:null,count:deleted.length});
    }
    return jsonError(c,'این نوع تغییر داده پشتیبانی نمی‌شود.',400);
  }catch(error){const message=error instanceof Error?error.message:'';return jsonError(c,message||'ذخیره تغییرات انجام نشد.',400);}
});
const allowedUploadTypes=new Set(['application/pdf','image/jpeg','image/png','image/webp']);
function safeUploadName(value:string){return value.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120)||'upload';}
function evidenceFileHeaders(contentType:string,filename:string){
  return {'content-type':contentType,'content-disposition':`attachment; filename="${safeUploadName(filename)}"`,'x-content-type-options':'nosniff','cache-control':'private, no-store'};
}
app.post('/api/operations/operational-tasks/:id/evidence', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای ثبت مدرک ابتدا وارد حساب شو.',401);
  const companyId=c.req.query('companyId')||'';
  if(!validUuid(companyId)||!validUuid(c.req.param('id')))return jsonError(c,'شناسه مجموعه یا وظیفه معتبر نیست.',400);
  let form:FormData;
  try{form=await c.req.formData();}catch{return jsonError(c,'فرم مدرک معتبر نیست.',400);}
  const evidenceType=String(form.get('evidenceType')||'note');
  const note=String(form.get('note')||'').trim().slice(0,2000);
  const measurement=String(form.get('measurement')||'').trim();
  const unit=String(form.get('unit')||'').trim().slice(0,24);
  const fileValue=form.get('file');
  const file=fileValue instanceof File&&fileValue.size>0?fileValue:null;
  if(!['note','measurement','photo','document'].includes(evidenceType))return jsonError(c,'نوع مدرک معتبر نیست.',400);
  if(evidenceType==='note'&&note.length<2)return jsonError(c,'برای مدرک متنی، یادداشت لازم است.',400);
  if(evidenceType==='measurement'&&(!Number.isFinite(Number(measurement))||!unit))return jsonError(c,'مقدار و واحد اندازه‌گیری را کامل کن.',400);
  if(['photo','document'].includes(evidenceType)&&!file)return jsonError(c,'برای عکس یا سند، فایل انتخاب کن.',400);
  if(file&&(file.size>10*1024*1024||!allowedUploadTypes.has(file.type)))return jsonError(c,'فایل باید PDF یا تصویر JPG/PNG/WebP و حداکثر ۱۰ مگابایت باشد.',413);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!['owner','admin','staff','supplier'].includes(membership.role))return jsonError(c,'برای ثبت مدرک این وظیفه مجوز نداری.',403);
    const taskRows=await sql`SELECT id,assignee_supplier_id,assignee_user_id,status FROM public.operational_tasks WHERE id=${c.req.param('id')}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    if(!taskRows[0])return jsonError(c,'وظیفه پیدا نشد.',404);
    const task=taskRows[0] as {id:string;assignee_supplier_id:string|null;assignee_user_id:string|null;status:string};
    if(membership.role==='supplier'&&task.assignee_supplier_id!==membership.supplier_id)return jsonError(c,'این وظیفه به تأمین‌کننده شما تخصیص داده نشده است.',403);
    if(membership.role==='staff'&&task.assignee_user_id!==user.id)return jsonError(c,'این وظیفه به شما تخصیص داده نشده است.',403);
    let path:string|null=null;
    if(file){
      if(!c.env.EVIDENCE_BUCKET)return jsonError(c,'ذخیره‌سازی فایل R2 پیکربندی نشده است.',503);
      const filename=safeUploadName(file.name),key=`${companyId}/evidence/${task.id}/${crypto.randomUUID()}-${filename}`;
      await c.env.EVIDENCE_BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type},customMetadata:{companyId,taskId:task.id,uploaderId:user.id,originalName:filename}});
      path=key;
    }
    try{
      const rows=await sql`INSERT INTO public.task_evidence(company_id,task_id,evidence_type,storage_path,note,measurement_value,measurement_unit,uploaded_by)
        VALUES(${companyId}::uuid,${task.id}::uuid,${evidenceType},${path},${note||null},${evidenceType==='measurement'?Number(measurement):null},${evidenceType==='measurement'?unit:null},${user.id}::uuid)
        RETURNING id,company_id,task_id,evidence_type,storage_path,note,measurement_value,measurement_unit,uploaded_by,captured_at,created_at`;
      await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
        VALUES(${user.id}::uuid,'task.evidence.added','task_evidence',${String((rows[0] as {id:string}).id)},jsonb_build_object('company_id',${companyId},'task_id',${task.id},'evidence_type',${evidenceType}))`;
      return c.json({evidence:rows[0]},201);
    }catch(error){
      if(path&&c.env.EVIDENCE_BUCKET)await c.env.EVIDENCE_BUCKET.delete(path).catch(()=>undefined);
      throw error;
    }
  }catch{return jsonError(c,'ثبت مدرک انجام نشد. وضعیت وظیفه و مهاجرت دیتابیس را بررسی کن.',500);}
});
app.get('/api/operations/operational-tasks/:id/evidence', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'ابتدا وارد حساب شو.',401);
  const companyId=c.req.query('companyId')||'';
  if(!validUuid(companyId)||!validUuid(c.req.param('id')))return jsonError(c,'شناسه مجموعه یا وظیفه معتبر نیست.',400);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!['owner','admin','staff','supplier'].includes(membership.role))return jsonError(c,'به مدارک این وظیفه دسترسی نداری.',403);
    const task=await sql`SELECT id,assignee_supplier_id,assignee_user_id FROM public.operational_tasks WHERE id=${c.req.param('id')}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    if(!task[0])return jsonError(c,'وظیفه پیدا نشد.',404);
    const t=task[0] as {assignee_supplier_id:string|null;assignee_user_id:string|null};
    if(membership.role==='supplier'&&t.assignee_supplier_id!==membership.supplier_id)return jsonError(c,'به مدارک این وظیفه دسترسی نداری.',403);
    const rows=await sql`SELECT id,company_id,task_id,evidence_type,storage_path,note,measurement_value,measurement_unit,uploaded_by,captured_at,created_at FROM public.task_evidence WHERE company_id=${companyId}::uuid AND task_id=${c.req.param('id')}::uuid ORDER BY created_at DESC`;
    return c.json({evidence:rows});
  }catch{return jsonError(c,'خواندن مدارک انجام نشد.',500);}
});
app.get('/api/evidence/:id/download', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'ابتدا وارد حساب شو.',401);
  if(!validUuid(c.req.param('id')))return jsonError(c,'شناسه مدرک معتبر نیست.',400);
  if(!c.env.EVIDENCE_BUCKET)return jsonError(c,'ذخیره‌سازی فایل R2 پیکربندی نشده است.',503);
  try{
    const sql=sqlFor(c);
    const rows=await sql`SELECT e.storage_path,e.evidence_type,e.company_id,e.task_id,t.assignee_supplier_id
      FROM public.task_evidence e JOIN public.operational_tasks t ON t.id=e.task_id AND t.company_id=e.company_id
      WHERE e.id=${c.req.param('id')}::uuid LIMIT 1`;
    if(!rows[0])return jsonError(c,'فایل پیدا نشد.',404);
    const item=rows[0] as {storage_path:string|null;evidence_type:string;company_id:string;task_id:string;assignee_supplier_id:string|null};
    if(!item.storage_path)return jsonError(c,'این مدرک فایل پیوست ندارد.',404);
    const membership=await operationMembership(sql,user.id,item.company_id);
    if(!membership||!['owner','admin','staff','supplier'].includes(membership.role))return jsonError(c,'به این فایل دسترسی نداری.',403);
    if(membership.role==='supplier'&&item.assignee_supplier_id!==membership.supplier_id)return jsonError(c,'به این فایل دسترسی نداری.',403);
    const object=await c.env.EVIDENCE_BUCKET.get(item.storage_path);
    if(!object)return jsonError(c,'فایل در ذخیره‌سازی پیدا نشد.',404);
    const filename=item.storage_path.split('/').pop()||'evidence';
    return new Response(object.body,{headers:evidenceFileHeaders(object.httpMetadata?.contentType||'application/octet-stream',filename)});
  }catch{return jsonError(c,'دریافت فایل انجام نشد.',500);}
});
app.get('/api/operations/partnership-agreements/:id/document', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'ابتدا وارد حساب شو.',401);
  const companyId=c.req.query('companyId')||'';
  if(!validUuid(companyId)||!validUuid(c.req.param('id')))return jsonError(c,'شناسه مجموعه یا قرارداد معتبر نیست.',400);
  if(!c.env.EVIDENCE_BUCKET)return jsonError(c,'ذخیره‌سازی فایل R2 پیکربندی نشده است.',503);
  try{
    const sql=sqlFor(c);
    const rows=await sql`SELECT supplier_id,signed_document_path FROM public.partnership_agreements WHERE id=${c.req.param('id')}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    if(!rows[0])return jsonError(c,'قرارداد پیدا نشد.',404);
    const item=rows[0] as {supplier_id:string;signed_document_path:string|null};
    if(!item.signed_document_path)return jsonError(c,'برای این قرارداد فایل امضاشده ثبت نشده است.',404);
    const membership=await operationMembership(sql,user.id,companyId);
    if(!membership||(!['owner','admin'].includes(membership.role)&&!(membership.role==='supplier'&&membership.supplier_id===item.supplier_id)))return jsonError(c,'به سند این قرارداد دسترسی نداری.',403);
    const object=await c.env.EVIDENCE_BUCKET.get(item.signed_document_path);
    if(!object)return jsonError(c,'فایل قرارداد در فضای ذخیره‌سازی پیدا نشد.',404);
    return new Response(object.body,{headers:evidenceFileHeaders(object.httpMetadata?.contentType||'application/octet-stream',item.signed_document_path.split('/').pop()||'agreement')});
  }catch{return jsonError(c,'دریافت سند قرارداد انجام نشد.',500);}
});
app.post('/api/operations/partnership-agreements/:id/document', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'ابتدا وارد حساب شو.',401);
  const companyId=c.req.query('companyId')||'';
  if(!validUuid(companyId)||!validUuid(c.req.param('id')))return jsonError(c,'شناسه مجموعه یا قرارداد معتبر نیست.',400);
  if(!c.env.EVIDENCE_BUCKET)return jsonError(c,'ذخیره‌سازی فایل R2 پیکربندی نشده است.',503);
  let form:FormData;
  try{form=await c.req.formData();}catch{return jsonError(c,'فایل قرارداد معتبر نیست.',400);}
  const value=form.get('file'),file=value instanceof File&&value.size>0?value:null;
  if(!file)return jsonError(c,'فایل قرارداد را انتخاب کن.',400);
  if(file.size>10*1024*1024||!['application/pdf','image/jpeg','image/png'].includes(file.type))return jsonError(c,'فقط PDF، JPG و PNG تا ۱۰ مگابایت مجاز است.',413);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!['owner','admin'].includes(membership.role))return jsonError(c,'فقط مالک یا مدیر می‌تواند قرارداد امضاشده را ثبت کند.',403);
    const rows=await sql`SELECT id,supplier_id,status,supersedes_agreement_id FROM public.partnership_agreements WHERE id=${c.req.param('id')}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    if(!rows[0])return jsonError(c,'قرارداد پیدا نشد.',404);
    const agreement=rows[0] as {id:string;supplier_id:string;status:string;supersedes_agreement_id:string|null};
    if(!['draft','pending_signature'].includes(agreement.status))return jsonError(c,'فقط قرارداد پیش‌نویس یا در انتظار امضا قابل فعال‌سازی است.',409);
    const active=await sql`SELECT id FROM public.partnership_agreements WHERE company_id=${companyId}::uuid AND supplier_id=${agreement.supplier_id}::uuid AND status='active' LIMIT 1`;
    if(active.length&&active[0].id!==agreement.supersedes_agreement_id)return jsonError(c,'برای این تأمین‌کننده قرارداد فعال دیگری وجود دارد؛ قرارداد قبلی را به‌عنوان جایگزین مشخص کن.',409);
    const filename=safeUploadName(file.name),key=`${companyId}/contracts/${agreement.supplier_id}/${crypto.randomUUID()}-${filename}`;
    await c.env.EVIDENCE_BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type},customMetadata:{companyId,agreementId:agreement.id,uploaderId:user.id,originalName:filename}});
    try{
      const updated=await sql`WITH superseded AS (
        UPDATE public.partnership_agreements SET status='superseded',updated_at=now()
        WHERE id=${agreement.supersedes_agreement_id}::uuid AND company_id=${companyId}::uuid AND supplier_id=${agreement.supplier_id}::uuid AND status='active'
        RETURNING id
      ), activated AS (
        UPDATE public.partnership_agreements SET signed_document_path=${key},signed_at=now(),status='active',approved_by=${user.id}::uuid,approved_at=now(),updated_at=now()
        WHERE id=${agreement.id}::uuid AND company_id=${companyId}::uuid AND status IN ('draft','pending_signature')
          AND (${agreement.supersedes_agreement_id}::uuid IS NULL OR EXISTS (SELECT 1 FROM superseded))
        RETURNING id,status,signed_document_path,signed_at
      ) SELECT * FROM activated`;
      if(!updated[0]){await c.env.EVIDENCE_BUCKET.delete(key).catch(()=>undefined);return jsonError(c,'فعال‌سازی قرارداد به دلیل وضعیت قرارداد قبلی انجام نشد.',409);}
      await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
        VALUES(${user.id}::uuid,'partnership.agreement.activated','partnership_agreement',${agreement.id},jsonb_build_object('company_id',${companyId}))`;
      return c.json({agreement:updated[0]});
    }catch(error){await c.env.EVIDENCE_BUCKET.delete(key).catch(()=>undefined);throw error;}
  }catch{return jsonError(c,'ثبت سند قرارداد انجام نشد.',500);}
});
app.get('/api/operations/:kind', async c => {
  let user: AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای مشاهده عملیات ابتدا وارد حساب شو.',401);
  const kind=c.req.param('kind') as OperationKind;
  const config=operationConfigs[kind];
  if(!config)return jsonError(c,'بخش عملیاتی پیدا نشد.',404);
  const companyId=c.req.query('companyId')||'';
  if(!validUuid(companyId))return jsonError(c,'شناسه مجموعه معتبر نیست.',400);
  try{
    const sql=sqlFor(c);
    const membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!['owner','admin','staff','supplier'].includes(membership.role))return jsonError(c,'به این بخش عملیاتی دسترسی نداری.',403);
    const manager=['owner','admin'].includes(membership.role);
    if(config.managerOnly&&!manager&&membership.role!=='supplier')return jsonError(c,'این بخش فقط برای مالک، مدیر یا شریک تأمین‌کننده مجاز است.',403);
    if(kind==='task-templates'&&!manager)return jsonError(c,'مدیریت دستورالعمل‌ها فقط برای مالک یا مدیر مجاز است.',403);
    const params:unknown[]=[companyId];
    let where='company_id=$1';
    if(membership.role==='supplier'){
      const supplierId=membership.supplier_id;
      const filter=supplierReadFilters[kind];
      if(!supplierId||!filter){where+=' AND false';}
      else{params.push(supplierId);where+=' AND '+filter;}
    }
    const main=await queryRows(sql,`SELECT * FROM public.${config.table} WHERE ${where} ORDER BY created_at DESC NULLS LAST LIMIT 200`,params);
    const supplierParams:unknown[]=[companyId];
    let supplierFilter='company_id=$1';
    if(membership.role==='supplier'&&membership.supplier_id){supplierParams.push(membership.supplier_id);supplierFilter+=' AND id=$2';}
    const [suppliers,sites,batches,templates,agreements,financeEntries,products]=await Promise.all([
      queryRows(sql,`SELECT id,name,city,active FROM public.suppliers WHERE ${supplierFilter} ORDER BY name LIMIT 300`,supplierParams),
      queryRows(sql,`SELECT id,site_code,name,supplier_id,active FROM public.farm_sites WHERE ${membership.role==='supplier'&&membership.supplier_id?'company_id=$1 AND supplier_id=$2':'company_id=$1'} ORDER BY name LIMIT 300`,membership.role==='supplier'&&membership.supplier_id?[companyId,membership.supplier_id]:[companyId]),
      queryRows(sql,`SELECT id,batch_code,farm_site_id,supplier_id,status,production_kind,unit FROM public.production_batches WHERE ${membership.role==='supplier'&&membership.supplier_id?'company_id=$1 AND supplier_id=$2':'company_id=$1'} ORDER BY created_at DESC LIMIT 300`,membership.role==='supplier'&&membership.supplier_id?[companyId,membership.supplier_id]:[companyId]),
      membership.role==='supplier'?Promise.resolve([]):queryRows(sql,`SELECT id,template_code,version,title,instructions,category,priority,evidence_required,expected_evidence_types,status FROM public.task_templates WHERE company_id=$1 AND (status='approved' OR $2::text IN ('owner','admin')) ORDER BY created_at DESC LIMIT 200`,[companyId,membership.role]),
      queryRows(sql,`SELECT id,supplier_id,agreement_code,version,status,effective_from,effective_to,shared_expense_categories,settlement_basis,company_profit_share_pct,partner_profit_share_pct FROM public.partnership_agreements WHERE ${membership.role==='supplier'&&membership.supplier_id?'company_id=$1 AND supplier_id=$2':'company_id=$1'} ORDER BY created_at DESC LIMIT 200`,membership.role==='supplier'&&membership.supplier_id?[companyId,membership.supplier_id]:[companyId]),
      queryRows(sql,`SELECT id,agreement_id,supplier_id,entry_type,status,amount,paid_amount,external_reference,recognized_on FROM public.partner_financial_entries WHERE ${membership.role==='supplier'&&membership.supplier_id?'company_id=$1 AND supplier_id=$2':'company_id=$1'} ORDER BY created_at DESC LIMIT 300`,membership.role==='supplier'&&membership.supplier_id?[companyId,membership.supplier_id]:[companyId]),
      queryRows(sql,`SELECT id,name,sku FROM public.products WHERE company_id=$1 ORDER BY name LIMIT 300`,[companyId]),
    ]);
    return c.json({rows:main,refs:{suppliers,sites,batches,templates,agreements,financeEntries,products}});
  }catch{return jsonError(c,'خواندن عملیات انجام نشد. طرح دیتابیس و دسترسی مجموعه را بررسی کن.',500);}
});
app.post('/api/operations/settlements', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای ایجاد دوره تسویه ابتدا وارد حساب شو.',401);
  let data:Record<string,unknown>;
  try{data=await c.req.json();}catch{return jsonError(c,'بدنه درخواست معتبر نیست.',400);}
  const companyId=typeof data.companyId==='string'?data.companyId:'';
  const agreementId=typeof data.agreementId==='string'?data.agreementId:'';
  const periodStart=typeof data.periodStart==='string'?data.periodStart:'';
  const periodEnd=typeof data.periodEnd==='string'?data.periodEnd:'';
  if(!validUuid(companyId)||!validUuid(agreementId)||!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)||!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)||periodEnd<periodStart)return jsonError(c,'قرارداد و بازه زمانی معتبر را انتخاب کن.',400);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!['owner','admin'].includes(membership.role))return jsonError(c,'ایجاد دوره تسویه فقط برای مالک یا مدیر مجاز است.',403);
    const rows=await sql`SELECT public.medar_create_partner_settlement_period(${user.id}::uuid,${agreementId}::uuid,${periodStart}::date,${periodEnd}::date) AS id`;
    const id=String((rows[0] as {id:string}).id);
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,'settlement.period.created','partner_settlement_period',${id},jsonb_build_object('company_id',${companyId},'agreement_id',${agreementId},'period_start',${periodStart},'period_end',${periodEnd}))`;
    return c.json({id},201);
  }catch(error){const message=error instanceof Error?error.message:'';if(message.includes('هم‌پوشانی'))return jsonError(c,message,409);return jsonError(c,message||'ایجاد دوره تسویه انجام نشد.',400);}
});

app.post('/api/operations/:kind/:id/action', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای اجرای عملیات ابتدا وارد حساب شو.',401);
  const kind=c.req.param('kind') as OperationKind,id=c.req.param('id');
  const config=operationConfigs[kind];
  if(!config||!validUuid(id))return jsonError(c,'بخش یا شناسه رکورد معتبر نیست.',400);
  let data:Record<string,unknown>;
  try{data=await c.req.json();}catch{return jsonError(c,'بدنه درخواست معتبر نیست.',400);}
  const companyId=typeof data.companyId==='string'?data.companyId:'';
  const action=typeof data.action==='string'?data.action:'';
  if(!validUuid(companyId))return jsonError(c,'شناسه مجموعه معتبر نیست.',400);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership)return jsonError(c,'عضویت فعال در این مجموعه پیدا نشد.',403);
    if(kind==='partner-settlements'){
      if(!['owner','admin'].includes(membership.role))return jsonError(c,'تغییر دوره تسویه فقط برای مالک یا مدیر مجاز است.',403);
      if(action==='refresh')await sql`SELECT public.medar_refresh_partner_settlement_period(${user.id}::uuid,${id}::uuid)`;
      else if(action==='approve')await sql`SELECT public.medar_approve_partner_settlement_period(${user.id}::uuid,${id}::uuid)`;
      else if(action==='pay'){
        const amount=Number(data.amount),reference=typeof data.paymentReference==='string'?data.paymentReference.trim():'';
        if(!Number.isFinite(amount)||amount<=0||reference.length<2)return jsonError(c,'مبلغ و مرجع پرداخت واقعی لازم است.',400);
        await sql`SELECT public.medar_record_partner_settlement_payment(${user.id}::uuid,${id}::uuid,${amount},${reference},now())`;
      }else return jsonError(c,'عملیات دوره تسویه پشتیبانی نمی‌شود.',400);
      await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
        VALUES(${user.id}::uuid,${'settlement.'+action},'partner_settlement_period',${id},jsonb_build_object('company_id',${companyId}))`;
      const updated=await sql`SELECT * FROM public.partner_settlement_periods WHERE id=${id}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
      return c.json({row:updated[0]});
    }
    const rows=await queryRows(sql,`SELECT * FROM public.${config.table} WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1`,[id,companyId]);
    if(!rows[0])return jsonError(c,'رکورد پیدا نشد.',404);
    const row=rows[0];
    const manager=['owner','admin'].includes(membership.role);
    const internal=['owner','admin','staff'].includes(membership.role);
    if(kind==='operational-tasks'){
      const assigneeUser=String(row.assignee_user_id??'')===user.id;
      const assigneeSupplier=membership.role==='supplier'&&Boolean(membership.supplier_id)&&String(row.assignee_supplier_id??'')===membership.supplier_id;
      if(!internal&&!assigneeSupplier)return jsonError(c,'این وظیفه به شما تخصیص داده نشده است.',403);
      if(membership.role==='staff'&&!assigneeUser)return jsonError(c,'این وظیفه به شما تخصیص داده نشده است.',403);
      if(action==='start'){
        if(!['pending','rejected','blocked'].includes(String(row.status)))return jsonError(c,'فقط وظیفه در انتظار یا نیازمند اصلاح قابل شروع است.',409);
        await sql`UPDATE public.operational_tasks SET status='in_progress',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(action==='submit'){
        if(String(row.status)!=='in_progress')return jsonError(c,'فقط وظیفه در حال اجرا قابل ارسال است.',409);
        const note=typeof data.completionNote==='string'?data.completionNote.trim().slice(0,2000):'';
        await sql`UPDATE public.operational_tasks SET status='submitted',submitted_at=now(),completion_note=${note||null},updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(action==='review'){
        if(!manager)return jsonError(c,'بازبینی وظیفه فقط برای مالک یا مدیر مجاز است.',403);
        if(String(row.status)!=='submitted')return jsonError(c,'فقط وظیفه ارسال‌شده قابل بازبینی است.',409);
        const decision=data.decision,note=typeof data.reviewNote==='string'?data.reviewNote.trim().slice(0,2000):'';
        if(decision!=='approved'&&decision!=='rejected')return jsonError(c,'نتیجه بازبینی معتبر نیست.',400);
        if(decision==='rejected'&&note.length<2)return jsonError(c,'برای رد وظیفه دلیل لازم است.',400);
        await sql`UPDATE public.operational_tasks SET status=${decision},reviewed_by=${user.id}::uuid,reviewed_at=now(),review_note=${note||null},updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else return jsonError(c,'عملیات وظیفه پشتیبانی نمی‌شود.',400);
    }else if(kind==='task-templates'&&action==='approve-template'){
      if(!manager)return jsonError(c,'تأیید دستورالعمل فقط برای مالک یا مدیر مجاز است.',403);
      if(String(row.status)!=='draft')return jsonError(c,'فقط نسخه پیش‌نویس قابل تأیید است.',409);
      await sql`UPDATE public.task_templates SET status='approved',approved_by=${user.id}::uuid,approved_at=now(),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
    }else if(kind==='production-batches'&&action==='start-batch'){
      if(!internal)return jsonError(c,'شروع تولید برای این نقش مجاز نیست.',403);
      if(String(row.status)!=='planned')return jsonError(c,'فقط بچ برنامه‌ریزی‌شده قابل شروع است.',409);
      await sql`UPDATE public.production_batches SET status='active',started_on=COALESCE(started_on,current_date),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
    }else if(kind==='incidents'&&(action==='resolve-incident'||action==='investigate')){
      if(!internal)return jsonError(c,'تغییر وضعیت رخداد برای این نقش مجاز نیست.',403);
      if(action==='investigate'){
        if(!manager)return jsonError(c,'شروع بررسی رخداد فقط برای مالک یا مدیر مجاز است.',403);
        if(String(row.status)!=='open')return jsonError(c,'فقط رخداد باز قابل بررسی است.',409);
        await sql`UPDATE public.operational_incidents SET status='investigating',updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else{
        if(!['open','investigating','action_required'].includes(String(row.status)))return jsonError(c,'این رخداد قبلاً بسته شده یا در وضعیت قابل حل نیست.',409);
        const note=typeof data.resolutionNote==='string'?data.resolutionNote.trim().slice(0,2000):'';
        if(note.length<2)return jsonError(c,'شرح اقدام اصلاحی لازم است.',400);
        await sql`UPDATE public.operational_incidents SET status='resolved',resolution_note=${note},resolved_by=${user.id}::uuid,resolved_at=now(),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }
    }else if(kind==='partnership-agreements'&&['submit-for-signature','suspend-agreement','reactivate-agreement'].includes(action)){
      if(!manager)return jsonError(c,'تغییر وضعیت قرارداد فقط برای مالک یا مدیر مجاز است.',403);
      if(action==='submit-for-signature'){
        if(String(row.status)!=='draft')return jsonError(c,'فقط قرارداد پیش‌نویس قابل ارسال برای امضا است.',409);
        await sql`UPDATE public.partnership_agreements SET status='pending_signature',updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(action==='suspend-agreement'){
        if(String(row.status)!=='active')return jsonError(c,'فقط قرارداد فعال قابل تعلیق است.',409);
        await sql`UPDATE public.partnership_agreements SET status='suspended',updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else{
        if(String(row.status)!=='suspended'||!row.signed_document_path||!row.signed_at||!row.approved_by||!row.approved_at)return jsonError(c,'قرارداد فاقد سند امضا یا تأیید معتبر است.',409);
        const other=await sql`SELECT id FROM public.partnership_agreements WHERE company_id=${companyId}::uuid AND supplier_id=${String(row.supplier_id)}::uuid AND status='active' AND id<>${id}::uuid LIMIT 1`;
        if(other.length)return jsonError(c,'برای این تأمین‌کننده قرارداد فعال دیگری وجود دارد.',409);
        await sql`UPDATE public.partnership_agreements SET status='active',updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }
    }else if(kind==='partner-finance'&&action==='finance-transition'){
      const next=typeof data.nextStatus==='string'?data.nextStatus:'';
      if(!manager)return jsonError(c,'تغییر وضعیت سند مالی فقط برای مالک یا مدیر مجاز است.',403);
      const current=String(row.status);
      if(next==='submitted'){
        if(current!=='draft')return jsonError(c,'فقط سند پیش‌نویس قابل ارسال است.',409);
        await sql`UPDATE public.partner_financial_entries SET status='submitted',submitted_by=${user.id}::uuid,submitted_at=now(),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(next==='approved'){
        if(current!=='submitted')return jsonError(c,'فقط سند ارسال‌شده قابل تأیید است.',409);
        await sql`UPDATE public.partner_financial_entries SET status='approved',approved_by=${user.id}::uuid,approved_at=now(),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(next==='rejected'){
        if(!['draft','submitted','approved'].includes(current))return jsonError(c,'این سند در وضعیت فعلی قابل رد نیست.',409);
        await sql`UPDATE public.partner_financial_entries SET status='rejected',updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(next==='draft'){
        if(current!=='rejected')return jsonError(c,'فقط سند ردشده را می‌توان به پیش‌نویس برگرداند.',409);
        await sql`UPDATE public.partner_financial_entries SET status='draft',submitted_by=NULL,submitted_at=NULL,approved_by=NULL,approved_at=NULL,posted_by=NULL,posted_at=NULL,updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(next==='posted'){
        if(current!=='approved')return jsonError(c,'فقط سند تأییدشده قابل ثبت نهایی است.',409);
        if(['sale_collection','partner_advance','settlement_payment'].includes(String(row.entry_type))&&(Number(row.paid_amount)!==Number(row.amount)||String(row.payment_status)!=='paid'||!String(row.external_reference??'').trim()))return jsonError(c,'سند نقدی بدون مبلغ کامل و مرجع پرداخت واقعی ثبت نهایی نمی‌شود.',400);
        await sql`UPDATE public.partner_financial_entries SET status='posted',posted_by=${user.id}::uuid,posted_at=now(),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else return jsonError(c,'گذار وضعیت مالی معتبر نیست.',400);
    }else return jsonError(c,'این عملیات برای این نوع رکورد پشتیبانی نمی‌شود.',400);
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,${'operation.'+action},${config.table},${id},jsonb_build_object('company_id',${companyId}))`;
    const updated=await queryRows(sql,`SELECT * FROM public.${config.table} WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1`,[id,companyId]);
    return c.json({row:updated[0]});
  }catch(error){const message=error instanceof Error?error.message:'';return jsonError(c,message||'عملیات انجام نشد.',400);}
});

app.post('/api/operations/:kind', async c => {
  let user: AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای ثبت عملیات ابتدا وارد حساب شو.',401);
  const kind=c.req.param('kind') as OperationKind,config=operationConfigs[kind];
  if(!config)return jsonError(c,'بخش عملیاتی پیدا نشد.',404);
  if(config.readOnly||kind==='partner-settlements')return jsonError(c,'این بخش فقط از گردش‌کار تأییدشده قابل تغییر است.',405);
  let data:Record<string,unknown>;
  try{data=await c.req.json();}catch{return jsonError(c,'بدنه درخواست معتبر نیست.',400);}
  const companyId=typeof data.company_id==='string'?data.company_id:'';
  if(!validUuid(companyId))return jsonError(c,'شناسه مجموعه معتبر نیست.',400);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||(!['owner','admin','staff'].includes(membership.role)&&!(membership.role==='supplier'&&['daily-production','incidents'].includes(kind))))return jsonError(c,'برای ثبت این عملیات مجوز نداری.',403);
    if(config.managerOnly&&!['owner','admin'].includes(membership.role))return jsonError(c,'ثبت این سند فقط برای مالک یا مدیر مجاز است.',403);
    const serverManaged=new Set(['status','created_by','recorded_by','assigned_by','reported_by','reported_supplier_id','quality_status','direction','paid_amount','payment_status','paid_by','currency','signed_document_path','signed_at','completion_note','review_note','created_at','updated_at']);
    const fields=config.fields.filter(field=>Object.prototype.hasOwnProperty.call(data,field)&&!serverManaged.has(field));
    if(!fields.length)return jsonError(c,'هیچ فیلد قابل ثبت ارسال نشده است.',400);
    const values=fields.map(field=>data[field]);
    const insertFields=['company_id',...fields];
    const insertValues:unknown[]=[companyId,...values];
    const addManaged=(field:string,value:unknown)=>{
      if(config.fields.includes(field)&&!insertFields.includes(field)){insertFields.push(field);insertValues.push(value);}
    };
    if(['farm-sites','flock-cycles','production-batches','task-templates','operational-tasks','incidents','partnership-agreements','partner-finance'].includes(kind)){
      const initialStatus:Record<string,string>={'flock-cycles':'planned','production-batches':'planned','task-templates':'draft','operational-tasks':'pending','incidents':'open','partnership-agreements':'draft','partner-finance':'draft'};
      if(initialStatus[kind])addManaged('status',initialStatus[kind]);
    }
    const creatorColumn=kind==='daily-production'?'recorded_by':kind==='operational-tasks'?'assigned_by':kind==='incidents'?'reported_by':'created_by';
    if(['recorded_by','assigned_by','reported_by','created_by'].includes(creatorColumn)){insertFields.push(creatorColumn);insertValues.push(user.id);}
    if(kind==='production-batches')addManaged('quality_status','not_inspected');
    if(kind==='partner-finance'){
      const entryType=String(data.entry_type||''),amount=Number(data.amount),paidInput=Number(data.paid_amount||0);
      if(!['sale_invoice','sale_collection','expense','partner_advance'].includes(entryType))return jsonError(c,'نوع سند مالی معتبر نیست.',400);
      if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(paidInput)||paidInput<0||paidInput>amount)return jsonError(c,'مبلغ سند یا مبلغ پرداخت‌شده معتبر نیست.',400);
      const paidAmount=['sale_collection','partner_advance'].includes(entryType)?amount:paidInput;
      const paymentStatus=['sale_collection','partner_advance'].includes(entryType)?'paid':paidAmount<=0?(entryType==='expense'?'unpaid':'not_applicable'):paidAmount>=amount?'paid':'partial';
      const paidBy=entryType==='sale_collection'?'customer':entryType==='partner_advance'?(String(data.paid_by||'company')):entryType==='expense'?(String(data.paid_by||'none')):'none';
      const direction=entryType==='sale_collection'?'inflow_to_company':entryType==='partner_advance'?(paidBy==='partner'?'partner_to_company':'company_to_partner'):entryType==='expense'?(paidBy==='company'?'outflow_from_company':'not_cash'):'not_cash';
      if(entryType==='partner_advance'&&!['company','partner'].includes(paidBy))return jsonError(c,'پیش‌پرداخت باید به‌عنوان پرداخت شرکت یا شریک مشخص شود.',400);
      if(entryType==='expense'&&!String(data.expense_category||'').trim())return jsonError(c,'برای هزینه، دسته هزینه لازم است.',400);
      if(['sale_collection','partner_advance'].includes(entryType)&&!String(data.external_reference||'').trim())return jsonError(c,'شماره رسید یا مرجع واقعی لازم است.',400);
      if(entryType==='sale_collection'){
        const linked=await queryRows(sql,`SELECT id FROM public.partner_financial_entries WHERE id=$1::uuid AND company_id=$2::uuid AND entry_type='sale_invoice' AND status IN ('approved','posted') LIMIT 1`,[data.linked_entry_id,companyId]);
        if(!linked.length)return jsonError(c,'دریافت فروش باید به فاکتور تأییدشده همین مجموعه متصل باشد.',400);
      }
      if(entryType==='expense'&&data.is_shared_cost===true){
        const agreementRows=await queryRows(sql,`SELECT shared_expense_categories FROM public.partnership_agreements WHERE id=$1::uuid AND company_id=$2::uuid AND supplier_id=$3::uuid LIMIT 1`,[data.agreement_id,companyId,data.supplier_id]);
        const allowed=Array.isArray(agreementRows[0]?.shared_expense_categories)?agreementRows[0].shared_expense_categories as unknown[]:[];
        if(!allowed.map(String).includes(String(data.expense_category)))return jsonError(c,'این دسته هزینه در قرارداد به‌عنوان هزینه مشترک تعیین نشده است.',400);
      }
      addManaged('paid_amount',paidAmount);addManaged('payment_status',paymentStatus);addManaged('direction',direction);addManaged('paid_by',paidBy);addManaged('currency','TOMAN');
    }
    if(kind==='farm-sites'){const lat=data.latitude===null||data.latitude===''||data.latitude===undefined?null:Number(data.latitude);const lon=data.longitude===null||data.longitude===''||data.longitude===undefined?null:Number(data.longitude);if((lat===null)!==(lon===null)||(lat!==null&&(!Number.isFinite(lat)||lat < -90||lat > 90))||(lon!==null&&(!Number.isFinite(lon)||lon < -180||lon > 180)))return jsonError(c,'عرض و طول جغرافیایی باید با هم و در محدوده معتبر وارد شوند.',400);}
    if(kind==='partnership-agreements'){
      const companyShare=Number(data.company_profit_share_pct),partnerShare=Number(data.partner_profit_share_pct);
      if(Math.abs(companyShare+partnerShare-100)>0.0001)return jsonError(c,'مجموع سهم شرکت و شریک باید ۱۰۰ درصد باشد.',400);
      if(!Array.isArray(data.shared_expense_categories)||!data.shared_expense_categories.length)return jsonError(c,'حداقل یک دسته هزینه مشترک انتخاب کن.',400);
    }
    const relationTables:Record<string,string>={supplier_id:'suppliers',assignee_supplier_id:'suppliers',farm_site_id:'farm_sites',batch_id:'production_batches',template_id:'task_templates',agreement_id:'partnership_agreements',flock_cycle_id:'flock_cycles',product_id:'products',lot_id:'lots',task_id:'operational_tasks',supersedes_agreement_id:'partnership_agreements',linked_entry_id:'partner_financial_entries'};
    for(const [field,table] of Object.entries(relationTables)){
      if(data[field]!==undefined&&data[field]!==null&&data[field]!==''){
        if(!await sameCompanyRow(sql,table,data[field],companyId))return jsonError(c,'ارجاع «'+field+'» پیدا نشد یا متعلق به این مجموعه نیست.',400);
      }
    }
    if(data.assignee_user_id){
      const assignee=await sql`SELECT id FROM public.memberships WHERE company_id=${companyId}::uuid AND user_id=${String(data.assignee_user_id)}::uuid AND active=true AND role::text IN ('owner','admin','staff') LIMIT 1`;
      if(!assignee.length)return jsonError(c,'مسئول وظیفه عضو فعال همین مجموعه نیست.',400);
    }
    if(kind==='operational-tasks'&&!data.assignee_user_id&&!data.assignee_supplier_id)return jsonError(c,'برای وظیفه باید یک مسئول داخلی یا تأمین‌کننده تعیین شود.',400);
    if(kind==='production-batches'&&data.farm_site_id){
      const siteRows=await queryRows(sql,'SELECT supplier_id FROM public.farm_sites WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1',[data.farm_site_id,companyId]);
      if(!siteRows.length)return jsonError(c,'مزرعه انتخاب‌شده متعلق به این مجموعه نیست.',400);
      const siteSupplier=(siteRows[0] as {supplier_id:string|null}).supplier_id;
      if(siteSupplier&&data.supplier_id&&siteSupplier!==data.supplier_id)return jsonError(c,'تأمین‌کننده بچ باید با تأمین‌کننده مزرعه هماهنگ باشد.',400);
      if(siteSupplier)addManaged('supplier_id',siteSupplier);
    }
    if(kind==='daily-production'&&membership.role==='supplier'){
      if(!membership.supplier_id)return jsonError(c,'این حساب به پروفایل تأمین‌کننده متصل نیست.',403);
      const batch=await queryRows(sql,'SELECT id FROM public.production_batches WHERE id=$1::uuid AND company_id=$2::uuid AND supplier_id=$3::uuid LIMIT 1',[data.batch_id,companyId,membership.supplier_id]);
      if(!batch.length)return jsonError(c,'ثبت تولید فقط برای بچ‌های همین تأمین‌کننده مجاز است.',403);
    }
    if(kind==='incidents'){
      let reportSupplier:string|null=null;
      if(membership.role==='supplier'){
        if(!membership.supplier_id)return jsonError(c,'این حساب به پروفایل تأمین‌کننده متصل نیست.',403);
        const siteOk=data.farm_site_id?await queryRows(sql,'SELECT id FROM public.farm_sites WHERE id=$1::uuid AND company_id=$2::uuid AND supplier_id=$3::uuid LIMIT 1',[data.farm_site_id,companyId,membership.supplier_id]):[];
        const batchOk=data.batch_id?await queryRows(sql,'SELECT id FROM public.production_batches WHERE id=$1::uuid AND company_id=$2::uuid AND supplier_id=$3::uuid LIMIT 1',[data.batch_id,companyId,membership.supplier_id]):[];
        if(!siteOk.length&&!batchOk.length)return jsonError(c,'گزارش رخداد باید به مزرعه یا بچ همین تأمین‌کننده متصل باشد.',403);
        reportSupplier=membership.supplier_id;
      }else if(data.farm_site_id){
        const site=await queryRows(sql,'SELECT supplier_id FROM public.farm_sites WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1',[data.farm_site_id,companyId]);
        if(site.length)reportSupplier=(site[0] as {supplier_id:string|null}).supplier_id;
      }else if(data.batch_id){
        const batch=await queryRows(sql,'SELECT supplier_id FROM public.production_batches WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1',[data.batch_id,companyId]);
        if(batch.length)reportSupplier=(batch[0] as {supplier_id:string|null}).supplier_id;
      }
      addManaged('reported_supplier_id',reportSupplier);
    }
    const placeholders=insertValues.map((_,index)=>'$'+(index+1)).join(',');
    const query=`INSERT INTO public.${config.table} (${insertFields.join(',')}) VALUES (${placeholders}) RETURNING *`;
    const result=await queryRows(sql,query,insertValues);
    const row=result[0];
    if(!row)return jsonError(c,'ثبت رکورد انجام نشد.',500);
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,'operation.created',${config.table},${String(row.id)},jsonb_build_object('company_id',${companyId},'kind',${kind}))`;
    return c.json({row},201);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(message.includes('duplicate key')||message.includes('unique constraint'))return jsonError(c,'کد یا رکورد تکراری است.',409);
    if(message.includes('foreign key'))return jsonError(c,'یکی از ارجاع‌ها متعلق به این مجموعه نیست.',400);
    return jsonError(c,'ثبت عملیات انجام نشد. داده‌ها و محدودیت‌های عملیاتی را بررسی کن.',400);
  }
});
app.post('/api/operations/:kind/:id/update', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای ویرایش عملیات ابتدا وارد حساب شو.',401);
  const kind=c.req.param('kind') as OperationKind,config=operationConfigs[kind];
  if(!config||config.readOnly||kind==='partner-settlements')return jsonError(c,'این بخش فقط از گردش‌کار اختصاصی قابل تغییر است.',405);
  let data:Record<string,unknown>;
  try{data=await c.req.json();}catch{return jsonError(c,'بدنه درخواست معتبر نیست.',400);}
  const companyId=typeof data.companyId==='string'?data.companyId:'';
  if(!validUuid(companyId)||!validUuid(c.req.param('id')))return jsonError(c,'شناسه مجموعه یا رکورد معتبر نیست.',400);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!['owner','admin','staff'].includes(membership.role))return jsonError(c,'برای ویرایش این عملیات مجوز نداری.',403);
    if(config.managerOnly&&!['owner','admin'].includes(membership.role))return jsonError(c,'ویرایش این سند فقط برای مالک یا مدیر مجاز است.',403);
    const blocked=new Set(['id','company_id','created_by','created_at','updated_at','recorded_by','assigned_by','reported_by','reviewed_by','reviewed_at','status','paid_amount','payment_status','posted_by','posted_at','approved_by','approved_at','settled_by','settled_at']);
    const fields=config.fields.filter(field=>Object.prototype.hasOwnProperty.call(data,field)&&!blocked.has(field));
    if(!fields.length)return jsonError(c,'هیچ فیلد قابل ویرایش ارسال نشده است.',400);
    const values=fields.map(field=>data[field]);
    const setClause=fields.map((field,index)=>field+'=$'+(index+1)).join(',');
    const params=[...values,companyId,c.req.param('id')];
    const query=`UPDATE public.${config.table} SET ${setClause},updated_at=now() WHERE company_id=$${values.length+1}::uuid AND id=$${values.length+2}::uuid RETURNING *`;
    const result=await queryRows(sql,query,params);
    if(!result[0])return jsonError(c,'رکورد پیدا نشد یا اجازه ویرایش آن را نداری.',404);
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,'operation.updated',${config.table},${c.req.param('id')},jsonb_build_object('company_id',${companyId},'fields',${fields}))`;
    return c.json({row:result[0]});
  }catch{return jsonError(c,'ویرایش عملیات انجام نشد.',400);}
});
app.notFound(c => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ message:'مسیر پیدا نشد.' },404));
export default app;
);
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
    const rows = await sql`SELECT m.id,m.company_id,m.user_id,m.role::text AS role,m.customer_id,m.supplier_id,m.active,json_build_object('name',co.name) AS company
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
        u.username,u.display_name AS full_name,u.phone_e164 AS phone
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
    let customerId:string|null=null,supplierId:string|null=null;
    if (decision === 'approve') {
      if (!['customer','supplier','driver','staff'].includes(item.role)) return jsonError(c, 'نقش درخواستی قابل تأیید نیست.', 400);
      if(item.role==='customer'){
        customerId=typeof data.customerId==='string'?data.customerId:'';
        if(!validUuid(customerId))return jsonError(c,'برای تأیید مشتری باید حساب مشتری همین مجموعه انتخاب شود.',400);
        const linked=await sql`SELECT id FROM public.customers WHERE id=${customerId}::uuid AND company_id=${item.company_id}::uuid LIMIT 1`;
        if(!linked.length)return jsonError(c,'حساب مشتری متعلق به این مجموعه نیست.',400);
      }else if(item.role==='supplier'){
        supplierId=typeof data.supplierId==='string'?data.supplierId:'';
        if(!validUuid(supplierId))return jsonError(c,'برای تأیید تأمین‌کننده باید حساب تأمین‌کننده همین مجموعه انتخاب شود.',400);
        const linked=await sql`SELECT id FROM public.suppliers WHERE id=${supplierId}::uuid AND company_id=${item.company_id}::uuid LIMIT 1`;
        if(!linked.length)return jsonError(c,'حساب تأمین‌کننده متعلق به این مجموعه نیست.',400);
      }
      await sql`INSERT INTO public.memberships(company_id,user_id,role,active,created_by,customer_id,supplier_id)
        VALUES(${item.company_id}::uuid,${item.user_id}::uuid,${item.role}::public.app_role,true,${user.id}::uuid,${customerId}::uuid,${supplierId}::uuid)
        ON CONFLICT(company_id,user_id,role) DO UPDATE SET active=true,created_by=EXCLUDED.created_by,customer_id=EXCLUDED.customer_id,supplier_id=EXCLUDED.supplier_id`;
    }
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await sql`UPDATE public.access_requests SET status=${status},customer_id=${customerId}::uuid,supplier_id=${supplierId}::uuid,reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now()
      WHERE id=${item.id}::uuid`;
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,${decision === 'approve' ? 'access.approved' : 'access.rejected'},'access_request',${item.id},jsonb_build_object('company_id',${item.company_id},'role',${item.role}))`;
    return c.json({ ok:true,status });
  } catch { return jsonError(c, 'بررسی درخواست انجام نشد.', 500); }
});
type OperationKind = 'farm-sites'|'flock-cycles'|'production-batches'|'daily-production'|'task-templates'|'operational-tasks'|'incidents'|'partnership-agreements'|'partner-finance'|'partner-settlements';
type OperationConfig = { table:string; fields:string[]; managerOnly?:boolean; readOnly?:boolean };
const operationConfigs: Record<OperationKind,OperationConfig> = {
  'farm-sites': {table:'farm_sites',fields:['site_code','name','site_type','supplier_id','province','city','address','registration_reference','license_expires_on','timezone','active','latitude','longitude']},
  'flock-cycles': {table:'flock_cycles',fields:['farm_site_id','cycle_code','species','arrived_on','planned_end_on','ended_on','initial_bird_count','status','source_reference','notes','cycle_type','initial_quantity','quantity_unit']},
  'production-batches': {table:'production_batches',fields:['farm_site_id','supplier_id','agreement_id','flock_cycle_id','product_id','lot_id','batch_code','production_kind','status','unit','planned_quantity','produced_quantity','rejected_quantity','started_on','expected_on','completed_on','quality_status','manager_notes']},
  'daily-production': {table:'daily_production_records',fields:['batch_id','record_date','shift_label','feed_consumed_kg','mortality_count','eggs_collected','eggs_rejected','produced_quantity','average_weight_grams','note','resource_name','input_quantity','input_unit','loss_quantity','loss_unit','rejected_quantity']},
  'task-templates': {table:'task_templates',fields:['template_code','version','title','instructions','category','priority','evidence_required','expected_evidence_types','status'],managerOnly:true},
  'operational-tasks': {table:'operational_tasks',fields:['farm_site_id','batch_id','template_id','assignee_user_id','assignee_supplier_id','title','instructions_snapshot','category','priority','status','due_at','evidence_required','completion_note']},
  incidents: {table:'operational_incidents',fields:['farm_site_id','batch_id','task_id','reported_supplier_id','severity','category','title','description','status','resolution_note']},
  'partnership-agreements': {table:'partnership_agreements',fields:['supplier_id','agreement_code','version','status','effective_from','effective_to','company_profit_share_pct','partner_profit_share_pct','shared_expense_categories','settlement_basis','settlement_due_days','terms','signed_document_path','signed_at','supersedes_agreement_id'],managerOnly:true},
  'partner-finance': {table:'partner_financial_entries',fields:['supplier_id','agreement_id','entry_type','status','direction','amount','paid_amount','currency','expense_category','is_shared_cost','paid_by','payment_status','recognized_on','external_reference','source_table','source_record_id','linked_entry_id','adjustment_effect','notes'],managerOnly:true},
  'partner-settlements': {table:'partner_settlement_periods',fields:[],managerOnly:true,readOnly:true},
};
const supplierReadFilters: Partial<Record<OperationKind,string>> = {
  'farm-sites':'supplier_id=$2',
  'flock-cycles':'farm_site_id IN (SELECT id FROM public.farm_sites WHERE company_id=$1 AND supplier_id=$2)',
  'production-batches':'supplier_id=$2',
  'daily-production':'batch_id IN (SELECT id FROM public.production_batches WHERE company_id=$1 AND supplier_id=$2)',
  'operational-tasks':'assignee_supplier_id=$2',
  incidents:'(reported_supplier_id=$2 OR farm_site_id IN (SELECT id FROM public.farm_sites WHERE company_id=$1 AND supplier_id=$2) OR batch_id IN (SELECT id FROM public.production_batches WHERE company_id=$1 AND supplier_id=$2))',
  'partnership-agreements':'supplier_id=$2',
  'partner-finance':'supplier_id=$2',
  'partner-settlements':'supplier_id=$2',
};
async function queryRows(sql: ReturnType<typeof neon>, statement: string, params: unknown[] = []): Promise<Record<string,unknown>[]> {
  return await sql.query(statement, params) as Record<string,unknown>[];
}
async function operationMembership(sql: ReturnType<typeof neon>, userId: string, companyId: string) {
  const rows=await sql`SELECT role::text AS role,supplier_id,customer_id FROM public.memberships
    WHERE company_id=${companyId}::uuid AND user_id=${userId}::uuid AND active=true
    ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'staff' THEN 2 WHEN 'supplier' THEN 3 ELSE 4 END LIMIT 1`;
  return rows[0] as {role:string;supplier_id:string|null;customer_id:string|null}|undefined;
}
function validUuid(value: string) { return /^[0-9a-f-]{36}$/i.test(value); }
async function sameCompanyRow(sql: ReturnType<typeof neon>, table: string, id: unknown, companyId: string) {
  if(typeof id!=='string'||!validUuid(id)) return false;
  const rows=await queryRows(sql,`SELECT id FROM public.${table} WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1`,[id,companyId]);
  return rows.length>0;
}
const allowedUploadTypes=new Set(['application/pdf','image/jpeg','image/png','image/webp']);
function safeUploadName(value:string){return value.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-120)||'upload';}
function evidenceFileHeaders(contentType:string,filename:string){
  return {'content-type':contentType,'content-disposition':`attachment; filename="${safeUploadName(filename)}"`,'x-content-type-options':'nosniff','cache-control':'private, no-store'};
}
app.post('/api/operations/operational-tasks/:id/evidence', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای ثبت مدرک ابتدا وارد حساب شو.',401);
  const companyId=c.req.query('companyId')||'';
  if(!validUuid(companyId)||!validUuid(c.req.param('id')))return jsonError(c,'شناسه مجموعه یا وظیفه معتبر نیست.',400);
  let form:FormData;
  try{form=await c.req.formData();}catch{return jsonError(c,'فرم مدرک معتبر نیست.',400);}
  const evidenceType=String(form.get('evidenceType')||'note');
  const note=String(form.get('note')||'').trim().slice(0,2000);
  const measurement=String(form.get('measurement')||'').trim();
  const unit=String(form.get('unit')||'').trim().slice(0,24);
  const fileValue=form.get('file');
  const file=fileValue instanceof File&&fileValue.size>0?fileValue:null;
  if(!['note','measurement','photo','document'].includes(evidenceType))return jsonError(c,'نوع مدرک معتبر نیست.',400);
  if(evidenceType==='note'&&note.length<2)return jsonError(c,'برای مدرک متنی، یادداشت لازم است.',400);
  if(evidenceType==='measurement'&&(!Number.isFinite(Number(measurement))||!unit))return jsonError(c,'مقدار و واحد اندازه‌گیری را کامل کن.',400);
  if(['photo','document'].includes(evidenceType)&&!file)return jsonError(c,'برای عکس یا سند، فایل انتخاب کن.',400);
  if(file&&(file.size>10*1024*1024||!allowedUploadTypes.has(file.type)))return jsonError(c,'فایل باید PDF یا تصویر JPG/PNG/WebP و حداکثر ۱۰ مگابایت باشد.',413);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!['owner','admin','staff','supplier'].includes(membership.role))return jsonError(c,'برای ثبت مدرک این وظیفه مجوز نداری.',403);
    const taskRows=await sql`SELECT id,assignee_supplier_id,assignee_user_id,status FROM public.operational_tasks WHERE id=${c.req.param('id')}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    if(!taskRows[0])return jsonError(c,'وظیفه پیدا نشد.',404);
    const task=taskRows[0] as {id:string;assignee_supplier_id:string|null;assignee_user_id:string|null;status:string};
    if(membership.role==='supplier'&&task.assignee_supplier_id!==membership.supplier_id)return jsonError(c,'این وظیفه به تأمین‌کننده شما تخصیص داده نشده است.',403);
    if(membership.role==='staff'&&task.assignee_user_id!==user.id)return jsonError(c,'این وظیفه به شما تخصیص داده نشده است.',403);
    let path:string|null=null;
    if(file){
      if(!c.env.EVIDENCE_BUCKET)return jsonError(c,'ذخیره‌سازی فایل R2 پیکربندی نشده است.',503);
      const filename=safeUploadName(file.name),key=`${companyId}/evidence/${task.id}/${crypto.randomUUID()}-${filename}`;
      await c.env.EVIDENCE_BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type},customMetadata:{companyId,taskId:task.id,uploaderId:user.id,originalName:filename}});
      path=key;
    }
    try{
      const rows=await sql`INSERT INTO public.task_evidence(company_id,task_id,evidence_type,storage_path,note,measurement_value,measurement_unit,uploaded_by)
        VALUES(${companyId}::uuid,${task.id}::uuid,${evidenceType},${path},${note||null},${evidenceType==='measurement'?Number(measurement):null},${evidenceType==='measurement'?unit:null},${user.id}::uuid)
        RETURNING id,company_id,task_id,evidence_type,storage_path,note,measurement_value,measurement_unit,uploaded_by,captured_at,created_at`;
      await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
        VALUES(${user.id}::uuid,'task.evidence.added','task_evidence',${String((rows[0] as {id:string}).id)},jsonb_build_object('company_id',${companyId},'task_id',${task.id},'evidence_type',${evidenceType}))`;
      return c.json({evidence:rows[0]},201);
    }catch(error){
      if(path&&c.env.EVIDENCE_BUCKET)await c.env.EVIDENCE_BUCKET.delete(path).catch(()=>undefined);
      throw error;
    }
  }catch{return jsonError(c,'ثبت مدرک انجام نشد. وضعیت وظیفه و مهاجرت دیتابیس را بررسی کن.',500);}
});
app.get('/api/operations/operational-tasks/:id/evidence', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'ابتدا وارد حساب شو.',401);
  const companyId=c.req.query('companyId')||'';
  if(!validUuid(companyId)||!validUuid(c.req.param('id')))return jsonError(c,'شناسه مجموعه یا وظیفه معتبر نیست.',400);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!['owner','admin','staff','supplier'].includes(membership.role))return jsonError(c,'به مدارک این وظیفه دسترسی نداری.',403);
    const task=await sql`SELECT id,assignee_supplier_id,assignee_user_id FROM public.operational_tasks WHERE id=${c.req.param('id')}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    if(!task[0])return jsonError(c,'وظیفه پیدا نشد.',404);
    const t=task[0] as {assignee_supplier_id:string|null;assignee_user_id:string|null};
    if(membership.role==='supplier'&&t.assignee_supplier_id!==membership.supplier_id)return jsonError(c,'به مدارک این وظیفه دسترسی نداری.',403);
    const rows=await sql`SELECT id,company_id,task_id,evidence_type,storage_path,note,measurement_value,measurement_unit,uploaded_by,captured_at,created_at FROM public.task_evidence WHERE company_id=${companyId}::uuid AND task_id=${c.req.param('id')}::uuid ORDER BY created_at DESC`;
    return c.json({evidence:rows});
  }catch{return jsonError(c,'خواندن مدارک انجام نشد.',500);}
});
app.get('/api/evidence/:id/download', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'ابتدا وارد حساب شو.',401);
  if(!validUuid(c.req.param('id')))return jsonError(c,'شناسه مدرک معتبر نیست.',400);
  if(!c.env.EVIDENCE_BUCKET)return jsonError(c,'ذخیره‌سازی فایل R2 پیکربندی نشده است.',503);
  try{
    const sql=sqlFor(c);
    const rows=await sql`SELECT e.storage_path,e.evidence_type,e.company_id,e.task_id,t.assignee_supplier_id
      FROM public.task_evidence e JOIN public.operational_tasks t ON t.id=e.task_id AND t.company_id=e.company_id
      WHERE e.id=${c.req.param('id')}::uuid LIMIT 1`;
    if(!rows[0])return jsonError(c,'فایل پیدا نشد.',404);
    const item=rows[0] as {storage_path:string|null;evidence_type:string;company_id:string;task_id:string;assignee_supplier_id:string|null};
    if(!item.storage_path)return jsonError(c,'این مدرک فایل پیوست ندارد.',404);
    const membership=await operationMembership(sql,user.id,item.company_id);
    if(!membership||!['owner','admin','staff','supplier'].includes(membership.role))return jsonError(c,'به این فایل دسترسی نداری.',403);
    if(membership.role==='supplier'&&item.assignee_supplier_id!==membership.supplier_id)return jsonError(c,'به این فایل دسترسی نداری.',403);
    const object=await c.env.EVIDENCE_BUCKET.get(item.storage_path);
    if(!object)return jsonError(c,'فایل در ذخیره‌سازی پیدا نشد.',404);
    const filename=item.storage_path.split('/').pop()||'evidence';
    return new Response(object.body,{headers:evidenceFileHeaders(object.httpMetadata?.contentType||'application/octet-stream',filename)});
  }catch{return jsonError(c,'دریافت فایل انجام نشد.',500);}
});
app.get('/api/operations/partnership-agreements/:id/document', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'ابتدا وارد حساب شو.',401);
  const companyId=c.req.query('companyId')||'';
  if(!validUuid(companyId)||!validUuid(c.req.param('id')))return jsonError(c,'شناسه مجموعه یا قرارداد معتبر نیست.',400);
  if(!c.env.EVIDENCE_BUCKET)return jsonError(c,'ذخیره‌سازی فایل R2 پیکربندی نشده است.',503);
  try{
    const sql=sqlFor(c);
    const rows=await sql`SELECT supplier_id,signed_document_path FROM public.partnership_agreements WHERE id=${c.req.param('id')}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    if(!rows[0])return jsonError(c,'قرارداد پیدا نشد.',404);
    const item=rows[0] as {supplier_id:string;signed_document_path:string|null};
    if(!item.signed_document_path)return jsonError(c,'برای این قرارداد فایل امضاشده ثبت نشده است.',404);
    const membership=await operationMembership(sql,user.id,companyId);
    if(!membership||(!['owner','admin'].includes(membership.role)&&!(membership.role==='supplier'&&membership.supplier_id===item.supplier_id)))return jsonError(c,'به سند این قرارداد دسترسی نداری.',403);
    const object=await c.env.EVIDENCE_BUCKET.get(item.signed_document_path);
    if(!object)return jsonError(c,'فایل قرارداد در فضای ذخیره‌سازی پیدا نشد.',404);
    return new Response(object.body,{headers:evidenceFileHeaders(object.httpMetadata?.contentType||'application/octet-stream',item.signed_document_path.split('/').pop()||'agreement')});
  }catch{return jsonError(c,'دریافت سند قرارداد انجام نشد.',500);}
});
app.post('/api/operations/partnership-agreements/:id/document', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'ابتدا وارد حساب شو.',401);
  const companyId=c.req.query('companyId')||'';
  if(!validUuid(companyId)||!validUuid(c.req.param('id')))return jsonError(c,'شناسه مجموعه یا قرارداد معتبر نیست.',400);
  if(!c.env.EVIDENCE_BUCKET)return jsonError(c,'ذخیره‌سازی فایل R2 پیکربندی نشده است.',503);
  let form:FormData;
  try{form=await c.req.formData();}catch{return jsonError(c,'فایل قرارداد معتبر نیست.',400);}
  const value=form.get('file'),file=value instanceof File&&value.size>0?value:null;
  if(!file)return jsonError(c,'فایل قرارداد را انتخاب کن.',400);
  if(file.size>10*1024*1024||!['application/pdf','image/jpeg','image/png'].includes(file.type))return jsonError(c,'فقط PDF، JPG و PNG تا ۱۰ مگابایت مجاز است.',413);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!['owner','admin'].includes(membership.role))return jsonError(c,'فقط مالک یا مدیر می‌تواند قرارداد امضاشده را ثبت کند.',403);
    const rows=await sql`SELECT id,supplier_id,status,supersedes_agreement_id FROM public.partnership_agreements WHERE id=${c.req.param('id')}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
    if(!rows[0])return jsonError(c,'قرارداد پیدا نشد.',404);
    const agreement=rows[0] as {id:string;supplier_id:string;status:string;supersedes_agreement_id:string|null};
    if(!['draft','pending_signature'].includes(agreement.status))return jsonError(c,'فقط قرارداد پیش‌نویس یا در انتظار امضا قابل فعال‌سازی است.',409);
    const active=await sql`SELECT id FROM public.partnership_agreements WHERE company_id=${companyId}::uuid AND supplier_id=${agreement.supplier_id}::uuid AND status='active' LIMIT 1`;
    if(active.length&&active[0].id!==agreement.supersedes_agreement_id)return jsonError(c,'برای این تأمین‌کننده قرارداد فعال دیگری وجود دارد؛ قرارداد قبلی را به‌عنوان جایگزین مشخص کن.',409);
    const filename=safeUploadName(file.name),key=`${companyId}/contracts/${agreement.supplier_id}/${crypto.randomUUID()}-${filename}`;
    await c.env.EVIDENCE_BUCKET.put(key,await file.arrayBuffer(),{httpMetadata:{contentType:file.type},customMetadata:{companyId,agreementId:agreement.id,uploaderId:user.id,originalName:filename}});
    try{
      const updated=await sql`WITH superseded AS (
        UPDATE public.partnership_agreements SET status='superseded',updated_at=now()
        WHERE id=${agreement.supersedes_agreement_id}::uuid AND company_id=${companyId}::uuid AND supplier_id=${agreement.supplier_id}::uuid AND status='active'
        RETURNING id
      ), activated AS (
        UPDATE public.partnership_agreements SET signed_document_path=${key},signed_at=now(),status='active',approved_by=${user.id}::uuid,approved_at=now(),updated_at=now()
        WHERE id=${agreement.id}::uuid AND company_id=${companyId}::uuid AND status IN ('draft','pending_signature')
          AND (${agreement.supersedes_agreement_id}::uuid IS NULL OR EXISTS (SELECT 1 FROM superseded))
        RETURNING id,status,signed_document_path,signed_at
      ) SELECT * FROM activated`;
      if(!updated[0]){await c.env.EVIDENCE_BUCKET.delete(key).catch(()=>undefined);return jsonError(c,'فعال‌سازی قرارداد به دلیل وضعیت قرارداد قبلی انجام نشد.',409);}
      await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
        VALUES(${user.id}::uuid,'partnership.agreement.activated','partnership_agreement',${agreement.id},jsonb_build_object('company_id',${companyId}))`;
      return c.json({agreement:updated[0]});
    }catch(error){await c.env.EVIDENCE_BUCKET.delete(key).catch(()=>undefined);throw error;}
  }catch{return jsonError(c,'ثبت سند قرارداد انجام نشد.',500);}
});
app.get('/api/operations/:kind', async c => {
  let user: AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای مشاهده عملیات ابتدا وارد حساب شو.',401);
  const kind=c.req.param('kind') as OperationKind;
  const config=operationConfigs[kind];
  if(!config)return jsonError(c,'بخش عملیاتی پیدا نشد.',404);
  const companyId=c.req.query('companyId')||'';
  if(!validUuid(companyId))return jsonError(c,'شناسه مجموعه معتبر نیست.',400);
  try{
    const sql=sqlFor(c);
    const membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!['owner','admin','staff','supplier'].includes(membership.role))return jsonError(c,'به این بخش عملیاتی دسترسی نداری.',403);
    const manager=['owner','admin'].includes(membership.role);
    if(config.managerOnly&&!manager&&membership.role!=='supplier')return jsonError(c,'این بخش فقط برای مالک، مدیر یا شریک تأمین‌کننده مجاز است.',403);
    if(kind==='task-templates'&&!manager)return jsonError(c,'مدیریت دستورالعمل‌ها فقط برای مالک یا مدیر مجاز است.',403);
    const params:unknown[]=[companyId];
    let where='company_id=$1';
    if(membership.role==='supplier'){
      const supplierId=membership.supplier_id;
      const filter=supplierReadFilters[kind];
      if(!supplierId||!filter){where+=' AND false';}
      else{params.push(supplierId);where+=' AND '+filter;}
    }
    const main=await queryRows(sql,`SELECT * FROM public.${config.table} WHERE ${where} ORDER BY created_at DESC NULLS LAST LIMIT 200`,params);
    const supplierParams:unknown[]=[companyId];
    let supplierFilter='company_id=$1';
    if(membership.role==='supplier'&&membership.supplier_id){supplierParams.push(membership.supplier_id);supplierFilter+=' AND id=$2';}
    const [suppliers,sites,batches,templates,agreements,financeEntries,products]=await Promise.all([
      queryRows(sql,`SELECT id,name,city,active FROM public.suppliers WHERE ${supplierFilter} ORDER BY name LIMIT 300`,supplierParams),
      queryRows(sql,`SELECT id,site_code,name,supplier_id,active FROM public.farm_sites WHERE ${membership.role==='supplier'&&membership.supplier_id?'company_id=$1 AND supplier_id=$2':'company_id=$1'} ORDER BY name LIMIT 300`,membership.role==='supplier'&&membership.supplier_id?[companyId,membership.supplier_id]:[companyId]),
      queryRows(sql,`SELECT id,batch_code,farm_site_id,supplier_id,status,production_kind,unit FROM public.production_batches WHERE ${membership.role==='supplier'&&membership.supplier_id?'company_id=$1 AND supplier_id=$2':'company_id=$1'} ORDER BY created_at DESC LIMIT 300`,membership.role==='supplier'&&membership.supplier_id?[companyId,membership.supplier_id]:[companyId]),
      membership.role==='supplier'?Promise.resolve([]):queryRows(sql,`SELECT id,template_code,version,title,instructions,category,priority,evidence_required,expected_evidence_types,status FROM public.task_templates WHERE company_id=$1 AND (status='approved' OR $2::text IN ('owner','admin')) ORDER BY created_at DESC LIMIT 200`,[companyId,membership.role]),
      queryRows(sql,`SELECT id,supplier_id,agreement_code,version,status,effective_from,effective_to,shared_expense_categories,settlement_basis,company_profit_share_pct,partner_profit_share_pct FROM public.partnership_agreements WHERE ${membership.role==='supplier'&&membership.supplier_id?'company_id=$1 AND supplier_id=$2':'company_id=$1'} ORDER BY created_at DESC LIMIT 200`,membership.role==='supplier'&&membership.supplier_id?[companyId,membership.supplier_id]:[companyId]),
      queryRows(sql,`SELECT id,agreement_id,supplier_id,entry_type,status,amount,paid_amount,external_reference,recognized_on FROM public.partner_financial_entries WHERE ${membership.role==='supplier'&&membership.supplier_id?'company_id=$1 AND supplier_id=$2':'company_id=$1'} ORDER BY created_at DESC LIMIT 300`,membership.role==='supplier'&&membership.supplier_id?[companyId,membership.supplier_id]:[companyId]),
      queryRows(sql,`SELECT id,name,sku FROM public.products WHERE company_id=$1 ORDER BY name LIMIT 300`,[companyId]),
    ]);
    return c.json({rows:main,refs:{suppliers,sites,batches,templates,agreements,financeEntries,products}});
  }catch{return jsonError(c,'خواندن عملیات انجام نشد. طرح دیتابیس و دسترسی مجموعه را بررسی کن.',500);}
});
app.post('/api/operations/settlements', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای ایجاد دوره تسویه ابتدا وارد حساب شو.',401);
  let data:Record<string,unknown>;
  try{data=await c.req.json();}catch{return jsonError(c,'بدنه درخواست معتبر نیست.',400);}
  const companyId=typeof data.companyId==='string'?data.companyId:'';
  const agreementId=typeof data.agreementId==='string'?data.agreementId:'';
  const periodStart=typeof data.periodStart==='string'?data.periodStart:'';
  const periodEnd=typeof data.periodEnd==='string'?data.periodEnd:'';
  if(!validUuid(companyId)||!validUuid(agreementId)||!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)||!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)||periodEnd<periodStart)return jsonError(c,'قرارداد و بازه زمانی معتبر را انتخاب کن.',400);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!['owner','admin'].includes(membership.role))return jsonError(c,'ایجاد دوره تسویه فقط برای مالک یا مدیر مجاز است.',403);
    const rows=await sql`SELECT public.medar_create_partner_settlement_period(${user.id}::uuid,${agreementId}::uuid,${periodStart}::date,${periodEnd}::date) AS id`;
    const id=String((rows[0] as {id:string}).id);
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,'settlement.period.created','partner_settlement_period',${id},jsonb_build_object('company_id',${companyId},'agreement_id',${agreementId},'period_start',${periodStart},'period_end',${periodEnd}))`;
    return c.json({id},201);
  }catch(error){const message=error instanceof Error?error.message:'';if(message.includes('هم‌پوشانی'))return jsonError(c,message,409);return jsonError(c,message||'ایجاد دوره تسویه انجام نشد.',400);}
});

app.post('/api/operations/:kind/:id/action', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای اجرای عملیات ابتدا وارد حساب شو.',401);
  const kind=c.req.param('kind') as OperationKind,id=c.req.param('id');
  const config=operationConfigs[kind];
  if(!config||!validUuid(id))return jsonError(c,'بخش یا شناسه رکورد معتبر نیست.',400);
  let data:Record<string,unknown>;
  try{data=await c.req.json();}catch{return jsonError(c,'بدنه درخواست معتبر نیست.',400);}
  const companyId=typeof data.companyId==='string'?data.companyId:'';
  const action=typeof data.action==='string'?data.action:'';
  if(!validUuid(companyId))return jsonError(c,'شناسه مجموعه معتبر نیست.',400);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership)return jsonError(c,'عضویت فعال در این مجموعه پیدا نشد.',403);
    if(kind==='partner-settlements'){
      if(!['owner','admin'].includes(membership.role))return jsonError(c,'تغییر دوره تسویه فقط برای مالک یا مدیر مجاز است.',403);
      if(action==='refresh')await sql`SELECT public.medar_refresh_partner_settlement_period(${user.id}::uuid,${id}::uuid)`;
      else if(action==='approve')await sql`SELECT public.medar_approve_partner_settlement_period(${user.id}::uuid,${id}::uuid)`;
      else if(action==='pay'){
        const amount=Number(data.amount),reference=typeof data.paymentReference==='string'?data.paymentReference.trim():'';
        if(!Number.isFinite(amount)||amount<=0||reference.length<2)return jsonError(c,'مبلغ و مرجع پرداخت واقعی لازم است.',400);
        await sql`SELECT public.medar_record_partner_settlement_payment(${user.id}::uuid,${id}::uuid,${amount},${reference},now())`;
      }else return jsonError(c,'عملیات دوره تسویه پشتیبانی نمی‌شود.',400);
      await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
        VALUES(${user.id}::uuid,${'settlement.'+action},'partner_settlement_period',${id},jsonb_build_object('company_id',${companyId}))`;
      const updated=await sql`SELECT * FROM public.partner_settlement_periods WHERE id=${id}::uuid AND company_id=${companyId}::uuid LIMIT 1`;
      return c.json({row:updated[0]});
    }
    const rows=await queryRows(sql,`SELECT * FROM public.${config.table} WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1`,[id,companyId]);
    if(!rows[0])return jsonError(c,'رکورد پیدا نشد.',404);
    const row=rows[0];
    const manager=['owner','admin'].includes(membership.role);
    const internal=['owner','admin','staff'].includes(membership.role);
    if(kind==='operational-tasks'){
      const assigneeUser=String(row.assignee_user_id??'')===user.id;
      const assigneeSupplier=membership.role==='supplier'&&Boolean(membership.supplier_id)&&String(row.assignee_supplier_id??'')===membership.supplier_id;
      if(!internal&&!assigneeSupplier)return jsonError(c,'این وظیفه به شما تخصیص داده نشده است.',403);
      if(membership.role==='staff'&&!assigneeUser)return jsonError(c,'این وظیفه به شما تخصیص داده نشده است.',403);
      if(action==='start'){
        if(!['pending','rejected','blocked'].includes(String(row.status)))return jsonError(c,'فقط وظیفه در انتظار یا نیازمند اصلاح قابل شروع است.',409);
        await sql`UPDATE public.operational_tasks SET status='in_progress',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(action==='submit'){
        if(String(row.status)!=='in_progress')return jsonError(c,'فقط وظیفه در حال اجرا قابل ارسال است.',409);
        const note=typeof data.completionNote==='string'?data.completionNote.trim().slice(0,2000):'';
        await sql`UPDATE public.operational_tasks SET status='submitted',submitted_at=now(),completion_note=${note||null},updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(action==='review'){
        if(!manager)return jsonError(c,'بازبینی وظیفه فقط برای مالک یا مدیر مجاز است.',403);
        if(String(row.status)!=='submitted')return jsonError(c,'فقط وظیفه ارسال‌شده قابل بازبینی است.',409);
        const decision=data.decision,note=typeof data.reviewNote==='string'?data.reviewNote.trim().slice(0,2000):'';
        if(decision!=='approved'&&decision!=='rejected')return jsonError(c,'نتیجه بازبینی معتبر نیست.',400);
        if(decision==='rejected'&&note.length<2)return jsonError(c,'برای رد وظیفه دلیل لازم است.',400);
        await sql`UPDATE public.operational_tasks SET status=${decision},reviewed_by=${user.id}::uuid,reviewed_at=now(),review_note=${note||null},updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else return jsonError(c,'عملیات وظیفه پشتیبانی نمی‌شود.',400);
    }else if(kind==='task-templates'&&action==='approve-template'){
      if(!manager)return jsonError(c,'تأیید دستورالعمل فقط برای مالک یا مدیر مجاز است.',403);
      if(String(row.status)!=='draft')return jsonError(c,'فقط نسخه پیش‌نویس قابل تأیید است.',409);
      await sql`UPDATE public.task_templates SET status='approved',approved_by=${user.id}::uuid,approved_at=now(),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
    }else if(kind==='production-batches'&&action==='start-batch'){
      if(!internal)return jsonError(c,'شروع تولید برای این نقش مجاز نیست.',403);
      if(String(row.status)!=='planned')return jsonError(c,'فقط بچ برنامه‌ریزی‌شده قابل شروع است.',409);
      await sql`UPDATE public.production_batches SET status='active',started_on=COALESCE(started_on,current_date),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
    }else if(kind==='incidents'&&(action==='resolve-incident'||action==='investigate')){
      if(!internal)return jsonError(c,'تغییر وضعیت رخداد برای این نقش مجاز نیست.',403);
      if(action==='investigate'){
        if(!manager)return jsonError(c,'شروع بررسی رخداد فقط برای مالک یا مدیر مجاز است.',403);
        if(String(row.status)!=='open')return jsonError(c,'فقط رخداد باز قابل بررسی است.',409);
        await sql`UPDATE public.operational_incidents SET status='investigating',updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else{
        if(!['open','investigating','action_required'].includes(String(row.status)))return jsonError(c,'این رخداد قبلاً بسته شده یا در وضعیت قابل حل نیست.',409);
        const note=typeof data.resolutionNote==='string'?data.resolutionNote.trim().slice(0,2000):'';
        if(note.length<2)return jsonError(c,'شرح اقدام اصلاحی لازم است.',400);
        await sql`UPDATE public.operational_incidents SET status='resolved',resolution_note=${note},resolved_by=${user.id}::uuid,resolved_at=now(),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }
    }else if(kind==='partnership-agreements'&&['submit-for-signature','suspend-agreement','reactivate-agreement'].includes(action)){
      if(!manager)return jsonError(c,'تغییر وضعیت قرارداد فقط برای مالک یا مدیر مجاز است.',403);
      if(action==='submit-for-signature'){
        if(String(row.status)!=='draft')return jsonError(c,'فقط قرارداد پیش‌نویس قابل ارسال برای امضا است.',409);
        await sql`UPDATE public.partnership_agreements SET status='pending_signature',updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(action==='suspend-agreement'){
        if(String(row.status)!=='active')return jsonError(c,'فقط قرارداد فعال قابل تعلیق است.',409);
        await sql`UPDATE public.partnership_agreements SET status='suspended',updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else{
        if(String(row.status)!=='suspended'||!row.signed_document_path||!row.signed_at||!row.approved_by||!row.approved_at)return jsonError(c,'قرارداد فاقد سند امضا یا تأیید معتبر است.',409);
        const other=await sql`SELECT id FROM public.partnership_agreements WHERE company_id=${companyId}::uuid AND supplier_id=${String(row.supplier_id)}::uuid AND status='active' AND id<>${id}::uuid LIMIT 1`;
        if(other.length)return jsonError(c,'برای این تأمین‌کننده قرارداد فعال دیگری وجود دارد.',409);
        await sql`UPDATE public.partnership_agreements SET status='active',updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }
    }else if(kind==='partner-finance'&&action==='finance-transition'){
      const next=typeof data.nextStatus==='string'?data.nextStatus:'';
      if(!manager)return jsonError(c,'تغییر وضعیت سند مالی فقط برای مالک یا مدیر مجاز است.',403);
      const current=String(row.status);
      if(next==='submitted'){
        if(current!=='draft')return jsonError(c,'فقط سند پیش‌نویس قابل ارسال است.',409);
        await sql`UPDATE public.partner_financial_entries SET status='submitted',submitted_by=${user.id}::uuid,submitted_at=now(),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(next==='approved'){
        if(current!=='submitted')return jsonError(c,'فقط سند ارسال‌شده قابل تأیید است.',409);
        await sql`UPDATE public.partner_financial_entries SET status='approved',approved_by=${user.id}::uuid,approved_at=now(),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(next==='rejected'){
        if(!['draft','submitted','approved'].includes(current))return jsonError(c,'این سند در وضعیت فعلی قابل رد نیست.',409);
        await sql`UPDATE public.partner_financial_entries SET status='rejected',updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(next==='draft'){
        if(current!=='rejected')return jsonError(c,'فقط سند ردشده را می‌توان به پیش‌نویس برگرداند.',409);
        await sql`UPDATE public.partner_financial_entries SET status='draft',submitted_by=NULL,submitted_at=NULL,approved_by=NULL,approved_at=NULL,posted_by=NULL,posted_at=NULL,updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else if(next==='posted'){
        if(current!=='approved')return jsonError(c,'فقط سند تأییدشده قابل ثبت نهایی است.',409);
        if(['sale_collection','partner_advance','settlement_payment'].includes(String(row.entry_type))&&(Number(row.paid_amount)!==Number(row.amount)||String(row.payment_status)!=='paid'||!String(row.external_reference??'').trim()))return jsonError(c,'سند نقدی بدون مبلغ کامل و مرجع پرداخت واقعی ثبت نهایی نمی‌شود.',400);
        await sql`UPDATE public.partner_financial_entries SET status='posted',posted_by=${user.id}::uuid,posted_at=now(),updated_at=now() WHERE id=${id}::uuid AND company_id=${companyId}::uuid`;
      }else return jsonError(c,'گذار وضعیت مالی معتبر نیست.',400);
    }else return jsonError(c,'این عملیات برای این نوع رکورد پشتیبانی نمی‌شود.',400);
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,${'operation.'+action},${config.table},${id},jsonb_build_object('company_id',${companyId}))`;
    const updated=await queryRows(sql,`SELECT * FROM public.${config.table} WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1`,[id,companyId]);
    return c.json({row:updated[0]});
  }catch(error){const message=error instanceof Error?error.message:'';return jsonError(c,message||'عملیات انجام نشد.',400);}
});

app.post('/api/operations/:kind', async c => {
  let user: AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای ثبت عملیات ابتدا وارد حساب شو.',401);
  const kind=c.req.param('kind') as OperationKind,config=operationConfigs[kind];
  if(!config)return jsonError(c,'بخش عملیاتی پیدا نشد.',404);
  if(config.readOnly||kind==='partner-settlements')return jsonError(c,'این بخش فقط از گردش‌کار تأییدشده قابل تغییر است.',405);
  let data:Record<string,unknown>;
  try{data=await c.req.json();}catch{return jsonError(c,'بدنه درخواست معتبر نیست.',400);}
  const companyId=typeof data.company_id==='string'?data.company_id:'';
  if(!validUuid(companyId))return jsonError(c,'شناسه مجموعه معتبر نیست.',400);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||(!['owner','admin','staff'].includes(membership.role)&&!(membership.role==='supplier'&&['daily-production','incidents'].includes(kind))))return jsonError(c,'برای ثبت این عملیات مجوز نداری.',403);
    if(config.managerOnly&&!['owner','admin'].includes(membership.role))return jsonError(c,'ثبت این سند فقط برای مالک یا مدیر مجاز است.',403);
    const serverManaged=new Set(['status','created_by','recorded_by','assigned_by','reported_by','reported_supplier_id','quality_status','direction','paid_amount','payment_status','paid_by','currency','signed_document_path','signed_at','completion_note','review_note','created_at','updated_at']);
    const fields=config.fields.filter(field=>Object.prototype.hasOwnProperty.call(data,field)&&!serverManaged.has(field));
    if(!fields.length)return jsonError(c,'هیچ فیلد قابل ثبت ارسال نشده است.',400);
    const values=fields.map(field=>data[field]);
    const insertFields=['company_id',...fields];
    const insertValues:unknown[]=[companyId,...values];
    const addManaged=(field:string,value:unknown)=>{
      if(config.fields.includes(field)&&!insertFields.includes(field)){insertFields.push(field);insertValues.push(value);}
    };
    if(['farm-sites','flock-cycles','production-batches','task-templates','operational-tasks','incidents','partnership-agreements','partner-finance'].includes(kind)){
      const initialStatus:Record<string,string>={'flock-cycles':'planned','production-batches':'planned','task-templates':'draft','operational-tasks':'pending','incidents':'open','partnership-agreements':'draft','partner-finance':'draft'};
      if(initialStatus[kind])addManaged('status',initialStatus[kind]);
    }
    const creatorColumn=kind==='daily-production'?'recorded_by':kind==='operational-tasks'?'assigned_by':kind==='incidents'?'reported_by':'created_by';
    if(['recorded_by','assigned_by','reported_by','created_by'].includes(creatorColumn)){insertFields.push(creatorColumn);insertValues.push(user.id);}
    if(kind==='production-batches')addManaged('quality_status','not_inspected');
    if(kind==='partner-finance'){
      const entryType=String(data.entry_type||''),amount=Number(data.amount),paidInput=Number(data.paid_amount||0);
      if(!['sale_invoice','sale_collection','expense','partner_advance'].includes(entryType))return jsonError(c,'نوع سند مالی معتبر نیست.',400);
      if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(paidInput)||paidInput<0||paidInput>amount)return jsonError(c,'مبلغ سند یا مبلغ پرداخت‌شده معتبر نیست.',400);
      const paidAmount=['sale_collection','partner_advance'].includes(entryType)?amount:paidInput;
      const paymentStatus=['sale_collection','partner_advance'].includes(entryType)?'paid':paidAmount<=0?(entryType==='expense'?'unpaid':'not_applicable'):paidAmount>=amount?'paid':'partial';
      const paidBy=entryType==='sale_collection'?'customer':entryType==='partner_advance'?(String(data.paid_by||'company')):entryType==='expense'?(String(data.paid_by||'none')):'none';
      const direction=entryType==='sale_collection'?'inflow_to_company':entryType==='partner_advance'?(paidBy==='partner'?'partner_to_company':'company_to_partner'):entryType==='expense'?(paidBy==='company'?'outflow_from_company':'not_cash'):'not_cash';
      if(entryType==='partner_advance'&&!['company','partner'].includes(paidBy))return jsonError(c,'پیش‌پرداخت باید به‌عنوان پرداخت شرکت یا شریک مشخص شود.',400);
      if(entryType==='expense'&&!String(data.expense_category||'').trim())return jsonError(c,'برای هزینه، دسته هزینه لازم است.',400);
      if(['sale_collection','partner_advance'].includes(entryType)&&!String(data.external_reference||'').trim())return jsonError(c,'شماره رسید یا مرجع واقعی لازم است.',400);
      if(entryType==='sale_collection'){
        const linked=await queryRows(sql,`SELECT id FROM public.partner_financial_entries WHERE id=$1::uuid AND company_id=$2::uuid AND entry_type='sale_invoice' AND status IN ('approved','posted') LIMIT 1`,[data.linked_entry_id,companyId]);
        if(!linked.length)return jsonError(c,'دریافت فروش باید به فاکتور تأییدشده همین مجموعه متصل باشد.',400);
      }
      if(entryType==='expense'&&data.is_shared_cost===true){
        const agreementRows=await queryRows(sql,`SELECT shared_expense_categories FROM public.partnership_agreements WHERE id=$1::uuid AND company_id=$2::uuid AND supplier_id=$3::uuid LIMIT 1`,[data.agreement_id,companyId,data.supplier_id]);
        const allowed=Array.isArray(agreementRows[0]?.shared_expense_categories)?agreementRows[0].shared_expense_categories as unknown[]:[];
        if(!allowed.map(String).includes(String(data.expense_category)))return jsonError(c,'این دسته هزینه در قرارداد به‌عنوان هزینه مشترک تعیین نشده است.',400);
      }
      addManaged('paid_amount',paidAmount);addManaged('payment_status',paymentStatus);addManaged('direction',direction);addManaged('paid_by',paidBy);addManaged('currency','TOMAN');
    }
    if(kind==='farm-sites'){const lat=data.latitude===null||data.latitude===''||data.latitude===undefined?null:Number(data.latitude);const lon=data.longitude===null||data.longitude===''||data.longitude===undefined?null:Number(data.longitude);if((lat===null)!==(lon===null)||(lat!==null&&(!Number.isFinite(lat)||lat < -90||lat > 90))||(lon!==null&&(!Number.isFinite(lon)||lon < -180||lon > 180)))return jsonError(c,'عرض و طول جغرافیایی باید با هم و در محدوده معتبر وارد شوند.',400);}
    if(kind==='partnership-agreements'){
      const companyShare=Number(data.company_profit_share_pct),partnerShare=Number(data.partner_profit_share_pct);
      if(Math.abs(companyShare+partnerShare-100)>0.0001)return jsonError(c,'مجموع سهم شرکت و شریک باید ۱۰۰ درصد باشد.',400);
      if(!Array.isArray(data.shared_expense_categories)||!data.shared_expense_categories.length)return jsonError(c,'حداقل یک دسته هزینه مشترک انتخاب کن.',400);
    }
    const relationTables:Record<string,string>={supplier_id:'suppliers',assignee_supplier_id:'suppliers',farm_site_id:'farm_sites',batch_id:'production_batches',template_id:'task_templates',agreement_id:'partnership_agreements',flock_cycle_id:'flock_cycles',product_id:'products',lot_id:'lots',task_id:'operational_tasks',supersedes_agreement_id:'partnership_agreements',linked_entry_id:'partner_financial_entries'};
    for(const [field,table] of Object.entries(relationTables)){
      if(data[field]!==undefined&&data[field]!==null&&data[field]!==''){
        if(!await sameCompanyRow(sql,table,data[field],companyId))return jsonError(c,'ارجاع «'+field+'» پیدا نشد یا متعلق به این مجموعه نیست.',400);
      }
    }
    if(data.assignee_user_id){
      const assignee=await sql`SELECT id FROM public.memberships WHERE company_id=${companyId}::uuid AND user_id=${String(data.assignee_user_id)}::uuid AND active=true AND role::text IN ('owner','admin','staff') LIMIT 1`;
      if(!assignee.length)return jsonError(c,'مسئول وظیفه عضو فعال همین مجموعه نیست.',400);
    }
    if(kind==='operational-tasks'&&!data.assignee_user_id&&!data.assignee_supplier_id)return jsonError(c,'برای وظیفه باید یک مسئول داخلی یا تأمین‌کننده تعیین شود.',400);
    if(kind==='production-batches'&&data.farm_site_id){
      const siteRows=await queryRows(sql,'SELECT supplier_id FROM public.farm_sites WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1',[data.farm_site_id,companyId]);
      if(!siteRows.length)return jsonError(c,'مزرعه انتخاب‌شده متعلق به این مجموعه نیست.',400);
      const siteSupplier=(siteRows[0] as {supplier_id:string|null}).supplier_id;
      if(siteSupplier&&data.supplier_id&&siteSupplier!==data.supplier_id)return jsonError(c,'تأمین‌کننده بچ باید با تأمین‌کننده مزرعه هماهنگ باشد.',400);
      if(siteSupplier)addManaged('supplier_id',siteSupplier);
    }
    if(kind==='daily-production'&&membership.role==='supplier'){
      if(!membership.supplier_id)return jsonError(c,'این حساب به پروفایل تأمین‌کننده متصل نیست.',403);
      const batch=await queryRows(sql,'SELECT id FROM public.production_batches WHERE id=$1::uuid AND company_id=$2::uuid AND supplier_id=$3::uuid LIMIT 1',[data.batch_id,companyId,membership.supplier_id]);
      if(!batch.length)return jsonError(c,'ثبت تولید فقط برای بچ‌های همین تأمین‌کننده مجاز است.',403);
    }
    if(kind==='incidents'){
      let reportSupplier:string|null=null;
      if(membership.role==='supplier'){
        if(!membership.supplier_id)return jsonError(c,'این حساب به پروفایل تأمین‌کننده متصل نیست.',403);
        const siteOk=data.farm_site_id?await queryRows(sql,'SELECT id FROM public.farm_sites WHERE id=$1::uuid AND company_id=$2::uuid AND supplier_id=$3::uuid LIMIT 1',[data.farm_site_id,companyId,membership.supplier_id]):[];
        const batchOk=data.batch_id?await queryRows(sql,'SELECT id FROM public.production_batches WHERE id=$1::uuid AND company_id=$2::uuid AND supplier_id=$3::uuid LIMIT 1',[data.batch_id,companyId,membership.supplier_id]):[];
        if(!siteOk.length&&!batchOk.length)return jsonError(c,'گزارش رخداد باید به مزرعه یا بچ همین تأمین‌کننده متصل باشد.',403);
        reportSupplier=membership.supplier_id;
      }else if(data.farm_site_id){
        const site=await queryRows(sql,'SELECT supplier_id FROM public.farm_sites WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1',[data.farm_site_id,companyId]);
        if(site.length)reportSupplier=(site[0] as {supplier_id:string|null}).supplier_id;
      }else if(data.batch_id){
        const batch=await queryRows(sql,'SELECT supplier_id FROM public.production_batches WHERE id=$1::uuid AND company_id=$2::uuid LIMIT 1',[data.batch_id,companyId]);
        if(batch.length)reportSupplier=(batch[0] as {supplier_id:string|null}).supplier_id;
      }
      addManaged('reported_supplier_id',reportSupplier);
    }
    const placeholders=insertValues.map((_,index)=>'$'+(index+1)).join(',');
    const query=`INSERT INTO public.${config.table} (${insertFields.join(',')}) VALUES (${placeholders}) RETURNING *`;
    const result=await queryRows(sql,query,insertValues);
    const row=result[0];
    if(!row)return jsonError(c,'ثبت رکورد انجام نشد.',500);
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,'operation.created',${config.table},${String(row.id)},jsonb_build_object('company_id',${companyId},'kind',${kind}))`;
    return c.json({row},201);
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(message.includes('duplicate key')||message.includes('unique constraint'))return jsonError(c,'کد یا رکورد تکراری است.',409);
    if(message.includes('foreign key'))return jsonError(c,'یکی از ارجاع‌ها متعلق به این مجموعه نیست.',400);
    return jsonError(c,'ثبت عملیات انجام نشد. داده‌ها و محدودیت‌های عملیاتی را بررسی کن.',400);
  }
});
app.post('/api/operations/:kind/:id/update', async c => {
  let user:AuthUser|null;
  try{user=await currentUser(c);}catch{return jsonError(c,'پایگاه داده پیکربندی نشده است.',503);}
  if(!user)return jsonError(c,'برای ویرایش عملیات ابتدا وارد حساب شو.',401);
  const kind=c.req.param('kind') as OperationKind,config=operationConfigs[kind];
  if(!config||config.readOnly||kind==='partner-settlements')return jsonError(c,'این بخش فقط از گردش‌کار اختصاصی قابل تغییر است.',405);
  let data:Record<string,unknown>;
  try{data=await c.req.json();}catch{return jsonError(c,'بدنه درخواست معتبر نیست.',400);}
  const companyId=typeof data.companyId==='string'?data.companyId:'';
  if(!validUuid(companyId)||!validUuid(c.req.param('id')))return jsonError(c,'شناسه مجموعه یا رکورد معتبر نیست.',400);
  try{
    const sql=sqlFor(c),membership=await operationMembership(sql,user.id,companyId);
    if(!membership||!['owner','admin','staff'].includes(membership.role))return jsonError(c,'برای ویرایش این عملیات مجوز نداری.',403);
    if(config.managerOnly&&!['owner','admin'].includes(membership.role))return jsonError(c,'ویرایش این سند فقط برای مالک یا مدیر مجاز است.',403);
    const blocked=new Set(['id','company_id','created_by','created_at','updated_at','recorded_by','assigned_by','reported_by','reviewed_by','reviewed_at','status','paid_amount','payment_status','posted_by','posted_at','approved_by','approved_at','settled_by','settled_at']);
    const fields=config.fields.filter(field=>Object.prototype.hasOwnProperty.call(data,field)&&!blocked.has(field));
    if(!fields.length)return jsonError(c,'هیچ فیلد قابل ویرایش ارسال نشده است.',400);
    const values=fields.map(field=>data[field]);
    const setClause=fields.map((field,index)=>field+'=$'+(index+1)).join(',');
    const params=[...values,companyId,c.req.param('id')];
    const query=`UPDATE public.${config.table} SET ${setClause},updated_at=now() WHERE company_id=$${values.length+1}::uuid AND id=$${values.length+2}::uuid RETURNING *`;
    const result=await queryRows(sql,query,params);
    if(!result[0])return jsonError(c,'رکورد پیدا نشد یا اجازه ویرایش آن را نداری.',404);
    await sql`INSERT INTO public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata)
      VALUES(${user.id}::uuid,'operation.updated',${config.table},${c.req.param('id')},jsonb_build_object('company_id',${companyId},'fields',${fields}))`;
    return c.json({row:result[0]});
  }catch{return jsonError(c,'ویرایش عملیات انجام نشد.',400);}
});
app.notFound(c => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ message:'مسیر پیدا نشد.' },404));
export default app;
