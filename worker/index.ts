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
    const salt = base64ToBytes(saltText);
    const expected = base64ToBytes(expectedText);
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
    username: String(row.username),
    phone: String(row.phone ?? row.phone_e164 ?? ''),
    full_name: String(row.full_name ?? ''),
  };
}

async function currentSession(c: Ctx): Promise<CurrentSession | null> {
  const token = readCookie(c, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const sql = sqlFor(c);
  const rows = await sql`
    select s.id as "sessionId", u.id, u.username, u.phone_e164 as phone, u.full_name
    from public.auth_sessions s
    join public.app_users u on u.id = s.user_id
    where s.token_hash = ${tokenHash} and s.expires_at > now()
    limit 1
  `;
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
  await sql`
    insert into public.auth_sessions(user_id, token_hash, expires_at)
    values (${userId}, ${tokenHash}, now() + interval '14 days')
  `;
  await sql`delete from public.auth_sessions where expires_at < now() - interval '7 days'`;
  setSessionCookie(c, token);
}

async function getMemberships(c: Ctx, userId: string) {
  const sql = sqlFor(c);
  return await sql`
    select m.id, m.company_id, m.user_id, m.role, m.active,
      null::uuid as customer_id, null::uuid as supplier_id,
      json_build_object('name', coalesce(c.name, 'مجموعه مدار')) as company
    from public.memberships m
    join public.companies c on c.id = m.company_id
    where m.user_id = ${userId} and m.active = true
    order by m.created_at
  `;
}

async function rateLimitKeys(c: Ctx, username: string): Promise<string[]> {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  return [
    await sha256(`username:${username}`),
    await sha256(`ip:${ip}`),
  ];
}

async function isRateLimited(c: Ctx, keys: string[]): Promise<boolean> {
  const sql = sqlFor(c);
  for (const key of keys) {
    const rows = await sql`select 1 from public.auth_rate_limits where bucket_key = ${key} and blocked_until > now() limit 1`;
    if (rows.length) return true;
  }
  return false;
}

async function recordFailedLogin(c: Ctx, keys: string[]): Promise<void> {
  const sql = sqlFor(c);
  for (const key of keys) {
    await sql`delete from public.auth_rate_limits where bucket_key = ${key} and window_started_at < now() - interval '15 minutes'`;
    await sql`
      insert into public.auth_rate_limits(bucket_key, attempts, window_started_at)
      values (${key}, 1, now())
      on conflict (bucket_key) do update set
        attempts = case
          when public.auth_rate_limits.window_started_at < now() - interval '15 minutes' then 1
          else public.auth_rate_limits.attempts + 1
        end,
        window_started_at = case
          when public.auth_rate_limits.window_started_at < now() - interval '15 minutes' then now()
          else public.auth_rate_limits.window_started_at
        end,
        blocked_until = case
          when (case
            when public.auth_rate_limits.window_started_at < now() - interval '15 minutes' then 1
            else public.auth_rate_limits.attempts + 1
          end) >= 5 then now() + interval '15 minutes'
          else null
        end,
        updated_at = now()
    `;
  }
  await sql`delete from public.auth_rate_limits where updated_at < now() - interval '1 day'`;
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
      c.header('Access-Control-Allow-Headers', 'Content-Type');
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
    const conflicts = await sql`
      select username, phone_e164 from public.app_users
      where username = ${username} or phone_e164 = ${phone}
      limit 2
    `;
    if (conflicts.some((row) => (row as { username: string }).username === username)) {
      return c.json({ message: 'این نام کاربری قبلاً ثبت شده است.' }, 409);
    }
    if (conflicts.some((row) => (row as { phone_e164: string }).phone_e164 === phone)) {
      return c.json({ message: 'این شماره موبایل قبلاً برای حسابی ثبت شده است.' }, 409);
    }
    const passwordHash = await hashPassword(password);
    let created: (Record<string, unknown> & { id: string; companyId: string }) | undefined;
    if (inviteCode) {
      const tokenHash = await sha256(inviteCode);
      const rows = await sql`
        with valid_invite as (
          update public.company_invites
          set uses = uses + 1, updated_at = now()
          where token_hash = ${tokenHash} and revoked_at is null
            and expires_at > now() and uses < max_uses
          returning company_id, role, customer_id, supplier_id
        ),
        new_user as (
          insert into public.app_users(username, phone_e164, full_name, password_hash)
          select ${username}, ${phone}, ${fullName}, ${passwordHash}
          from valid_invite
          returning id, username, phone_e164, full_name
        ),
        new_membership as (
          insert into public.memberships(company_id, user_id, role, active, created_by, customer_id, supplier_id)
          select i.company_id, u.id, i.role, true, u.id, i.customer_id, i.supplier_id
          from valid_invite i cross join new_user u
          returning company_id
        )
        select u.id, u.username, u.phone_e164 as phone, u.full_name, m.company_id as "companyId"
        from new_user u cross join new_membership m
      `;
      created = rows[0] as (Record<string, unknown> & { id: string; companyId: string }) | undefined;
      if (!created) return c.json({ message: 'کد دعوت منقضی، لغوشده یا قبلاً مصرف شده است.' }, 422);
    } else {
      const rows = await sql`
        with new_user as (
          insert into public.app_users(username, phone_e164, full_name, password_hash)
          values (${username}, ${phone}, ${fullName}, ${passwordHash})
          returning id, username, phone_e164, full_name
        ),
        new_company as (
          insert into public.companies(name)
          select ${companyName} from new_user
          returning id
        ),
        new_membership as (
          insert into public.memberships(company_id, user_id, role, active, created_by)
          select c.id, u.id, 'owner', true, u.id
          from new_user u cross join new_company c
          returning company_id
        )
        select u.id, u.username, u.phone_e164 as phone, u.full_name, m.company_id as "companyId"
        from new_user u cross join new_membership m
      `;
      created = rows[0] as (Record<string, unknown> & { id: string; companyId: string }) | undefined;
    }
    if (!created) return c.json({ message: 'ساخت حساب و فضای کاری انجام نشد. دوباره تلاش کن.' }, 500);
    await createSession(c, created.id);
    return c.json({
      user: safeUser(created),
      companyId: created.companyId,
      memberships: await getMemberships(c, created.id),
    }, 201);
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
  if (!username || !password || password.length > 128) {
    return c.json({ message: 'نام کاربری یا گذرواژه نادرست است.' }, 401);
  }
  const keys = await rateLimitKeys(c, username);
  if (await isRateLimited(c, keys)) return c.json({ message: 'تلاش‌های ورود بیش از حد است. ۱۵ دقیقه دیگر دوباره امتحان کن.' }, 429);
  const sql = sqlFor(c);
  const rows = await sql`
    select id, username, phone_e164, full_name, password_hash
    from public.app_users where username = ${username} limit 1
  `;
  const account = rows[0] as (Record<string, unknown> & { id: string; password_hash: string }) | undefined;
  const encodedHash = account?.password_hash ?? '';
  const passwordMatches = account ? await verifyPassword(password, encodedHash) : (await hashPassword(password), false);
  if (!account || !passwordMatches) {
    await recordFailedLogin(c, keys);
    return c.json({ message: 'نام کاربری یا گذرواژه نادرست است.' }, 401);
  }
  await sql`delete from public.auth_rate_limits where bucket_key = ${keys[0]}`;
  await createSession(c, account.id);
  return c.json({ user: safeUser(account), memberships: await getMemberships(c, account.id) });
});

app.post('/api/auth/logout', async (c) => {
  const token = readCookie(c, SESSION_COOKIE);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const tokenHash = await sha256(token);
    const sql = sqlFor(c);
    await sql`delete from public.auth_sessions where token_hash = ${tokenHash}`;
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
  if (newPassword.length < 8 || newPassword.length > 128) {
    return c.json({ message: 'گذرواژه جدید باید بین ۸ تا ۱۲۸ نویسه باشد.' }, 422);
  }
  const sql = sqlFor(c);
  const rows = await sql`select password_hash from public.app_users where id = ${session.user.id} limit 1`;
  const encodedHash = (rows[0] as { password_hash: string } | undefined)?.password_hash ?? '';
  if (!(await verifyPassword(currentPassword, encodedHash))) {
    return c.json({ message: 'گذرواژه فعلی نادرست است.' }, 403);
  }
  const passwordHash = await hashPassword(newPassword);
  await sql`update public.app_users set password_hash = ${passwordHash}, updated_at = now() where id = ${session.user.id}`;
  await sql`delete from public.auth_sessions where user_id = ${session.user.id} and id <> ${session.sessionId}`;
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
      on conflict (company_id, user_id, role) do update set active = true
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
      u.username, u.phone_e164 as phone, u.full_name
    from public.memberships m
    join public.app_users u on u.id = m.user_id
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
  await sql`insert into public.auth_audit_events(user_id,event_type,success) values (${user.id},'membership.deactivated',true)`;
  return c.json({ ok: true });
});


const DATA_TABLES = new Set([
  'customers','suppliers','products','price_agreements','orders','order_items','capacity_commitments',
  'lots','quality_reviews','shipments','delivery_evidence','invoices','settlements','notifications',
  'audit_events','access_requests','farm_sites','partnership_agreements','flock_cycles','production_batches',
  'daily_production_records','task_templates','operational_tasks','task_evidence','operational_incidents',
  'partner_financial_entries','partner_settlement_periods','shipment_locations','inventory_movements',
  'inventory_balances','company_goals',
]);
const RPC_ALLOWLIST = new Set([
  'allocate_order_item','record_inventory_movement','company_members','start_operational_task',
  'submit_operational_task','review_operational_task','create_partner_settlement_period',
  'refresh_partner_settlement_period','approve_partner_settlement_period','record_partner_settlement_payment',
]);
function quoteSqlIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('شناسه دیتابیس معتبر نیست.');
  return '"' + value.replace(/"/g, '""') + '"';
}
async function runForUser(c: Ctx, userId: string, statement: string, parameters: unknown[] = []): Promise<Record<string, unknown>[]> {
  const sql = sqlFor(c);
  const result = await sql.transaction([
    sql.query("select set_config('medar.user_id', $1, true)", [userId]),
    sql.query(statement, parameters),
  ]);
  return (result[1] ?? []) as Record<string, unknown>[];
}
async function listTableColumns(c: Ctx, table: string): Promise<Set<string>> {
  const sql = sqlFor(c);
  const rows = await sql.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1", [table]);
  return new Set(rows.map((row) => String((row as { column_name: string }).column_name)));
}
type DataFilter = { column: string; op: string; value?: unknown };
function buildFilterSql(filters: DataFilter[], allowedColumns: Set<string>, parameters: unknown[], startAt: number, conjunction = 'and'): string {
  if (!filters.length) return '';
  const expressions = filters.map((filter) => {
    if (!allowedColumns.has(filter.column)) throw new Error('ستون فیلتر معتبر نیست.');
    const column = quoteSqlIdentifier(filter.column);
    const op = filter.op.toLowerCase();
    if (op === 'is' || op === 'not_is') {
      if (filter.value !== null && filter.value !== true && filter.value !== false) throw new Error('مقدار فیلتر معتبر نیست.');
      return column + (op === 'not_is' ? ' is not ' : ' is ') + (filter.value === null ? 'null' : filter.value ? 'true' : 'false');
    }
    if (op === 'in' || op === 'not_in') {
      const values = Array.isArray(filter.value) ? filter.value : String(filter.value ?? '').replace(/^\(|\)$/g, '').split(',').filter(Boolean);
      if (!values.length) return op === 'in' ? 'false' : 'true';
      const placeholders = values.map((value) => { parameters.push(value); return '$' + (startAt + parameters.length - 1); });
      return column + (op === 'not_in' ? ' not in (' : ' in (') + placeholders.join(', ') + ')';
    }
    const operators: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };
    const sqlOperator = operators[op];
    if (!sqlOperator) throw new Error('عملگر فیلتر پشتیبانی نمی‌شود.');
    parameters.push(filter.value ?? null);
    return column + ' ' + sqlOperator + ' $' + (startAt + parameters.length - 1);
  });
  return '(' + expressions.join(conjunction === 'or' ? ' or ' : ' and ') + ')';
}
app.post('/api/data/:table', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const table = c.req.param('table');
  if (!DATA_TABLES.has(table)) return c.json({ message: 'جدول در API مجاز نیست.' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'درخواست داده معتبر نیست.' }, 400);
  const action = typeof body.action === 'string' ? body.action : 'select';
  if (!['select','insert','update','delete'].includes(action)) return c.json({ message: 'عملیات داده مجاز نیست.' }, 422);
  try {
    const columns = await listTableColumns(c, table);
    const parameters: unknown[] = [];
    const filters = Array.isArray(body.filters) ? body.filters as DataFilter[] : [];
    const where = buildFilterSql(filters, columns, parameters, 1);
    const orFilters = Array.isArray(body.orFilters) ? body.orFilters as DataFilter[] : [];
    const orWhere = buildFilterSql(orFilters, columns, parameters, 1, 'or');
    const whereSql = where && orWhere ? ' where ' + where + ' and ' + orWhere : (where || orWhere ? ' where ' + (where || orWhere) : '');
    const tableName = 'public.' + quoteSqlIdentifier(table);
    if (action === 'select') {
      const countRows = body.count === true ? await runForUser(c, user.id, 'select count(*)::int as count from ' + tableName + whereSql, [...parameters]) : [];
      if (body.head === true) return c.json({ data: [], count: countRows.length ? Number(countRows[0].count) : null, error: null });
      const limitValue = Math.max(1, Math.min(500, Number.isFinite(Number(body.limit)) ? Math.trunc(Number(body.limit)) : 200));
      let statement = 'select * from ' + tableName + whereSql;
      if (body.order && typeof body.order === 'object') {
        const order = body.order as { column?: string; ascending?: boolean };
        if (order.column && !columns.has(order.column)) throw new Error('ستون مرتب‌سازی معتبر نیست.');
        if (order.column) statement += ' order by ' + quoteSqlIdentifier(order.column) + (order.ascending === true ? ' asc' : ' desc');
      }
      parameters.push(limitValue);
      statement += ' limit $' + parameters.length;
      const rows = await runForUser(c, user.id, statement, parameters);
      return c.json({ data: rows, count: countRows.length ? Number(countRows[0].count) : rows.length, error: null });
    }
    if (!filters.length && action !== 'insert') return c.json({ message: 'برای ویرایش یا حذف باید فیلتر رکورد مشخص شود.' }, 422);
    const blocked = new Set(['password_hash','token_hash','reviewed_by','actor_id','approved_by','submitted_by','user_id','created_by']);
    const rawValues = body.values;
    if (action === 'insert') {
      const entries = Array.isArray(rawValues) ? rawValues as Record<string, unknown>[] : [rawValues as Record<string, unknown>];
      if (!entries.length || entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) return c.json({ message: 'رکورد ورودی معتبر نیست.' }, 422);
      const keys = Array.from(new Set(entries.flatMap((entry) => Object.keys(entry).filter((key) => !blocked.has(key)))));
      if (!keys.length || keys.some((key) => !columns.has(key))) return c.json({ message: 'یکی از فیلدهای رکورد غیرمجاز است.' }, 422);
      const insertParameters: unknown[] = [];
      const tuples = entries.map((entry) => '(' + keys.map((key) => { insertParameters.push(entry[key] ?? null); return '$' + insertParameters.length; }).join(', ') + ')');
      const rows = await runForUser(c, user.id, 'insert into ' + tableName + ' (' + keys.map(quoteSqlIdentifier).join(', ') + ') values ' + tuples.join(', ') + ' returning *', insertParameters);
      return c.json({ data: rows, count: rows.length, error: null }, 201);
    }
    if (action === 'update') {
      const values = rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues) ? rawValues as Record<string, unknown> : null;
      if (!values || !Object.keys(values).length || Object.keys(values).some((key) => !columns.has(key) || blocked.has(key))) return c.json({ message: 'فیلدهای ویرایش معتبر نیستند.' }, 422);
      const setParameters: unknown[] = [];
      const setSql = Object.entries(values).map(([key, value]) => { setParameters.push(value ?? null); return quoteSqlIdentifier(key) + ' = $' + setParameters.length; }).join(', ');
      const filterParams: unknown[] = [];
      const updateWhere = buildFilterSql(filters, columns, filterParams, setParameters.length + 1);
      const rows = await runForUser(c, user.id, 'update ' + tableName + ' set ' + setSql + ' where ' + updateWhere + ' returning *', [...setParameters, ...filterParams]);
      return c.json({ data: rows, count: rows.length, error: null });
    }
    const deleteParams: unknown[] = [];
    const deleteWhere = buildFilterSql(filters, columns, deleteParams, 1);
    const rows = await runForUser(c, user.id, 'delete from ' + tableName + ' where ' + deleteWhere + ' returning *', deleteParams);
    return c.json({ data: rows, count: rows.length, error: null });
  } catch (error) {
    const databaseError = error as { code?: string };
    return c.json({ message: databaseError.code ? 'دسترسی یا اعتبارسنجی داده ناموفق بود.' : (error instanceof Error ? error.message : 'درخواست داده ناموفق بود.') }, 400);
  }
});
app.post('/api/rpc/:name', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const name = c.req.param('name');
  if (!RPC_ALLOWLIST.has(name)) return c.json({ message: 'عملیات سرور مجاز نیست.' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const args = body?.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args as Record<string, unknown> : {};
  const sql = sqlFor(c);
  try {
    const metadata = await sql.query("select p.proargnames[1:p.pronargs] as arg_names, array(select format_type(t, null) from unnest(p.proargtypes::oid[]) with ordinality as a(t, ord) order by ord) as arg_types from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1 order by p.pronargs limit 2", [name]);
    if (metadata.length !== 1) return c.json({ message: 'عملیات دیتابیس در دسترس نیست یا مبهم است.' }, 404);
    const info = metadata[0] as { arg_names: string[]; arg_types: string[] };
    const argNames = info.arg_names ?? [];
    const argTypes = info.arg_types ?? [];
    if (argNames.some((argName) => !Object.prototype.hasOwnProperty.call(args, argName)) || Object.keys(args).some((argName) => !argNames.includes(argName))) return c.json({ message: 'پارامترهای عملیات کامل نیستند یا پارامتر ناشناخته وجود دارد.' }, 422);
    if (argTypes.some((typeName) => !/^[a-zA-Z_][a-zA-Z0-9_ .\[\]]*$/.test(typeName))) return c.json({ message: 'نوع پارامتر عملیات معتبر نیست.' }, 500);
    const placeholders = argNames.map((argName, index) => '$' + (index + 1) + '::' + argTypes[index]);
    const parameters = argNames.map((argName) => args[argName] ?? null);
    const rows = await runForUser(c, user.id, 'select * from public.' + quoteSqlIdentifier(name) + '(' + placeholders.join(', ') + ')', parameters);
    return c.json({ data: rows, error: null });
  } catch (error) {
    const databaseError = error as { code?: string };
    return c.json({ message: databaseError.code ? 'این عملیات با توجه به نقش یا وضعیت فعلی مجاز نیست.' : 'اجرای عملیات ناموفق بود.' }, 400);
  }
});
app.post('/api/access-requests', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  return c.json({ message: 'درخواست نقش عمومی فعال نیست؛ با کد دعوت به یک مجموعه بپیوند.' }, 410);
});
const PRIVATE_BUCKET_RULES: Record<string, { maxBytes: number; contentTypes: Set<string> }> = {
  'delivery-evidence': { maxBytes: 10 * 1024 * 1024, contentTypes: new Set(['image/jpeg','image/png','image/webp','application/pdf']) },
  'operational-evidence': { maxBytes: 10 * 1024 * 1024, contentTypes: new Set(['image/jpeg','image/png','image/webp','application/pdf']) },
  'contract-documents': { maxBytes: 20 * 1024 * 1024, contentTypes: new Set(['application/pdf','image/jpeg','image/png']) },
};
function normalizePrivatePath(value: string): string | null {
  const segments = value.split('/');
  if (segments.length < 3 || segments.length > 8 || segments.some((part) => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) return null;
  if (!/^[0-9a-f-]{36}$/i.test(segments[0]) || !/^[0-9a-f-]{36}$/i.test(segments[1])) return null;
  if (segments.some((part) => part.length > 180 || part.trim() !== part)) return null;
  return segments.join('/');
}
async function memberRoleForCompany(c: Ctx, userId: string, companyId: string): Promise<string | null> {
  const sql = sqlFor(c);
  const rows = await sql.query("select role from public.memberships where user_id = $1::uuid and company_id = $2::uuid and active = true limit 1", [userId, companyId]);
  return (rows[0] as { role: string } | undefined)?.role ?? null;
}
app.put('/api/storage/:bucket', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  if (!c.env.FILE_STORE) return c.json({ message: 'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.' }, 503);
  const bucket = c.req.param('bucket');
  const rules = PRIVATE_BUCKET_RULES[bucket];
  if (!rules) return c.json({ message: 'مخزن فایل مجاز نیست.' }, 404);
  const path = normalizePrivatePath(c.req.query('path') ?? '');
  if (!path) return c.json({ message: 'مسیر فایل معتبر نیست.' }, 422);
  const companyId = path.split('/')[0];
  const role = await memberRoleForCompany(c, user.id, companyId);
  if (!role) return c.json({ message: 'برای این مجموعه دسترسی فعال نداری.' }, 403);
  if (bucket === 'contract-documents' && !['owner','admin'].includes(role)) return c.json({ message: 'فقط مالک یا مدیر می‌تواند سند قرارداد را بارگذاری کند.' }, 403);
  const contentType = (c.req.header('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!rules.contentTypes.has(contentType)) return c.json({ message: 'نوع فایل پشتیبانی نمی‌شود.' }, 415);
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > rules.maxBytes) return c.json({ message: 'حجم فایل از محدودیت مخزن بیشتر است.' }, 413);
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength > rules.maxBytes) return c.json({ message: 'حجم فایل از محدودیت مخزن بیشتر است.' }, 413);
  const existing = await runForUser(c, user.id, 'select id from public.medar_files where bucket_id = $1 and name = $2 limit 1', [bucket, path]);
  if (existing.length && c.req.header('x-upsert') !== 'true') return c.json({ message: 'فایلی با این مسیر قبلاً وجود دارد.' }, 409);
  try {
    await c.env.FILE_STORE.put(bucket + '/' + path, bytes, { httpMetadata: { contentType } });
    const metadata = await runForUser(c, user.id, 'insert into public.medar_files(bucket_id,name,company_id,content_type,size_bytes,uploaded_by) values($1,$2,$3::uuid,$4,$5,$6::uuid) on conflict(bucket_id,name) do update set content_type=excluded.content_type,size_bytes=excluded.size_bytes,uploaded_by=excluded.uploaded_by returning id', [bucket, path, companyId, contentType, bytes.byteLength, user.id]);
    if (!metadata.length) { await c.env.FILE_STORE.delete(bucket + '/' + path); return c.json({ message: 'قواعد دسترسی بارگذاری این مدرک را مجاز نمی‌دانند.' }, 403); }
    return c.json({ data: { path, bucket, size: bytes.byteLength, contentType }, error: null }, 201);
  } catch {
    return c.json({ message: 'ذخیره فایل یا ثبت مشخصات آن ناموفق بود.' }, 400);
  }
});
app.get('/api/storage/:bucket', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  if (!c.env.FILE_STORE) return c.json({ message: 'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.' }, 503);
  const bucket = c.req.param('bucket');
  if (!PRIVATE_BUCKET_RULES[bucket]) return c.json({ message: 'مخزن فایل مجاز نیست.' }, 404);
  const path = normalizePrivatePath(c.req.query('path') ?? '');
  if (!path) return c.json({ message: 'مسیر فایل معتبر نیست.' }, 422);
  const metadata = await runForUser(c, user.id, 'select content_type from public.medar_files where bucket_id = $1 and name = $2 limit 1', [bucket, path]);
  if (!metadata.length) return c.json({ message: 'فایل پیدا نشد یا دسترسی به آن مجاز نیست.' }, 404);
  const object = await c.env.FILE_STORE.get(bucket + '/' + path);
  if (!object) return c.json({ message: 'فایل در فضای ذخیره‌سازی پیدا نشد.' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', String(metadata[0].content_type ?? object.httpMetadata?.contentType ?? 'application/octet-stream'));
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  return new Response(object.body, { status: 200, headers });
});
app.post('/api/storage/:bucket/remove', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  if (!c.env.FILE_STORE) return c.json({ message: 'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.' }, 503);
  const bucket = c.req.param('bucket');
  if (!PRIVATE_BUCKET_RULES[bucket]) return c.json({ message: 'مخزن فایل مجاز نیست.' }, 404);
  const body = await c.req.json<{ paths?: unknown }>().catch(() => null);
  if (!Array.isArray(body?.paths) || body.paths.length < 1 || body.paths.length > 50) return c.json({ message: 'فهرست فایل‌ها معتبر نیست.' }, 422);
  const paths = body.paths.map((raw) => typeof raw === 'string' ? normalizePrivatePath(raw) : null);
  if (paths.some((path) => !path)) return c.json({ message: 'یکی از مسیرهای فایل معتبر نیست.' }, 422);
  const validPaths = paths as string[];
  const parameters: unknown[] = [bucket];
  const placeholders = validPaths.map((path) => { parameters.push(path); return '$' + parameters.length; });
  try {
    const authorized = await runForUser(c, user.id, 'select name from public.medar_files where bucket_id = $1 and name in (' + placeholders.join(',') + ')', parameters);
    const names = authorized.map((row) => String(row.name));
    if (!names.length) return c.json({ data: [], error: null });
    await c.env.FILE_STORE.delete(names.map((path) => bucket + '/' + path));
    const deleteParams: unknown[] = [bucket];
    const deletePlaceholders = names.map((path) => { deleteParams.push(path); return '$' + deleteParams.length; });
    await runForUser(c, user.id, 'delete from public.medar_files where bucket_id = $1 and name in (' + deletePlaceholders.join(',') + ') returning id', deleteParams);
    return c.json({ data: names.map((path) => ({ name: path })), error: null });
  } catch {
    return c.json({ message: 'حذف فایل یا مشخصات آن ناموفق بود.' }, 400);
  }
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
