import { neon } from '@neondatabase/serverless';
import { Hono, type Context } from 'hono';

type Bindings = {
  DATABASE_URL?: string;
  ALLOWED_ORIGINS?: string;
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
    const salt = new Uint8Array(base64ToBytes(saltText));
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
          returning company_id, role
        ),
        new_user as (
          insert into public.app_users(username, phone_e164, full_name, password_hash)
          select ${username}, ${phone}, ${fullName}, ${passwordHash}
          from valid_invite
          returning id, username, phone_e164, full_name
        ),
        new_membership as (
          insert into public.memberships(company_id, user_id, role, active, created_by)
          select i.company_id, u.id, i.role, true, u.id
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
  const allowedRoles = ['admin', 'staff', 'customer', 'supplier', 'driver'];
  if (!companyId || !allowedRoles.includes(role)) return c.json({ message: 'شرکت یا نقش دعوت معتبر نیست.' }, 422);
  const sql = sqlFor(c);
  const memberships = await sql`
    select role from public.memberships
    where user_id = ${user.id} and company_id = ${companyId} and active = true limit 1
  `;
  const actorRole = (memberships[0] as { role: string } | undefined)?.role;
  if (!actorRole || !['owner', 'admin'].includes(actorRole)) return c.json({ message: 'برای ساخت دعوت، دسترسی مالک یا مدیر لازم است.' }, 403);
  if (role === 'admin' && actorRole !== 'owner') return c.json({ message: 'فقط مالک می‌تواند مدیر جدید دعوت کند.' }, 403);
  const code = randomToken();
  const tokenHash = await sha256(code);
  const rows = await sql`
    insert into public.company_invites(company_id, role, token_hash, created_by, expires_at)
    values (${companyId}, ${role}::public.app_role, ${tokenHash}, ${user.id}, now() + interval '7 days')
    returning id, expires_at
  `;
  return c.json({ inviteCode: code, inviteId: (rows[0] as { id: string }).id, expiresAt: (rows[0] as { expires_at: string }).expires_at }, 201);
});

app.post('/api/workspace/join', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const code = typeof body?.inviteCode === 'string' ? body.inviteCode.trim() : '';
  if (!/^[a-f0-9]{64}$/.test(code)) return c.json({ message: 'کد دعوت معتبر نیست.' }, 422);
  const tokenHash = await sha256(code);
  const sql = sqlFor(c);
  const rows = await sql`
    with invite as (
      update public.company_invites
      set uses = uses + 1, updated_at = now()
      where token_hash = ${tokenHash} and revoked_at is null
        and expires_at > now() and uses < max_uses
      returning company_id, role
    ),
    membership as (
      insert into public.memberships(company_id, user_id, role, active, created_by)
      select company_id, ${user.id}, role, true, ${user.id} from invite
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

app.post('/api/access-requests', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const allowedRoles = ['staff', 'supplier', 'driver', 'customer'];
  const role = typeof body?.role === 'string' ? body.role : '';
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : user.full_name;
  const organizationName = typeof body?.organizationName === 'string' ? body.organizationName.trim() : '';
  const phone = normalizeIranPhone(body?.phone) ?? user.phone;
  if (!allowedRoles.includes(role)) return c.json({ message: 'نقش انتخاب‌شده معتبر نیست.' }, 422);
  if (fullName.length < 2 || fullName.length > 160) return c.json({ message: 'نام کامل معتبر نیست.' }, 422);
  if (['customer', 'supplier'].includes(role) && organizationName.length < 2) {
    return c.json({ message: 'نام شرکت یا مزرعه برای این نقش ضروری است.' }, 422);
  }
  const sql = sqlFor(c);
  const rows = await sql`
    insert into public.access_requests(user_id, company_name, full_name, phone, requested_role)
    values (${user.id}, ${organizationName || null}, ${fullName}, ${phone || null}, ${role}::public.app_role)
    returning id
  `;
  return c.json({ requestId: (rows[0] as { id: string }).id }, 201);
});

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ message: 'مسیر API پیدا نشد.' }, 404);
  return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ message: 'مسیر پیدا نشد.' }, 404);
});

app.onError((error, c) => {
  const requestId = crypto.randomUUID();
  // Never include SQL errors, credentials, hashes, or request bodies in production responses.
  return c.json({ message: 'درخواست انجام نشد. دوباره تلاش کن.', requestId }, 500);
});

export default app;
