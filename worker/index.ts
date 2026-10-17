import { neon } from '@neondatabase/serverless';
import { Hono, type Context } from 'hono';

type PrivateFileStore = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string }; writeHttpMetadata(headers: Headers): void } | null>;
  delete(keys: string | string[]): Promise<void>;
};
type Bindings = {
  DATABASE_URL?: string;
  ALLOWED_ORIGINS?: string;
  FILE_STORE?: PrivateFileStore;
  ASSETS?: { fetch(request: Request): Promise<Response> };
};
type AppEnv = { Bindings: Bindings };
type Ctx = Context<AppEnv>;
type AuthUser = { id: string; username: string; phone: string; full_name: string };
type CurrentSession = { user: AuthUser; sessionId: string; tokenHash: string };

const app = new Hono<AppEnv>();
const SESSION_COOKIE = 'medar_session';
const SESSION_DAYS = 14;
const PASSWORD_ITERATIONS = 310_000;
const encoder = new TextEncoder();

function sqlFor(c: Ctx) {
  if (!c.env.DATABASE_URL) throw new Error('Database is not configured');
  return neon(c.env.DATABASE_URL);
}

function asciiDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

export function normalizeIranPhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = asciiDigits(input.trim()).replace(/[\s()-]/g, '');
  if (/^09\d{9}$/.test(value)) return '+98' + value.slice(1);
  if (/^9\d{9}$/.test(value)) return '+98' + value;
  if (/^\+989\d{9}$/.test(value)) return value;
  if (/^00989\d{9}$/.test(value)) return '+' + value.slice(2);
  return null;
}

export function normalizeUsername(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (value.length < 3 || value.length > 32 || !/^[\p{L}\p{N}._-]+$/u.test(value)) return null;
  if (/^[._-]|[._-]$/.test(value)) return null;
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(derived))}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, rawIterations, saltText, expectedText] = encoded.split('$');
  if (algorithm !== 'pbkdf2_sha256' || !rawIterations || !saltText || !expectedText) return false;
  const iterations = Number(rawIterations);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 600_000) return false;
  try {
    const salt = toArrayBuffer(base64ToBytes(saltText));
    const expected = new Uint8Array(base64ToBytes(expectedText));
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const derived = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      key,
      expected.byteLength * 8,
    ));
    if (derived.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < derived.length; i += 1) difference |= derived[i] ^ expected[i];
    return difference === 0;
  } catch {
    return false;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function randomToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

function readCookie(c: Ctx, name: string): string | null {
  const cookieHeader = c.req.header('cookie') ?? '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim() || null;
  }
  return null;
}

function setSessionCookie(c: Ctx, token: string, maxAge = SESSION_DAYS * 24 * 60 * 60): void {
  c.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`,
  );
}

function clearSessionCookie(c: Ctx): void {
  c.header('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`);
}

function safeUser(row: Record<string, unknown>): AuthUser {
  return {
    id: String(row.id),
    username: String(row.username_normalized ?? row.username ?? ''),
    phone: String(row.phone ?? row.phone_e164 ?? ''),
    full_name: String(row.full_name ?? row.display_name ?? ''),
  };
}

async function currentSession(c: Ctx): Promise<CurrentSession | null> {
  const token = readCookie(c, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const sql = sqlFor(c);
  const rows = await sql.query(
    "select s.id as \"sessionId\", u.id, coalesce(u.username_normalized,u.username) as username, u.phone_e164 as phone, u.display_name as full_name " +
    "from public.medar_sessions s join public.medar_users u on u.id=s.user_id " +
    "where s.token_hash=$1 and s.revoked_at is null and s.expires_at>now() and u.account_status='active' limit 1",
    [tokenHash],
  );
  const row = rows[0] as (Record<string, unknown> & { sessionId: string }) | undefined;
  if (!row) return null;
  return { user: safeUser(row), sessionId: row.sessionId, tokenHash };
}

async function requireUser(c: Ctx): Promise<AuthUser | Response> {
  const session = await currentSession(c);
  return session?.user ?? c.json({ message: 'برای ادامه وارد حساب مدار شو.' }, 401);
}

async function createSession(c: Ctx, userId: string): Promise<void> {
  const sql = sqlFor(c);
  const token = randomToken();
  const tokenHash = await sha256(token);
  const ip = c.req.header('cf-connecting-ip') ?? '';
  const userAgent = (c.req.header('user-agent') ?? '').slice(0, 500);
  const ipHash = ip ? await sha256(ip) : null;
  await sql.query(
    "insert into public.medar_sessions(user_id,token_hash,expires_at,user_agent,ip_hash) values($1::uuid,$2,now()+interval '14 days',$3,$4)",
    [userId, tokenHash, userAgent || null, ipHash],
  );
  await sql.query("delete from public.medar_sessions where expires_at<now()-interval '7 days'");
  setSessionCookie(c, token);
}

async function getMemberships(c: Ctx, userId: string) {
  const sql = sqlFor(c);
  return await sql.query(
    "select m.id,m.company_id,m.user_id,m.role,m.active,m.customer_id,m.supplier_id, " +
    "json_build_object('name',coalesce(c.name,'مجموعه مدار')) as company " +
    "from public.memberships m join public.companies c on c.id=m.company_id " +
    "where m.user_id=$1::uuid and m.active=true order by m.created_at",
    [userId],
  );
}

async function rateLimitKeys(c: Ctx, username: string): Promise<string[]> {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  return [await sha256('username:' + username), await sha256('ip:' + ip)];
}

async function isRateLimited(c: Ctx, keys: string[]): Promise<boolean> {
  const sql = sqlFor(c);
  for (const key of keys) {
    const rows = await sql.query(
      "select attempts,window_started_at from public.medar_rate_limits where key_hash=$1 limit 1",
      [key],
    );
    const row = rows[0] as { attempts: number; window_started_at: string } | undefined;
    if (row && Number(row.attempts) >= 5 && new Date(row.window_started_at).getTime() > Date.now() - 15 * 60 * 1000) {
      return true;
    }
  }
  return false;
}

async function recordFailedLogin(c: Ctx, keys: string[]): Promise<void> {
  const sql = sqlFor(c);
  for (const key of keys) {
    await sql.query(
      "insert into public.medar_rate_limits(key_hash,attempts,window_started_at,updated_at) values($1,1,now(),now()) " +
      "on conflict(key_hash) do update set " +
      "attempts=case when public.medar_rate_limits.window_started_at<now()-interval '15 minutes' then 1 else public.medar_rate_limits.attempts+1 end, " +
      "window_started_at=case when public.medar_rate_limits.window_started_at<now()-interval '15 minutes' or public.medar_rate_limits.attempts=4 then now() else public.medar_rate_limits.window_started_at end, " +
      "updated_at=now()",
      [key],
    );
  }
  await sql.query("delete from public.medar_rate_limits where updated_at<now()-interval '1 day'");
}

app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  const origin = c.req.header('origin');
  const requestOrigin = new URL(c.req.url).origin;
  const allowed = new Set((c.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean));
  if (origin) {
    c.header('Vary', 'Origin');
    if (origin === requestOrigin || allowed.has(origin)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, X-Upsert, X-Application-Name');
    } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method)) {
      return c.json({ message: 'مبدأ درخواست مجاز نیست.' }, 403);
    }
  }
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.get('/api/health', async (c) => {
  if (!c.env.DATABASE_URL) return c.json({ ok: false, service: 'medar-api', database: false }, 503);
  try {
    const sql = sqlFor(c);
    await sql`select 1 as ready`;
    return c.json({ ok: true, service: 'medar-api', database: true, authentication: 'username-password' });
  } catch {
    return c.json({ ok: false, service: 'medar-api', database: false }, 503);
  }
});

app.get('/api/auth/me', async (c) => {
  const session = await currentSession(c);
  if (!session) return c.json({ user: null, memberships: [] });
  return c.json({ user: session.user, memberships: await getMemberships(c, session.user.id) });
});

app.post('/api/auth/signup', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'اطلاعات ثبت‌نام معتبر نیست.' }, 400);
  const username = normalizeUsername(body.username);
  const phone = normalizeIranPhone(body.phone);
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : '';
  const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username) return c.json({ message: 'نام کاربری باید ۳ تا ۳۲ نویسه و شامل حروف، عدد، نقطه، خط تیره یا زیرخط باشد.' }, 422);
  if (!phone) return c.json({ message: 'شماره موبایل ایران معتبر وارد کن؛ مثال: 09121234567' }, 422);
  if (fullName.length < 2 || fullName.length > 160) return c.json({ message: 'نام و نام خانوادگی باید بین ۲ تا ۱۶۰ نویسه باشد.' }, 422);
  if (inviteCode) {
    if (!/^[a-f0-9]{64}$/.test(inviteCode)) return c.json({ message: 'کد دعوت معتبر نیست.' }, 422);
  } else if (companyName.length < 2 || companyName.length > 160) {
    return c.json({ message: 'نام مجموعه باید بین ۲ تا ۱۶۰ نویسه باشد.' }, 422);
  }
  if (password.length < 8 || password.length > 128) return c.json({ message: 'گذرواژه باید بین ۸ تا ۱۲۸ نویسه باشد.' }, 422);

  const sql = sqlFor(c);
  try {
    const conflicts = await sql.query(
      "select username_normalized,phone_e164 from public.medar_users where username_normalized=$1 or phone_e164=$2 limit 2",
      [username, phone],
    );
    if (conflicts.some((row) => (row as { username_normalized: string }).username_normalized === username)) {
      return c.json({ message: 'این نام کاربری قبلاً ثبت شده است.' }, 409);
    }
    if (conflicts.some((row) => (row as { phone_e164: string }).phone_e164 === phone)) {
      return c.json({ message: 'این شماره موبایل قبلاً برای حسابی ثبت شده است.' }, 409);
    }
    const passwordHash = await hashPassword(password);
    let created: (Record<string, unknown> & { id: string; companyId: string }) | undefined;
    if (inviteCode) {
      const tokenHash = await sha256(inviteCode);
      const result = await sql.query(
        "with valid_invite as (" +
        " update public.company_invites set uses=uses+1,updated_at=now() " +
        " where token_hash=$1 and revoked_at is null and expires_at>now() and uses<max_uses " +
        " returning company_id,role,customer_id,supplier_id" +
        "), new_user as (" +
        " insert into public.medar_users(username,username_normalized,phone_e164,display_name,password_hash,requested_role,account_status) " +
        " select $2,$2,$3,$4,$5,case when i.role='admin' then 'staff' else i.role::text end,'active' from valid_invite i " +
        " returning id,username,username_normalized,phone_e164,display_name" +
        "), new_profile as (" +
        " insert into public.profiles(id,full_name,phone) select id,display_name,phone_e164 from new_user " +
        " on conflict(id) do update set full_name=excluded.full_name,phone=excluded.phone returning id" +
        "), new_membership as (" +
        " insert into public.memberships(company_id,user_id,role,active,created_by,customer_id,supplier_id) " +
        " select i.company_id,u.id,i.role,true,u.id,i.customer_id,i.supplier_id from valid_invite i cross join new_user u " +
        " returning company_id" +
        ") select u.id,u.username_normalized as username,u.phone_e164 as phone,u.display_name as full_name,m.company_id as \"companyId\" " +
        "from new_user u cross join new_membership m",
        [tokenHash, username, phone, fullName, passwordHash],
      );
      created = result[0] as (Record<string, unknown> & { id: string; companyId: string }) | undefined;
      if (!created) return c.json({ message: 'کد دعوت منقضی، لغوشده یا نامعتبر است.' }, 422);
    } else {
      const result = await sql.query(
        "with new_user as (" +
        " insert into public.medar_users(username,username_normalized,phone_e164,display_name,password_hash,requested_role,account_status) " +
        " values($1,$1,$2,$3,$4,'owner','active') " +
        " returning id,username,username_normalized,phone_e164,display_name" +
        "), new_profile as (" +
        " insert into public.profiles(id,full_name,phone) select id,display_name,phone_e164 from new_user " +
        " on conflict(id) do update set full_name=excluded.full_name,phone=excluded.phone returning id" +
        "), new_company as (" +
        " insert into public.companies(name) select $5 from new_user returning id" +
        "), new_membership as (" +
        " insert into public.memberships(company_id,user_id,role,active,created_by) " +
        " select c.id,u.id,'owner',true,u.id from new_user u cross join new_company c returning company_id" +
        ") select u.id,u.username_normalized as username,u.phone_e164 as phone,u.display_name as full_name,m.company_id as \"companyId\" " +
        "from new_user u cross join new_membership m",
        [username, phone, fullName, passwordHash, companyName],
      );
      created = result[0] as (Record<string, unknown> & { id: string; companyId: string }) | undefined;
    }
    if (!created) return c.json({ message: 'ساخت حساب و فضای کاری انجام نشد. دوباره تلاش کن.' }, 500);
    await createSession(c, created.id);
    return c.json({ user: safeUser(created), companyId: created.companyId, memberships: await getMemberships(c, created.id) }, 201);
  } catch (error) {
    const databaseError = error as { code?: string; constraint?: string };
    if (databaseError.code === '23505') {
      if (databaseError.constraint?.includes('phone')) return c.json({ message: 'این شماره موبایل قبلاً ثبت شده است.' }, 409);
      return c.json({ message: 'نام کاربری یا شماره موبایل قبلاً ثبت شده است.' }, 409);
    }
    throw error;
  }
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'اطلاعات ورود معتبر نیست.' }, 400);
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password || password.length > 128) return c.json({ message: 'نام کاربری یا گذرواژه نادرست است.' }, 401);
  const keys = await rateLimitKeys(c, username);
  if (await isRateLimited(c, keys)) return c.json({ message: 'تلاش‌های ورود بیش از حد است. ۱۵ دقیقه دیگر دوباره امتحان کن.' }, 429);
  const sql = sqlFor(c);
  const rows = await sql.query(
    "select id,username,username_normalized,phone_e164,display_name,password_hash,account_status " +
    "from public.medar_users where username_normalized=$1 limit 1",
    [username],
  );
  const account = rows[0] as (Record<string, unknown> & { id: string; password_hash: string; account_status: string }) | undefined;
  const passwordMatches = account ? await verifyPassword(password, account.password_hash) : (await hashPassword(password), false);
  if (!account || !passwordMatches) {
    await recordFailedLogin(c, keys);
    return c.json({ message: 'نام کاربری یا گذرواژه نادرست است.' }, 401);
  }
  if (account.account_status !== 'active') return c.json({ message: 'این حساب غیرفعال یا موقتاً مسدود شده است؛ با مدیر سامانه تماس بگیر.' }, 403);
  await sql.query("update public.medar_users set last_login_at=now(),updated_at=now() where id=$1::uuid", [account.id]);
  for (const key of keys) await sql.query("delete from public.medar_rate_limits where key_hash=$1", [key]);
  await createSession(c, account.id);
  return c.json({ user: safeUser(account), memberships: await getMemberships(c, account.id) });
});

app.post('/api/auth/logout', async (c) => {
  const token = readCookie(c, SESSION_COOKIE);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const tokenHash = await sha256(token);
    const sql = sqlFor(c);
    await sql.query("update public.medar_sessions set revoked_at=now() where token_hash=$1 and revoked_at is null", [tokenHash]);
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.post('/api/auth/password/change', async (c) => {
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای تغییر گذرواژه وارد حساب شو.' }, 401);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  if (newPassword.length < 8 || newPassword.length > 128) return c.json({ message: 'گذرواژه جدید باید بین ۸ تا ۱۲۸ نویسه باشد.' }, 422);
  const sql = sqlFor(c);
  const rows = await sql.query("select password_hash from public.medar_users where id=$1::uuid limit 1", [session.user.id]);
  const encodedHash = (rows[0] as { password_hash: string } | undefined)?.password_hash ?? '';
  if (!(await verifyPassword(currentPassword, encodedHash))) return c.json({ message: 'گذرواژه فعلی نادرست است.' }, 403);
  const passwordHash = await hashPassword(newPassword);
  await sql.query("update public.medar_users set password_hash=$1,updated_at=now() where id=$2::uuid", [passwordHash, session.user.id]);
  await sql.query("update public.medar_sessions set revoked_at=now() where user_id=$1::uuid and id<>$2::uuid and revoked_at is null", [session.user.id, session.sessionId]);
  return c.json({ ok: true, message: 'گذرواژه تغییر کرد؛ نشست‌های دیگر بسته شدند.' });
});

app.get('/api/workspace/memberships', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  return c.json({ memberships: await getMemberships(c, user.id) });
});

app.post('/api/workspace/invites', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const role = typeof body?.role === 'string' ? body.role : '';
  const customerId = typeof body?.customerId === 'string' ? body.customerId : null;
  const supplierId = typeof body?.supplierId === 'string' ? body.supplierId : null;
  const allowedRoles = ['admin', 'staff', 'customer', 'supplier', 'driver'];
  if (!/^[0-9a-f-]{36}$/i.test(companyId) || !allowedRoles.includes(role)) return c.json({ message: 'شرکت یا نقش دعوت معتبر نیست.' }, 422);
  if ((role === 'customer' && (!customerId || supplierId)) || (role === 'supplier' && (!supplierId || customerId)) || (!['customer','supplier'].includes(role) && (customerId || supplierId))) {
    return c.json({ message: 'برای نقش مشتری یا تأمین‌کننده باید حساب مربوط به همان مجموعه انتخاب شود.' }, 422);
  }
  const sql = sqlFor(c);
  const memberships = await sql`select role from public.memberships where user_id = ${user.id} and company_id = ${companyId} and active = true limit 1`;
  const actorRole = (memberships[0] as { role: string } | undefined)?.role;
  if (!actorRole || !['owner', 'admin'].includes(actorRole)) return c.json({ message: 'برای ساخت دعوت، دسترسی مالک یا مدیر لازم است.' }, 403);
  if (role === 'admin' && actorRole !== 'owner') return c.json({ message: 'فقط مالک می‌تواند مدیر جدید دعوت کند.' }, 403);
  if (customerId) {
    const found = await sql`select 1 from public.customers where id = ${customerId} and company_id = ${companyId} limit 1`;
    if (!found.length) return c.json({ message: 'حساب مشتری به این مجموعه تعلق ندارد.' }, 422);
  }
  if (supplierId) {
    const found = await sql`select 1 from public.suppliers where id = ${supplierId} and company_id = ${companyId} limit 1`;
    if (!found.length) return c.json({ message: 'حساب تأمین‌کننده به این مجموعه تعلق ندارد.' }, 422);
  }
  const code = randomToken();
  const tokenHash = await sha256(code);
  const rows = await sql`
    insert into public.company_invites(company_id, role, token_hash, created_by, expires_at, customer_id, supplier_id)
    values (${companyId}, ${role}::public.app_role, ${tokenHash}, ${user.id}, now() + interval '7 days', ${customerId}, ${supplierId})
    returning id, expires_at
  `;
  return c.json({ inviteCode: code, inviteId: (rows[0] as { id: string }).id, expiresAt: (rows[0] as { expires_at: string }).expires_at }, 201);
});

app.post('/api/workspace/join', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const code = typeof body?.inviteCode === 'string' ? body.inviteCode.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(code)) return c.json({ message: 'کد دعوت معتبر نیست.' }, 422);
  const tokenHash = await sha256(code);
  const sql = sqlFor(c);
  const rows = await sql`
    with invite as (
      update public.company_invites set uses = uses + 1, updated_at = now()
      where token_hash = ${tokenHash} and revoked_at is null and expires_at > now() and uses < max_uses
      returning company_id, role, customer_id, supplier_id
    ), membership as (
      insert into public.memberships(company_id, user_id, role, active, created_by, customer_id, supplier_id)
      select company_id, ${user.id}, role, true, ${user.id}, customer_id, supplier_id from invite
      on conflict (company_id, user_id, role) do update set active = true, customer_id = excluded.customer_id, supplier_id = excluded.supplier_id
      returning id, company_id, role
    )
    select id, company_id, role from membership limit 1
  `;
  const joined = rows[0] as { id: string; company_id: string; role: string } | undefined;
  if (!joined) return c.json({ message: 'دعوت منقضی، لغوشده یا نامعتبر است.' }, 422);
  return c.json({ membership: joined, memberships: await getMemberships(c, user.id) }, 201);
});

app.get('/api/workspace/members', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const sql = sqlFor(c);
  const actorRows = await sql`
    select role from public.memberships
    where user_id = ${user.id} and company_id = ${companyId} and active = true limit 1
  `;
  const actorRole = (actorRows[0] as { role: string } | undefined)?.role;
  if (!actorRole || !['owner', 'admin'].includes(actorRole)) {
    return c.json({ message: 'برای مدیریت اعضا دسترسی مالک یا مدیر لازم است.' }, 403);
  }
  const members = await sql`
    select m.id as membership_id, m.company_id, m.user_id, m.role, m.active, m.created_at,
      u.username, u.phone_e164 as phone, u.display_name as full_name
    from public.memberships m
    join public.medar_users u on u.id = m.user_id
    where m.company_id = ${companyId}
    order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at
  `;
  return c.json({ members });
});

app.post('/api/workspace/members/deactivate', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const membershipId = typeof body?.membershipId === 'string' ? body.membershipId : '';
  if (!/^[0-9a-f-]{36}$/i.test(companyId) || !/^[0-9a-f-]{36}$/i.test(membershipId)) {
    return c.json({ message: 'شناسه مجموعه یا عضویت معتبر نیست.' }, 422);
  }
  const sql = sqlFor(c);
  const actors = await sql`
    select role from public.memberships
    where user_id = ${user.id} and company_id = ${companyId} and active = true limit 1
  `;
  const actorRole = (actors[0] as { role: string } | undefined)?.role;
  if (!actorRole || !['owner', 'admin'].includes(actorRole)) {
    return c.json({ message: 'برای مدیریت اعضا دسترسی مالک یا مدیر لازم است.' }, 403);
  }
  const targets = await sql`
    select id, role from public.memberships
    where id = ${membershipId} and company_id = ${companyId} and active = true limit 1
  `;
  const target = targets[0] as { id: string; role: string } | undefined;
  if (!target) return c.json({ message: 'عضویت فعال در این مجموعه پیدا نشد.' }, 404);
  if (target.role === 'owner') return c.json({ message: 'دسترسی مالک را نمی‌توان از این صفحه غیرفعال کرد.' }, 403);
  if (target.role === 'admin' && actorRole !== 'owner') {
    return c.json({ message: 'فقط مالک می‌تواند دسترسی مدیر را غیرفعال کند.' }, 403);
  }
  await sql`update public.memberships set active = false where id = ${membershipId} and company_id = ${companyId}`;
  await sql.query("insert into public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata) values($1::uuid,'membership.deactivated','membership',$2,jsonb_build_object('company_id',$3::text))", [user.id, membershipId, companyId]);
  return c.json({ ok: true });
});


const DATA_TABLES = new Set([
 'customers','suppliers','products','price_agreements','orders','order_items','capacity_commitments','lots','quality_reviews',
 'shipments','delivery_evidence','invoices','settlements','notifications','audit_events','farm_sites','partnership_agreements',
 'flock_cycles','production_batches','daily_production_records','task_templates','operational_tasks','task_evidence',
 'operational_incidents','partner_financial_entries','partner_settlement_periods','shipment_locations','inventory_movements',
 'inventory_balances','company_goals'
]);
const RPC_ALLOWLIST = new Set([
 'allocate_order_item','record_inventory_movement','company_members','start_operational_task','submit_operational_task',
 'review_operational_task','create_partner_settlement_period','refresh_partner_settlement_period','approve_partner_settlement_period',
 'record_partner_settlement_payment'
]);
function quoteSqlIdentifier(value: string): string {
 if(!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('شناسه دیتابیس معتبر نیست.');
 return '"' + value + '"';
}
async function runForUser(c: Ctx,userId: string,statement: string,parameters: unknown[]=[]): Promise<Record<string,unknown>[]> {
 const sql=sqlFor(c);
 const result=await sql.transaction([
  sql.query("select set_config('medar.user_id', $1, true)",[userId]),
  sql.query(statement,parameters)
 ]);
 return (result[1]??[]) as Record<string,unknown>[];
}
async function listTableColumns(c: Ctx,table: string): Promise<Set<string>> {
 const sql=sqlFor(c);
 const rows=await sql.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[table]);
 return new Set(rows.map(row=>String((row as {column_name:string}).column_name)));
}
const RELATIONS:Record<string,Record<string,{target:string;local:string;foreign:string;many?:boolean}>>={
 orders:{customers:{target:'customers',local:'customer_id',foreign:'id'},order_items:{target:'order_items',local:'id',foreign:'order_id',many:true}},
 order_items:{products:{target:'products',local:'product_id',foreign:'id'},suppliers:{target:'suppliers',local:'supplier_id',foreign:'id'},capacity_commitments:{target:'capacity_commitments',local:'capacity_commitment_id',foreign:'id'}},
 invoices:{customers:{target:'customers',local:'customer_id',foreign:'id'},orders:{target:'orders',local:'order_id',foreign:'id'}},
 settlements:{suppliers:{target:'suppliers',local:'supplier_id',foreign:'id'}},
 capacity_commitments:{suppliers:{target:'suppliers',local:'supplier_id',foreign:'id'},products:{target:'products',local:'product_id',foreign:'id'}},
 lots:{products:{target:'products',local:'product_id',foreign:'id'},suppliers:{target:'suppliers',local:'supplier_id',foreign:'id'}},
 quality_reviews:{lots:{target:'lots',local:'lot_id',foreign:'id'}},
 shipments:{orders:{target:'orders',local:'order_id',foreign:'id'}},
 shipment_locations:{shipments:{target:'shipments',local:'shipment_id',foreign:'id'}},
 delivery_evidence:{shipments:{target:'shipments',local:'shipment_id',foreign:'id'}},
 inventory_movements:{products:{target:'products',local:'product_id',foreign:'id'}},
 production_batches:{farm_sites:{target:'farm_sites',local:'farm_site_id',foreign:'id'},suppliers:{target:'suppliers',local:'supplier_id',foreign:'id'}},
 partnership_agreements:{suppliers:{target:'suppliers',local:'supplier_id',foreign:'id'}},
 partner_financial_entries:{suppliers:{target:'suppliers',local:'supplier_id',foreign:'id'},partnership_agreements:{target:'partnership_agreements',local:'agreement_id',foreign:'id'}},
 partner_settlement_periods:{partnership_agreements:{target:'partnership_agreements',local:'agreement_id',foreign:'id'}},
 task_evidence:{operational_tasks:{target:'operational_tasks',local:'task_id',foreign:'id'}}
};
function splitSelection(value:string):string[] {
 const output:string[]=[];let depth=0,start=0;
 for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&depth===0){output.push(value.slice(start,i).trim());start=i+1;}}
 if(value.slice(start).trim())output.push(value.slice(start).trim());return output;
}
async function expandRelations(c:Ctx,userId:string,table:string,rows:Record<string,unknown>[],selection:string,depth=0):Promise<Record<string,unknown>[]> {
 if(!rows.length||depth>=3)return rows;
 const links=RELATIONS[table]??{};
 for(const part of splitSelection(selection)){
  const match=part.match(/^([a-z_][a-z0-9_]*)\((.*)\)$/s);if(!match||!links[match[1]])continue;
  const name=match[1],cfg=links[name],ids=Array.from(new Set(rows.map(row=>row[cfg.local]).filter(v=>typeof v==='string'&&v.length)));
  if(!ids.length){for(const row of rows)row[name]=cfg.many?[]:null;continue;}
  const marks=ids.map((_,i)=>'$'+(i+1)).join(',');
  const child=await runForUser(c,userId,'select * from public.'+quoteSqlIdentifier(cfg.target)+' where '+quoteSqlIdentifier(cfg.foreign)+' in ('+marks+') limit 500',ids);
  const expanded=await expandRelations(c,userId,cfg.target,child,match[2],depth+1), group=new Map<string,Record<string,unknown>[]>();
  for(const row of expanded){const key=String(row[cfg.foreign]??''),arr=group.get(key)??[];arr.push(row);group.set(key,arr);}
  for(const row of rows){const found=group.get(String(row[cfg.local]??''))??[];row[name]=cfg.many?found:(found[0]??null);}
 }
 return rows;
}
type DataFilter={column:string;op:string;value?:unknown};
function buildFilterSql(filters:DataFilter[],columns:Set<string>,params:unknown[],startAt:number,joinWith='and'):string {
 if(!filters.length)return '';
 const expressions=filters.map(filter=>{
  if(!columns.has(filter.column))throw new Error('ستون فیلتر معتبر نیست.');
  const col=quoteSqlIdentifier(filter.column),op=filter.op.toLowerCase();
  if(op==='is'||op==='not_is'){
   if(filter.value!==null&&filter.value!==true&&filter.value!==false)throw new Error('مقدار فیلتر معتبر نیست.');
   return col+(op==='not_is'?' is not ':' is ')+(filter.value===null?'null':filter.value?'true':'false');
  }
  if(op==='in'||op==='not_in'){
   const values=Array.isArray(filter.value)?filter.value:String(filter.value??'').replace(/^\(|\)$/g,'').split(',').filter(Boolean);
   if(!values.length)return op==='in'?'false':'true';
   const marks=values.map(v=>{params.push(v);return '$'+(startAt+params.length-1);});
   return col+(op==='not_in'?' not in (':' in (')+marks.join(',')+')';
  }
  const ops:Record<string,string>={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<=',like:'like',ilike:'ilike'};
  if(!ops[op])throw new Error('عملگر فیلتر پشتیبانی نمی‌شود.');
  params.push(filter.value??null);return col+' '+ops[op]+' $'+(startAt+params.length-1);
 });
 return '('+expressions.join(joinWith==='or'?' or ':' and ')+')';
}

type MembershipScope = {
 company_id: string;
 role: string;
 customer_id: string | null;
 supplier_id: string | null;
};
const INTERNAL_ROLES = new Set(['owner','admin','staff']);
const GENERIC_WRITABLE_TABLES = new Set([
 'customers','suppliers','products','price_agreements','orders','order_items','capacity_commitments','lots',
 'shipments','delivery_evidence','invoices','settlements','farm_sites','partnership_agreements','flock_cycles',
 'production_batches','daily_production_records','task_templates','operational_tasks','task_evidence',
 'operational_incidents','partner_financial_entries','company_goals','shipment_locations'
]);
const RPC_ONLY_TABLES = new Set(['inventory_movements','quality_reviews','partner_settlement_periods','inventory_balances','audit_events','notifications']);
async function loadMembershipScopes(c:Ctx,userId:string):Promise<MembershipScope[]> {
 const sql=sqlFor(c);
 const rows=await sql.query(
  "select company_id::text,role::text,customer_id::text,supplier_id::text from public.memberships where user_id=$1::uuid and active=true",
  [userId]
 );
 return rows as MembershipScope[];
}
function buildMembershipScopeSql(table:string,columns:Set<string>,memberships:MembershipScope[],userId:string,params:unknown[],startAt=1):string {
 if(!columns.has('company_id')||!memberships.length)return 'false';
 const add=(value:unknown)=>{params.push(value);return '$'+(startAt+params.length-1);};
 const branches=memberships.map(m=>{
  const company=add(m.company_id);
  const base='company_id = '+company;
  if(INTERNAL_ROLES.has(m.role))return '('+base+')';
  const actor=add(userId);
  if(table==='notifications'&&columns.has('user_id'))return '('+base+' and user_id = '+actor+')';
  if(m.role==='customer'&&m.customer_id){
   const customer=add(m.customer_id);
   if(table==='customers')return '('+base+' and id = '+customer+')';
   if(table==='orders'||table==='invoices'||table==='price_agreements')return '('+base+' and customer_id = '+customer+')';
   if(table==='products')return '('+base+' and active = true)';
   const customerOrders='select o.id from public.orders o where o.company_id = '+company+' and o.customer_id = '+customer;
   if(table==='order_items')return '('+base+' and order_id in ('+customerOrders+'))';
   const customerShipments='select s.id from public.shipments s join public.orders o on o.company_id=s.company_id and o.id=s.order_id where s.company_id = '+company+' and o.customer_id = '+customer;
   if(table==='shipments')return '('+base+' and order_id in ('+customerOrders+'))';
   if(table==='delivery_evidence'||table==='shipment_locations')return '('+base+' and shipment_id in ('+customerShipments+'))';
   return '(false)';
  }
  if(m.role==='supplier'&&m.supplier_id){
   const supplier=add(m.supplier_id);
   if(table==='suppliers')return '('+base+' and id = '+supplier+')';
   if(table==='products')return '('+base+' and active = true)';
   if(columns.has('supplier_id'))return '('+base+' and supplier_id = '+supplier+')';
   if(table==='operational_tasks')return '('+base+' and assignee_supplier_id = '+supplier+')';
   if(table==='task_evidence')return '('+base+' and task_id in (select t.id from public.operational_tasks t where t.company_id = '+company+' and t.assignee_supplier_id = '+supplier+'))';
   if(table==='daily_production_records')return '('+base+' and batch_id in (select b.id from public.production_batches b where b.company_id = '+company+' and b.supplier_id = '+supplier+'))';
   if(table==='flock_cycles')return '('+base+' and farm_site_id in (select f.id from public.farm_sites f where f.company_id = '+company+' and f.supplier_id = '+supplier+'))';
   if(table==='operational_incidents')return '('+base+' and (reported_supplier_id = '+supplier+' or batch_id in (select b.id from public.production_batches b where b.company_id = '+company+' and b.supplier_id = '+supplier+')))'; 
   return '(false)';
  }
  if(m.role==='driver'){
   if(table==='products')return '('+base+' and active = true)';
   if(table==='shipments')return '('+base+' and driver_user_id = '+actor+')';
   if(table==='shipment_locations')return '('+base+' and driver_user_id = '+actor+')';
   if(table==='delivery_evidence')return '('+base+' and shipment_id in (select s.id from public.shipments s where s.company_id = '+company+' and s.driver_user_id = '+actor+'))';
   const assignedOrders='select s.order_id from public.shipments s where s.company_id = '+company+' and s.driver_user_id = '+actor;
   if(table==='orders')return '('+base+' and id in ('+assignedOrders+'))';
   if(table==='order_items')return '('+base+' and order_id in ('+assignedOrders+'))';
   if(table==='customers')return '('+base+' and id in (select o.customer_id from public.orders o where o.company_id = '+company+' and o.id in ('+assignedOrders+')))';
   return '(false)';
  }
  return '(false)';
 });
 return '('+branches.join(' or ')+')';
}
function sanitizeExternalRows(table:string,rows:Record<string,unknown>[],memberships:MembershipScope[]):Record<string,unknown>[] {
 return rows.map(row=>{
  const company=String(row.company_id??'');
  const roles=memberships.filter(m=>m.company_id===company).map(m=>m.role);
  if(roles.some(role=>INTERNAL_ROLES.has(role)))return row;
  const result={...row};
  if(roles.includes('driver')){
   for(const key of ['credit_limit','unit_price','amount','paid_amount','paid_at','paid_by','payment_reference','net_result','company_share_amount','partner_share_amount','balance_due_to_partner','balance_due_to_company','approved_shared_expenses','unpaid_approved_expenses','company_paid_shared_expenses','partner_paid_shared_expenses','recorded_cash_available','settled_amount','external_reference','calculation_snapshot'])delete result[key];
  } else if(roles.includes('customer')){
   for(const key of ['credit_limit','partner_share_amount','company_share_amount','net_result','balance_due_to_partner','balance_due_to_company','approved_shared_expenses','unpaid_approved_expenses','company_paid_shared_expenses','partner_paid_shared_expenses','recorded_cash_available','settled_amount','calculation_snapshot'])delete result[key];
  }
  return result;
 });
}
function companyRole(memberships:MembershipScope[],companyId:string):MembershipScope|undefined {
 return memberships.find(m=>m.company_id===companyId);
}
function canWriteInternally(membership:MembershipScope|undefined):boolean {
 return Boolean(membership&&INTERNAL_ROLES.has(membership.role));
}
const UPDATE_PROTECTED_FIELDS:Record<string,Set<string>>={
 orders:new Set(['status','created_by']),
 shipments:new Set(['stage','departed_at','delivered_at','failure_reason','driver_user_id']),
 invoices:new Set(['status','paid_amount','paid_at','paid_by','payment_reference']),
 settlements:new Set(['status','paid_at','paid_by','payment_reference']),
 operational_tasks:new Set(['status','started_at','submitted_at','reviewed_at','reviewed_by','review_note','assigned_by']),
 production_batches:new Set(['status','quality_status','completed_on','rejected_quantity']),
 partner_financial_entries:new Set(['status','direction','paid_amount','payment_status','approved_by','approved_at','posted_by','posted_at','linked_entry_id','adjustment_effect']),
 partner_settlement_periods:new Set(['status','approved_by','approved_at','settled_by','settled_at','calculation_snapshot','net_result','company_share_amount','partner_share_amount','balance_due_to_partner','balance_due_to_company']),
 inventory_movements:new Set(['company_id','product_id','movement_type','quantity','unit_cost'])
};
function applyInsertActorFields(table:string,row:Record<string,unknown>,columns:Set<string>,userId:string):Record<string,unknown> {
 const out={...row};
 for(const field of ['user_id','created_by','updated_by','recorded_by','captured_by','uploaded_by','reported_by','submitted_by'])delete out[field];
 if(columns.has('created_by'))out.created_by=userId;
 if(columns.has('updated_by'))out.updated_by=userId;
 if(columns.has('recorded_by'))out.recorded_by=userId;
 if(columns.has('captured_by'))out.captured_by=userId;
 if(columns.has('uploaded_by'))out.uploaded_by=userId;
 if(columns.has('reported_by'))out.reported_by=userId;
 if(columns.has('submitted_by')&&table==='partner_financial_entries')out.submitted_by=userId;
 return out;
}
app.post('/api/data/:table',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 const table=c.req.param('table');if(!DATA_TABLES.has(table))return c.json({message:'جدول در API مجاز نیست.'},404);
 const body=await c.req.json<Record<string,unknown>>().catch(()=>null);if(!body)return c.json({message:'درخواست داده معتبر نیست.'},400);
 const action=typeof body.action==='string'?body.action:'select';
 if(!['select','insert','update','delete'].includes(action))return c.json({message:'عملیات داده مجاز نیست.'},422);
 try{
  const scopes=await loadMembershipScopes(c,user.id);
  if(!scopes.length)return c.json({message:'این حساب به هیچ فضای کاری فعالی متصل نیست.'},403);
  const columns=await listTableColumns(c,table);
  if(!columns.has('company_id'))return c.json({message:'جدول فاقد محدوده شرکت است و از API عمومی قابل دسترسی نیست.'},403);
  const tableName='public.'+quoteSqlIdentifier(table);
  if(action==='select'){
   const params:unknown[]=[];
   const filters=Array.isArray(body.filters)?body.filters as DataFilter[]:[];
   const where=buildFilterSql(filters,columns,params,1);
   const ors=Array.isArray(body.orFilters)?body.orFilters as DataFilter[]:[];
   const orWhere=buildFilterSql(ors,columns,params,1,'or');
   const scope=buildMembershipScopeSql(table,columns,scopes,user.id,params,1);
   const condition=[scope,where,orWhere].filter(Boolean).map(x=>'('+x+')').join(' and ');
   const whereSql=' where '+condition;
   const counts=body.count===true?await runForUser(c,user.id,'select count(*)::int as count from '+tableName+whereSql,[...params]):[];
   if(body.head===true)return c.json({data:[],count:counts.length?Number(counts[0].count):null,error:null});
   let query='select * from '+tableName+whereSql;
   if(body.order&&typeof body.order==='object'){
    const order=body.order as {column?:string;ascending?:boolean};
    if(order.column&&!columns.has(order.column))throw new Error('ستون مرتب‌سازی معتبر نیست.');
    if(order.column)query+=' order by '+quoteSqlIdentifier(order.column)+(order.ascending===true?' asc':' desc');
   }
   params.push(Math.max(1,Math.min(500,Number.isFinite(Number(body.limit))?Math.trunc(Number(body.limit)):200)));
   query+=' limit $'+params.length;
   let rows=await runForUser(c,user.id,query,params);
   rows=await expandRelations(c,user.id,table,rows,typeof body.selection==='string'?body.selection:'*');
   rows=sanitizeExternalRows(table,rows,scopes);
   return c.json({data:rows,count:counts.length?Number(counts[0].count):rows.length,error:null});
  }
  const filters=Array.isArray(body.filters)?body.filters as DataFilter[]:[];
  if(!filters.length&&action!=='insert')return c.json({message:'برای ویرایش یا حذف باید فیلتر رکورد مشخص شود.'},422);
  const writable=GENERIC_WRITABLE_TABLES.has(table)&&!RPC_ONLY_TABLES.has(table);
  if(!writable)return c.json({message:'این عملیات فقط از مسیر عملیاتی مجاز سمت سرور قابل انجام است.'},403);
  const protectedKeys=new Set(['id','company_id','password_hash','token_hash','user_id','created_by','updated_by','recorded_by','captured_by','uploaded_by','reported_by','submitted_by','reviewed_by','approved_by','posted_by','paid_by','resolved_by','actor_id','assigned_by']);
  if(action==='insert'){
   const input=Array.isArray(body.values)?body.values as Record<string,unknown>[]:[body.values as Record<string,unknown>];
   if(!input.length||input.some(row=>!row||typeof row!=='object'||Array.isArray(row)))return c.json({message:'رکورد ورودی معتبر نیست.'},422);
   const sanitized:Record<string,unknown>[]=[];
   for(const original of input){
    const companyId=typeof original.company_id==='string'?original.company_id:'';
    const membership=companyRole(scopes,companyId);
    if(!membership)return c.json({message:'این شرکت به حساب فعلی تعلق ندارد.'},403);
    const row=applyInsertActorFields(table,original,columns,user.id);
    if(INTERNAL_ROLES.has(membership.role)){
     if(RPC_ONLY_TABLES.has(table))return c.json({message:'این رکورد باید از عملیات معتبر سمت سرور ثبت شود.'},403);
     if(table==='orders'){row.status='draft';row.created_by=user.id;}
     if(table==='shipments')row.stage='planned';
     if(table==='operational_tasks')row.status='pending';
     if(table==='partner_financial_entries'){row.status='submitted';row.submitted_by=user.id;}
     if(table==='invoices'){row.status='draft';row.paid_amount=0;}
     sanitized.push(row);continue;
    }
    if(membership.role==='customer'&&membership.customer_id&&table==='orders'){
     row.customer_id=membership.customer_id;row.status='draft';row.created_by=user.id;sanitized.push(row);continue;
    }
    if(membership.role==='customer'&&membership.customer_id&&table==='order_items'){
     const orderId=String(original.order_id??''),productId=String(original.product_id??'');
     const sql=sqlFor(c);
     const owned=await sql.query("select id from public.orders where id=$1::uuid and company_id=$2::uuid and customer_id=$3::uuid and status='draft' limit 1",[orderId,companyId,membership.customer_id]);
     if(!owned.length)return c.json({message:'اقلام فقط برای سفارش پیش‌نویس خودت قابل ثبت‌اند.'},403);
     const prices=await sql.query("select unit_price,min_qty from public.price_agreements where company_id=$1::uuid and customer_id=$2::uuid and product_id=$3::uuid and valid_from<=current_date and (valid_to is null or valid_to>=current_date) order by valid_from desc limit 1",[companyId,membership.customer_id,productId]);
     if(!prices.length)return c.json({message:'برای این محصول قرارداد قیمت فعال پیدا نشد.'},422);
     const price=prices[0] as {unit_price:string|number;min_qty:string|number};
     if(!Number.isFinite(Number(original.quantity))||Number(original.quantity)<Number(price.min_qty))return c.json({message:'مقدار سفارش از حداقل قرارداد کمتر است.'},422);
     row.unit_price=Number(price.unit_price);sanitized.push(row);continue;
    }
    if(membership.role==='driver'&&(table==='shipment_locations'||table==='delivery_evidence')){
     const shipmentId=String(original.shipment_id??'');
     const sql=sqlFor(c);
     const assigned=await sql.query("select id from public.shipments where id=$1::uuid and company_id=$2::uuid and driver_user_id=$3::uuid limit 1",[shipmentId,companyId,user.id]);
     if(!assigned.length)return c.json({message:'این محموله به راننده فعلی تخصیص داده نشده است.'},403);
     if(table==='shipment_locations')row.driver_user_id=user.id;
     if(table==='delivery_evidence'){
      row.captured_by=user.id;
      if(typeof row.storage_path==='string'&&row.storage_path){
       const file=await sql.query("select id from public.medar_files where bucket_id='delivery-evidence' and company_id=$1::uuid and name=$2 and split_part(name,'/',2)=$3 limit 1",[companyId,row.storage_path,shipmentId]);
       if(!file.length)return c.json({message:'مدرک بارگذاری‌شده به این محموله تعلق ندارد.'},422);
      }
     }
     sanitized.push(row);continue;
    }
    if(membership.role==='supplier'&&membership.supplier_id&&table==='task_evidence'){
     const sql=sqlFor(c),taskId=String(original.task_id??'');
     const assigned=await sql.query("select id from public.operational_tasks where id=$1::uuid and company_id=$2::uuid and assignee_supplier_id=$3::uuid limit 1",[taskId,companyId,membership.supplier_id]);
     if(!assigned.length)return c.json({message:'مدرک فقط برای وظیفه واگذارشده به تأمین‌کننده فعلی قابل ثبت است.'},403);
     row.uploaded_by=user.id;sanitized.push(row);continue;
    }
    if(membership.role==='supplier'&&membership.supplier_id&&table==='operational_incidents'){
     if(String(original.reported_supplier_id??'')!==membership.supplier_id)return c.json({message:'گزارش رخداد باید به حساب تأمین‌کننده خودت متصل باشد.'},403);
     row.reported_by=user.id;sanitized.push(row);continue;
    }
    return c.json({message:'نقش فعلی اجازه ایجاد این رکورد را ندارد.'},403);
   }
   const keys=Array.from(new Set(sanitized.flatMap(row=>Object.keys(row).filter(key=>columns.has(key)&&!['password_hash','token_hash','user_id'].includes(key)))));
   if(!keys.length||sanitized.some(row=>Object.keys(row).some(key=>!columns.has(key))))return c.json({message:'یکی از فیلدهای رکورد غیرمجاز است.'},422);
   const insertParams:unknown[]=[];
   const tuples=sanitized.map(row=>'('+keys.map(key=>{insertParams.push(row[key]??null);return '$'+insertParams.length;}).join(',')+')');
   const inserted=await runForUser(c,user.id,'insert into '+tableName+' ('+keys.map(quoteSqlIdentifier).join(',')+') values '+tuples.join(',')+' returning *',insertParams);
   return c.json({data:sanitizeExternalRows(table,inserted,scopes),count:inserted.length,error:null},201);
  }
  const mutationScopes=scopes.filter(m=>INTERNAL_ROLES.has(m.role));
  if(!mutationScopes.length)return c.json({message:'ویرایش یا حذف برای نقش فعلی مجاز نیست.'},403);
  const values=action==='update'&&body.values&&typeof body.values==='object'&&!Array.isArray(body.values)?body.values as Record<string,unknown>:null;
  if(action==='update'&&(!values||!Object.keys(values).length||Object.keys(values).some(key=>!columns.has(key)||protectedKeys.has(key)||UPDATE_PROTECTED_FIELDS[table]?.has(key))))return c.json({message:'فیلدهای ویرایش نامعتبر یا محافظت‌شده‌اند.'},422);
  const params:unknown[]=[];
  const where=buildFilterSql(filters,columns,params,1);
  const ors=Array.isArray(body.orFilters)?body.orFilters as DataFilter[]:[];
  const orWhere=buildFilterSql(ors,columns,params,1,'or');
  const scope=buildMembershipScopeSql(table,columns,mutationScopes,user.id,params,1);
  const condition=[scope,where,orWhere].filter(Boolean).map(part=>'('+part+')').join(' and ');
  if(action==='update'){
   const setParams:unknown[]=[];
   const setSql=Object.entries(values??{}).map(([key,value])=>{setParams.push(value??null);return quoteSqlIdentifier(key)+' = $'+setParams.length;}).join(',');
   const finalParams=[...setParams,...params];
   const adjusted=condition.replace(/\$(\d+)/g,(_m,n)=>'$'+(Number(n)+setParams.length));
   const rows=await runForUser(c,user.id,'update '+tableName+' set '+setSql+' where '+adjusted+' returning *',finalParams);
   return c.json({data:rows,count:rows.length,error:null});
  }
  const rows=await runForUser(c,user.id,'delete from '+tableName+' where '+condition+' returning *',params);
  return c.json({data:rows,count:rows.length,error:null});
 }catch(error){
  const e=error as {code?:string};
  return c.json({message:e.code?'دسترسی یا اعتبارسنجی داده ناموفق بود.':(error instanceof Error?error.message:'درخواست داده ناموفق بود.')},400);
 }
});
app.post('/api/rpc/:name',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 const name=c.req.param('name');if(!RPC_ALLOWLIST.has(name))return c.json({message:'عملیات سرور مجاز نیست.'},404);
 const body=await c.req.json<Record<string,unknown>>().catch(()=>null);
 const args=body?.args&&typeof body.args==='object'&&!Array.isArray(body.args)?body.args as Record<string,unknown>:{};
 const sql=sqlFor(c);
 try{
  const meta=await sql.query("select p.proargnames[1:p.pronargs] as arg_names,array(select format_type(t,null) from unnest(p.proargtypes::oid[]) with ordinality as a(t,ord) order by ord) as arg_types from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 order by p.pronargs limit 2",[name]);
  if(meta.length!==1)return c.json({message:'عملیات دیتابیس در دسترس نیست یا مبهم است.'},404);
  const info=meta[0] as {arg_names:string[];arg_types:string[]},names=info.arg_names??[],types=info.arg_types??[];
  if(names.some(n=>!Object.prototype.hasOwnProperty.call(args,n))||Object.keys(args).some(n=>!names.includes(n)))return c.json({message:'پارامترهای عملیات کامل نیستند یا پارامتر ناشناخته وجود دارد.'},422);
  if(types.some(t=>!/^[a-zA-Z_][a-zA-Z0-9_ .]*$/.test(t)))return c.json({message:'نوع پارامتر عملیات معتبر نیست.'},500);
  const marks=names.map((n,i)=>'$'+(i+1)+'::'+types[i]),values=names.map(n=>args[n]??null);
  const rows=await runForUser(c,user.id,'select * from public.'+quoteSqlIdentifier(name)+'('+marks.join(',')+')',values);
  return c.json({data:rows,error:null});
 }catch(error){
  const caught=error as {code?:string};
  return c.json({message:caught.code?'این عملیات با توجه به نقش یا وضعیت فعلی مجاز نیست.':'اجرای عملیات ناموفق بود.'},400);
 }
});
app.post('/api/access-requests',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 return c.json({message:'درخواست نقش عمومی فعال نیست؛ با کد دعوت به یک مجموعه بپیوند.',account:user.username},410);
});
const PRIVATE_BUCKET_RULES:Record<string,{maxBytes:number;contentTypes:Set<string>}>={
 'delivery-evidence':{maxBytes:10*1024*1024,contentTypes:new Set(['image/jpeg','image/png','image/webp','application/pdf'])},
 'operational-evidence':{maxBytes:10*1024*1024,contentTypes:new Set(['image/jpeg','image/png','image/webp','application/pdf'])},
 'contract-documents':{maxBytes:20*1024*1024,contentTypes:new Set(['application/pdf','image/jpeg','image/png'])}
};
function normalizePrivatePath(value:string):string|null{
 const parts=value.split('/');
 if(parts.length<3||parts.length>8||parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')||p.includes('\0')))return null;
 if(!/^[0-9a-f-]{36}$/i.test(parts[0])||!/^[0-9a-f-]{36}$/i.test(parts[1]))return null;
 if(parts.some(p=>p.length>180||p.trim()!==p))return null;
 return parts.join('/');
}
async function memberRoleForCompany(c:Ctx,userId:string,companyId:string):Promise<string|null>{
 const sql=sqlFor(c);
 const rows=await sql.query("select role from public.memberships where user_id=$1::uuid and company_id=$2::uuid and active=true limit 1",[userId,companyId]);
 return (rows[0] as {role:string}|undefined)?.role??null;
}
app.put('/api/storage/:bucket',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 if(!c.env.FILE_STORE)return c.json({message:'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.'},503);
 const bucket=c.req.param('bucket'),rules=PRIVATE_BUCKET_RULES[bucket];if(!rules)return c.json({message:'مخزن فایل مجاز نیست.'},404);
 const path=normalizePrivatePath(c.req.query('path')??'');if(!path)return c.json({message:'مسیر فایل معتبر نیست.'},422);
 const companyId=path.split('/')[0],role=await memberRoleForCompany(c,user.id,companyId);
 if(!role)return c.json({message:'برای این مجموعه دسترسی فعال نداری.'},403);
 if(bucket==='contract-documents'&&!['owner','admin'].includes(role))return c.json({message:'فقط مالک یا مدیر می‌تواند سند قرارداد را بارگذاری کند.'},403);
 const contentType=(c.req.header('content-type')??'application/octet-stream').split(';')[0].trim().toLowerCase();
 if(!rules.contentTypes.has(contentType))return c.json({message:'نوع فایل پشتیبانی نمی‌شود.'},415);
 const len=Number(c.req.header('content-length')??0);if(len>rules.maxBytes)return c.json({message:'حجم فایل از محدودیت مخزن بیشتر است.'},413);
 const bytes=await c.req.arrayBuffer();if(bytes.byteLength>rules.maxBytes)return c.json({message:'حجم فایل از محدودیت مخزن بیشتر است.'},413);
 const existing=await runForUser(c,user.id,'select id from public.medar_files where bucket_id=$1 and name=$2 limit 1',[bucket,path]);
 if(existing.length&&c.req.header('x-upsert')!=='true')return c.json({message:'فایلی با این مسیر قبلاً وجود دارد.'},409);
 try{
  await c.env.FILE_STORE.put(bucket+'/'+path,bytes,{httpMetadata:{contentType}});
  const metadata=await runForUser(c,user.id,'insert into public.medar_files(bucket_id,name,company_id,content_type,size_bytes,uploaded_by) values($1,$2,$3::uuid,$4,$5,$6::uuid) on conflict(bucket_id,name) do update set content_type=excluded.content_type,size_bytes=excluded.size_bytes,uploaded_by=excluded.uploaded_by returning id',[bucket,path,companyId,contentType,bytes.byteLength,user.id]);
  if(!metadata.length){await c.env.FILE_STORE.delete(bucket+'/'+path);return c.json({message:'قواعد دسترسی بارگذاری این مدرک را مجاز نمی‌دانند.'},403);}
  return c.json({data:{path,bucket,size:bytes.byteLength,contentType},error:null},201);
 }catch{return c.json({message:'ذخیره فایل یا ثبت مشخصات آن ناموفق بود.'},400);}
});
app.get('/api/storage/:bucket',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 if(!c.env.FILE_STORE)return c.json({message:'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.'},503);
 const bucket=c.req.param('bucket');if(!PRIVATE_BUCKET_RULES[bucket])return c.json({message:'مخزن فایل مجاز نیست.'},404);
 const path=normalizePrivatePath(c.req.query('path')??'');if(!path)return c.json({message:'مسیر فایل معتبر نیست.'},422);
 const meta=await runForUser(c,user.id,'select content_type from public.medar_files where bucket_id=$1 and name=$2 limit 1',[bucket,path]);
 if(!meta.length)return c.json({message:'فایل پیدا نشد یا دسترسی به آن مجاز نیست.'},404);
 const object=await c.env.FILE_STORE.get(bucket+'/'+path);if(!object)return c.json({message:'فایل در فضای ذخیره‌سازی پیدا نشد.'},404);
 const headers=new Headers();object.writeHttpMetadata(headers);headers.set('Content-Type',String(meta[0].content_type??object.httpMetadata?.contentType??'application/octet-stream'));
 headers.set('Cache-Control','private, no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Security-Policy',"default-src 'none'; sandbox");
 return new Response(object.body,{status:200,headers});
});
app.post('/api/storage/:bucket/remove',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 if(!c.env.FILE_STORE)return c.json({message:'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.'},503);
 const bucket=c.req.param('bucket');if(!PRIVATE_BUCKET_RULES[bucket])return c.json({message:'مخزن فایل مجاز نیست.'},404);
 const body=await c.req.json<{paths?:unknown}>().catch(()=>null);
 if(!Array.isArray(body?.paths)||body.paths.length<1||body.paths.length>50)return c.json({message:'فهرست فایل‌ها معتبر نیست.'},422);
 const paths=body.paths.map(raw=>typeof raw==='string'?normalizePrivatePath(raw):null);
 if(paths.some(path=>!path))return c.json({message:'یکی از مسیرهای فایل معتبر نیست.'},422);
 const validPaths=paths as string[],params:unknown[]=[bucket],marks=validPaths.map(path=>{params.push(path);return '$'+params.length;});
 try{
  const allowed=await runForUser(c,user.id,'select name from public.medar_files where bucket_id=$1 and name in ('+marks.join(',')+')',params);
  const names=allowed.map(row=>String(row.name));if(!names.length)return c.json({data:[],error:null});
  await c.env.FILE_STORE.delete(names.map(name=>bucket+'/'+name));
  const deleteParams:unknown[]=[bucket],deleteMarks=names.map(name=>{deleteParams.push(name);return '$'+deleteParams.length;});
  await runForUser(c,user.id,'delete from public.medar_files where bucket_id=$1 and name in ('+deleteMarks.join(',')+') returning id',deleteParams);
  return c.json({data:names.map(name=>({name})),error:null});
 }catch{return c.json({message:'حذف فایل یا مشخصات آن ناموفق بود.'},400);}
});

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ message: 'مسیر API پیدا نشد.' }, 404);
  return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ message: 'مسیر پیدا نشد.' }, 404);
});
app.onError((error, c) => {
  const requestId = crypto.randomUUID();
  return c.json({ message: 'درخواست انجام نشد. دوباره تلاش کن.', requestId }, 500);
});
export default app;
+setParams.length;}).join(',');
    const finalParams=[...setParams,...scopedParams];
    const rewrittenCondition=condition.replace(/\$(\d+)/g,(_match,n)=>'
});
app.post('/api/rpc/:name',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 const name=c.req.param('name');if(!RPC_ALLOWLIST.has(name))return c.json({message:'عملیات سرور مجاز نیست.'},404);
 const body=await c.req.json<Record<string,unknown>>().catch(()=>null);
 const args=body?.args&&typeof body.args==='object'&&!Array.isArray(body.args)?body.args as Record<string,unknown>:{};
 const sql=sqlFor(c);
 try{
  const meta=await sql.query("select p.proargnames[1:p.pronargs] as arg_names,array(select format_type(t,null) from unnest(p.proargtypes::oid[]) with ordinality as a(t,ord) order by ord) as arg_types from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 order by p.pronargs limit 2",[name]);
  if(meta.length!==1)return c.json({message:'عملیات دیتابیس در دسترس نیست یا مبهم است.'},404);
  const info=meta[0] as {arg_names:string[];arg_types:string[]},names=info.arg_names??[],types=info.arg_types??[];
  if(names.some(n=>!Object.prototype.hasOwnProperty.call(args,n))||Object.keys(args).some(n=>!names.includes(n)))return c.json({message:'پارامترهای عملیات کامل نیستند یا پارامتر ناشناخته وجود دارد.'},422);
  if(types.some(t=>!/^[a-zA-Z_][a-zA-Z0-9_ .]*$/.test(t)))return c.json({message:'نوع پارامتر عملیات معتبر نیست.'},500);
  const marks=names.map((n,i)=>'$'+(i+1)+'::'+types[i]),values=names.map(n=>args[n]??null);
  const rows=await runForUser(c,user.id,'select * from public.'+quoteSqlIdentifier(name)+'('+marks.join(',')+')',values);
  return c.json({data:rows,error:null});
 }catch(error){
  const caught=error as {code?:string};
  return c.json({message:caught.code?'این عملیات با توجه به نقش یا وضعیت فعلی مجاز نیست.':'اجرای عملیات ناموفق بود.'},400);
 }
});
app.post('/api/access-requests',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 return c.json({message:'درخواست نقش عمومی فعال نیست؛ با کد دعوت به یک مجموعه بپیوند.',account:user.username},410);
});
const PRIVATE_BUCKET_RULES:Record<string,{maxBytes:number;contentTypes:Set<string>}>={
 'delivery-evidence':{maxBytes:10*1024*1024,contentTypes:new Set(['image/jpeg','image/png','image/webp','application/pdf'])},
 'operational-evidence':{maxBytes:10*1024*1024,contentTypes:new Set(['image/jpeg','image/png','image/webp','application/pdf'])},
 'contract-documents':{maxBytes:20*1024*1024,contentTypes:new Set(['application/pdf','image/jpeg','image/png'])}
};
function normalizePrivatePath(value:string):string|null{
 const parts=value.split('/');
 if(parts.length<3||parts.length>8||parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')||p.includes('\0')))return null;
 if(!/^[0-9a-f-]{36}$/i.test(parts[0])||!/^[0-9a-f-]{36}$/i.test(parts[1]))return null;
 if(parts.some(p=>p.length>180||p.trim()!==p))return null;
 return parts.join('/');
}
async function memberRoleForCompany(c:Ctx,userId:string,companyId:string):Promise<string|null>{
 const sql=sqlFor(c);
 const rows=await sql.query("select role from public.memberships where user_id=$1::uuid and company_id=$2::uuid and active=true limit 1",[userId,companyId]);
 return (rows[0] as {role:string}|undefined)?.role??null;
}
app.put('/api/storage/:bucket',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 if(!c.env.FILE_STORE)return c.json({message:'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.'},503);
 const bucket=c.req.param('bucket'),rules=PRIVATE_BUCKET_RULES[bucket];if(!rules)return c.json({message:'مخزن فایل مجاز نیست.'},404);
 const path=normalizePrivatePath(c.req.query('path')??'');if(!path)return c.json({message:'مسیر فایل معتبر نیست.'},422);
 const companyId=path.split('/')[0],role=await memberRoleForCompany(c,user.id,companyId);
 if(!role)return c.json({message:'برای این مجموعه دسترسی فعال نداری.'},403);
 if(bucket==='contract-documents'&&!['owner','admin'].includes(role))return c.json({message:'فقط مالک یا مدیر می‌تواند سند قرارداد را بارگذاری کند.'},403);
 const contentType=(c.req.header('content-type')??'application/octet-stream').split(';')[0].trim().toLowerCase();
 if(!rules.contentTypes.has(contentType))return c.json({message:'نوع فایل پشتیبانی نمی‌شود.'},415);
 const len=Number(c.req.header('content-length')??0);if(len>rules.maxBytes)return c.json({message:'حجم فایل از محدودیت مخزن بیشتر است.'},413);
 const bytes=await c.req.arrayBuffer();if(bytes.byteLength>rules.maxBytes)return c.json({message:'حجم فایل از محدودیت مخزن بیشتر است.'},413);
 const existing=await runForUser(c,user.id,'select id from public.medar_files where bucket_id=$1 and name=$2 limit 1',[bucket,path]);
 if(existing.length&&c.req.header('x-upsert')!=='true')return c.json({message:'فایلی با این مسیر قبلاً وجود دارد.'},409);
 try{
  await c.env.FILE_STORE.put(bucket+'/'+path,bytes,{httpMetadata:{contentType}});
  const metadata=await runForUser(c,user.id,'insert into public.medar_files(bucket_id,name,company_id,content_type,size_bytes,uploaded_by) values($1,$2,$3::uuid,$4,$5,$6::uuid) on conflict(bucket_id,name) do update set content_type=excluded.content_type,size_bytes=excluded.size_bytes,uploaded_by=excluded.uploaded_by returning id',[bucket,path,companyId,contentType,bytes.byteLength,user.id]);
  if(!metadata.length){await c.env.FILE_STORE.delete(bucket+'/'+path);return c.json({message:'قواعد دسترسی بارگذاری این مدرک را مجاز نمی‌دانند.'},403);}
  return c.json({data:{path,bucket,size:bytes.byteLength,contentType},error:null},201);
 }catch{return c.json({message:'ذخیره فایل یا ثبت مشخصات آن ناموفق بود.'},400);}
});
app.get('/api/storage/:bucket',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 if(!c.env.FILE_STORE)return c.json({message:'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.'},503);
 const bucket=c.req.param('bucket');if(!PRIVATE_BUCKET_RULES[bucket])return c.json({message:'مخزن فایل مجاز نیست.'},404);
 const path=normalizePrivatePath(c.req.query('path')??'');if(!path)return c.json({message:'مسیر فایل معتبر نیست.'},422);
 const meta=await runForUser(c,user.id,'select content_type from public.medar_files where bucket_id=$1 and name=$2 limit 1',[bucket,path]);
 if(!meta.length)return c.json({message:'فایل پیدا نشد یا دسترسی به آن مجاز نیست.'},404);
 const object=await c.env.FILE_STORE.get(bucket+'/'+path);if(!object)return c.json({message:'فایل در فضای ذخیره‌سازی پیدا نشد.'},404);
 const headers=new Headers();object.writeHttpMetadata(headers);headers.set('Content-Type',String(meta[0].content_type??object.httpMetadata?.contentType??'application/octet-stream'));
 headers.set('Cache-Control','private, no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Security-Policy',"default-src 'none'; sandbox");
 return new Response(object.body,{status:200,headers});
});
app.post('/api/storage/:bucket/remove',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 if(!c.env.FILE_STORE)return c.json({message:'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.'},503);
 const bucket=c.req.param('bucket');if(!PRIVATE_BUCKET_RULES[bucket])return c.json({message:'مخزن فایل مجاز نیست.'},404);
 const body=await c.req.json<{paths?:unknown}>().catch(()=>null);
 if(!Array.isArray(body?.paths)||body.paths.length<1||body.paths.length>50)return c.json({message:'فهرست فایل‌ها معتبر نیست.'},422);
 const paths=body.paths.map(raw=>typeof raw==='string'?normalizePrivatePath(raw):null);
 if(paths.some(path=>!path))return c.json({message:'یکی از مسیرهای فایل معتبر نیست.'},422);
 const validPaths=paths as string[],params:unknown[]=[bucket],marks=validPaths.map(path=>{params.push(path);return '$'+params.length;});
 try{
  const allowed=await runForUser(c,user.id,'select name from public.medar_files where bucket_id=$1 and name in ('+marks.join(',')+')',params);
  const names=allowed.map(row=>String(row.name));if(!names.length)return c.json({data:[],error:null});
  await c.env.FILE_STORE.delete(names.map(name=>bucket+'/'+name));
  const deleteParams:unknown[]=[bucket],deleteMarks=names.map(name=>{deleteParams.push(name);return '$'+deleteParams.length;});
  await runForUser(c,user.id,'delete from public.medar_files where bucket_id=$1 and name in ('+deleteMarks.join(',')+') returning id',deleteParams);
  return c.json({data:names.map(name=>({name})),error:null});
 }catch{return c.json({message:'حذف فایل یا مشخصات آن ناموفق بود.'},400);}
});

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ message: 'مسیر API پیدا نشد.' }, 404);
  return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ message: 'مسیر پیدا نشد.' }, 404);
});
app.onError((error, c) => {
  const requestId = crypto.randomUUID();
  return c.json({ message: 'درخواست انجام نشد. دوباره تلاش کن.', requestId }, 500);
});
export default app;
+(Number(n)+setParams.length));
    const updated=await runForUser(c,user.id,'update '+tableName+' set '+setSql+' where '+rewrittenCondition+' returning *',finalParams);
    return c.json({data:sanitizeExternalRows(table,updated,mutationScopes),count:updated.length,error:null});
  }
  const deleted=await runForUser(c,user.id,'delete from '+tableName+' where '+condition+' returning *',scopedParams);
  return c.json({data:deleted,count:deleted.length,error:null});
});
app.post('/api/rpc/:name',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 const name=c.req.param('name');if(!RPC_ALLOWLIST.has(name))return c.json({message:'عملیات سرور مجاز نیست.'},404);
 const body=await c.req.json<Record<string,unknown>>().catch(()=>null);
 const args=body?.args&&typeof body.args==='object'&&!Array.isArray(body.args)?body.args as Record<string,unknown>:{};
 const sql=sqlFor(c);
 try{
  const meta=await sql.query("select p.proargnames[1:p.pronargs] as arg_names,array(select format_type(t,null) from unnest(p.proargtypes::oid[]) with ordinality as a(t,ord) order by ord) as arg_types from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 order by p.pronargs limit 2",[name]);
  if(meta.length!==1)return c.json({message:'عملیات دیتابیس در دسترس نیست یا مبهم است.'},404);
  const info=meta[0] as {arg_names:string[];arg_types:string[]},names=info.arg_names??[],types=info.arg_types??[];
  if(names.some(n=>!Object.prototype.hasOwnProperty.call(args,n))||Object.keys(args).some(n=>!names.includes(n)))return c.json({message:'پارامترهای عملیات کامل نیستند یا پارامتر ناشناخته وجود دارد.'},422);
  if(types.some(t=>!/^[a-zA-Z_][a-zA-Z0-9_ .]*$/.test(t)))return c.json({message:'نوع پارامتر عملیات معتبر نیست.'},500);
  const marks=names.map((n,i)=>'$'+(i+1)+'::'+types[i]),values=names.map(n=>args[n]??null);
  const rows=await runForUser(c,user.id,'select * from public.'+quoteSqlIdentifier(name)+'('+marks.join(',')+')',values);
  return c.json({data:rows,error:null});
 }catch(error){
  const caught=error as {code?:string};
  return c.json({message:caught.code?'این عملیات با توجه به نقش یا وضعیت فعلی مجاز نیست.':'اجرای عملیات ناموفق بود.'},400);
 }
});
app.post('/api/access-requests',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 return c.json({message:'درخواست نقش عمومی فعال نیست؛ با کد دعوت به یک مجموعه بپیوند.',account:user.username},410);
});
const PRIVATE_BUCKET_RULES:Record<string,{maxBytes:number;contentTypes:Set<string>}>={
 'delivery-evidence':{maxBytes:10*1024*1024,contentTypes:new Set(['image/jpeg','image/png','image/webp','application/pdf'])},
 'operational-evidence':{maxBytes:10*1024*1024,contentTypes:new Set(['image/jpeg','image/png','image/webp','application/pdf'])},
 'contract-documents':{maxBytes:20*1024*1024,contentTypes:new Set(['application/pdf','image/jpeg','image/png'])}
};
function normalizePrivatePath(value:string):string|null{
 const parts=value.split('/');
 if(parts.length<3||parts.length>8||parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')||p.includes('\0')))return null;
 if(!/^[0-9a-f-]{36}$/i.test(parts[0])||!/^[0-9a-f-]{36}$/i.test(parts[1]))return null;
 if(parts.some(p=>p.length>180||p.trim()!==p))return null;
 return parts.join('/');
}
async function memberRoleForCompany(c:Ctx,userId:string,companyId:string):Promise<string|null>{
 const sql=sqlFor(c);
 const rows=await sql.query("select role from public.memberships where user_id=$1::uuid and company_id=$2::uuid and active=true limit 1",[userId,companyId]);
 return (rows[0] as {role:string}|undefined)?.role??null;
}
app.put('/api/storage/:bucket',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 if(!c.env.FILE_STORE)return c.json({message:'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.'},503);
 const bucket=c.req.param('bucket'),rules=PRIVATE_BUCKET_RULES[bucket];if(!rules)return c.json({message:'مخزن فایل مجاز نیست.'},404);
 const path=normalizePrivatePath(c.req.query('path')??'');if(!path)return c.json({message:'مسیر فایل معتبر نیست.'},422);
 const companyId=path.split('/')[0],role=await memberRoleForCompany(c,user.id,companyId);
 if(!role)return c.json({message:'برای این مجموعه دسترسی فعال نداری.'},403);
 if(bucket==='contract-documents'&&!['owner','admin'].includes(role))return c.json({message:'فقط مالک یا مدیر می‌تواند سند قرارداد را بارگذاری کند.'},403);
 const contentType=(c.req.header('content-type')??'application/octet-stream').split(';')[0].trim().toLowerCase();
 if(!rules.contentTypes.has(contentType))return c.json({message:'نوع فایل پشتیبانی نمی‌شود.'},415);
 const len=Number(c.req.header('content-length')??0);if(len>rules.maxBytes)return c.json({message:'حجم فایل از محدودیت مخزن بیشتر است.'},413);
 const bytes=await c.req.arrayBuffer();if(bytes.byteLength>rules.maxBytes)return c.json({message:'حجم فایل از محدودیت مخزن بیشتر است.'},413);
 const existing=await runForUser(c,user.id,'select id from public.medar_files where bucket_id=$1 and name=$2 limit 1',[bucket,path]);
 if(existing.length&&c.req.header('x-upsert')!=='true')return c.json({message:'فایلی با این مسیر قبلاً وجود دارد.'},409);
 try{
  await c.env.FILE_STORE.put(bucket+'/'+path,bytes,{httpMetadata:{contentType}});
  const metadata=await runForUser(c,user.id,'insert into public.medar_files(bucket_id,name,company_id,content_type,size_bytes,uploaded_by) values($1,$2,$3::uuid,$4,$5,$6::uuid) on conflict(bucket_id,name) do update set content_type=excluded.content_type,size_bytes=excluded.size_bytes,uploaded_by=excluded.uploaded_by returning id',[bucket,path,companyId,contentType,bytes.byteLength,user.id]);
  if(!metadata.length){await c.env.FILE_STORE.delete(bucket+'/'+path);return c.json({message:'قواعد دسترسی بارگذاری این مدرک را مجاز نمی‌دانند.'},403);}
  return c.json({data:{path,bucket,size:bytes.byteLength,contentType},error:null},201);
 }catch{return c.json({message:'ذخیره فایل یا ثبت مشخصات آن ناموفق بود.'},400);}
});
app.get('/api/storage/:bucket',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 if(!c.env.FILE_STORE)return c.json({message:'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.'},503);
 const bucket=c.req.param('bucket');if(!PRIVATE_BUCKET_RULES[bucket])return c.json({message:'مخزن فایل مجاز نیست.'},404);
 const path=normalizePrivatePath(c.req.query('path')??'');if(!path)return c.json({message:'مسیر فایل معتبر نیست.'},422);
 const meta=await runForUser(c,user.id,'select content_type from public.medar_files where bucket_id=$1 and name=$2 limit 1',[bucket,path]);
 if(!meta.length)return c.json({message:'فایل پیدا نشد یا دسترسی به آن مجاز نیست.'},404);
 const object=await c.env.FILE_STORE.get(bucket+'/'+path);if(!object)return c.json({message:'فایل در فضای ذخیره‌سازی پیدا نشد.'},404);
 const headers=new Headers();object.writeHttpMetadata(headers);headers.set('Content-Type',String(meta[0].content_type??object.httpMetadata?.contentType??'application/octet-stream'));
 headers.set('Cache-Control','private, no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Security-Policy',"default-src 'none'; sandbox");
 return new Response(object.body,{status:200,headers});
});
app.post('/api/storage/:bucket/remove',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 if(!c.env.FILE_STORE)return c.json({message:'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.'},503);
 const bucket=c.req.param('bucket');if(!PRIVATE_BUCKET_RULES[bucket])return c.json({message:'مخزن فایل مجاز نیست.'},404);
 const body=await c.req.json<{paths?:unknown}>().catch(()=>null);
 if(!Array.isArray(body?.paths)||body.paths.length<1||body.paths.length>50)return c.json({message:'فهرست فایل‌ها معتبر نیست.'},422);
 const paths=body.paths.map(raw=>typeof raw==='string'?normalizePrivatePath(raw):null);
 if(paths.some(path=>!path))return c.json({message:'یکی از مسیرهای فایل معتبر نیست.'},422);
 const validPaths=paths as string[],params:unknown[]=[bucket],marks=validPaths.map(path=>{params.push(path);return '$'+params.length;});
 try{
  const allowed=await runForUser(c,user.id,'select name from public.medar_files where bucket_id=$1 and name in ('+marks.join(',')+')',params);
  const names=allowed.map(row=>String(row.name));if(!names.length)return c.json({data:[],error:null});
  await c.env.FILE_STORE.delete(names.map(name=>bucket+'/'+name));
  const deleteParams:unknown[]=[bucket],deleteMarks=names.map(name=>{deleteParams.push(name);return '$'+deleteParams.length;});
  await runForUser(c,user.id,'delete from public.medar_files where bucket_id=$1 and name in ('+deleteMarks.join(',')+') returning id',deleteParams);
  return c.json({data:names.map(name=>({name})),error:null});
 }catch{return c.json({message:'حذف فایل یا مشخصات آن ناموفق بود.'},400);}
});

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ message: 'مسیر API پیدا نشد.' }, 404);
  return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ message: 'مسیر پیدا نشد.' }, 404);
});
app.onError((error, c) => {
  const requestId = crypto.randomUUID();
  return c.json({ message: 'درخواست انجام نشد. دوباره تلاش کن.', requestId }, 500);
});
export default app;
