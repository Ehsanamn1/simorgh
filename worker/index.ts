import { neon } from '@neondatabase/serverless';
import { Hono, type Context } from 'hono';

type PrivateFileStore = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string }; writeHttpMetadata(headers: Headers): void } | null>;
  delete(keys: string | string[]): Promise<void>;
};
type Bindings = {
  DATABASE_URL?: string;
  MEDAR_MODE?: string;
  ALLOWED_ORIGINS?: string;
  FILE_STORE?: PrivateFileStore;
  AI_ENCRYPTION_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
};
type AppEnv = { Bindings: Bindings };
type Ctx = Context<AppEnv>;
type AuthUser = { id: string; username: string; phone: string; full_name: string };
type CurrentSession = { user: AuthUser; sessionId: string; tokenHash: string };

const app = new Hono<AppEnv>();
export type MedarClientPlatform = 'web' | 'android' | 'ios';
export type MedarClientHeartbeat = { companyId: string; clientId: string; platform: MedarClientPlatform; appVersion: string };

export function parseClientHeartbeat(input: unknown): MedarClientHeartbeat | null {
  if (!input || typeof input !== 'object') return null;
  const body = input as Record<string, unknown>;
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  const clientId = typeof body.clientId === 'string' ? body.clientId : '';
  const platform = body.platform;
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId)) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) return null;
  if (platform !== 'web' && platform !== 'android' && platform !== 'ios') return null;
  if (appVersion.length < 1 || appVersion.length > 40 || Array.from(appVersion).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  return { companyId, clientId, platform, appVersion };
}


export type ApiModeAccess = 'allow' | 'anonymous-session' | 'deny';

/**
 * Fail closed unless the Worker explicitly runs in operational mode.
 * The public showcase may report service health, but cannot create sessions,
 * register accounts, read workspace data, or mutate business records.
 */
export function resolveApiModeAccess(mode: string | undefined, method: string, path: string): ApiModeAccess {
  if (mode === 'operational') return 'allow';
  const verb = method.toUpperCase();
  if (verb === 'GET' && path === '/api/health') return 'allow';
  if (verb === 'GET' && path === '/api/auth/me') return 'anonymous-session';
  return 'deny';
}

const SESSION_COOKIE = 'medar_session';
const SESSION_DAYS = 14;
const PASSWORD_ITERATIONS = 100_000;
// Cloudflare Workers Web Crypto rejects PBKDF2 counts above 100,000.
// Used only to keep the PBKDF2 verification path consistent when a username does not exist.
// It is never accepted as an account credential because the account lookup result is still required.
export const DUMMY_PASSWORD_HASH = 'pbkdf2_sha256$100000$bWVkYXItZHVtbXktc2FsdCE=$PsVhwLctTRvjK7QQMEDf0T5vDyI7Gvwrf99dNxBRF+c=';
const encoder = new TextEncoder();

function sqlFor(c: Ctx) {
  if (!c.env.DATABASE_URL) throw new Error('Database is not configured');
  return neon(c.env.DATABASE_URL);
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


function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(normalized + '='.repeat((4 - normalized.length % 4) % 4));
}
function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer { return bytes.slice().buffer as ArrayBuffer; }
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', asArrayBuffer(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, asArrayBuffer(data)));
}
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const output: Uint8Array[] = [];
  let previous: Uint8Array = new Uint8Array(0);
  let total = 0;
  for (let counter = 1; total < length; counter += 1) {
    previous = await hmacSha256(prk, concatBytes(previous, info, new Uint8Array([counter])));
    output.push(previous);
    total += previous.length;
  }
  return concatBytes(...output).slice(0, length);
}
export function allowedWebPushEndpoint(value: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = host === 'fcm.googleapis.com' ||
      host === 'updates.push.services.mozilla.com' ||
      host.endsWith('.push.services.mozilla.com') ||
      host === 'web.push.apple.com' || host.endsWith('.push.apple.com') ||
      host.endsWith('.notify.windows.com');
    if (url.protocol !== 'https:' || !allowed || url.username || url.password || (url.port && url.port !== '443')) return null;
    return url;
  } catch { return null; }
}
async function vapidAuthorization(endpoint: URL, env: Bindings): Promise<string> {
  const publicKey = env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = env.VAPID_PRIVATE_KEY ?? '';
  if (!publicKey || !privateKey || !env.VAPID_SUBJECT) throw new Error('Web Push VAPID credentials are not configured');
  const publicBytes = base64UrlToBytes(publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) throw new Error('Invalid VAPID public key');
  const privateBytes = base64UrlToBytes(privateKey);
  if (privateBytes.length !== 32) throw new Error('Invalid VAPID private key');
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    x: bytesToBase64Url(publicBytes.slice(1, 33)),
    y: bytesToBase64Url(publicBytes.slice(33, 65)),
    d: bytesToBase64Url(privateBytes),
    ext: true, key_ops: ['sign'],
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const encodePart = (value: unknown) => bytesToBase64Url(encoder.encode(JSON.stringify(value)));
  const header = encodePart({ typ: 'JWT', alg: 'ES256' });
  const payload = encodePart({ aud: endpoint.origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: env.VAPID_SUBJECT });
  const unsigned = header + '.' + payload;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned)));
  return 'vapid t=' + unsigned + '.' + bytesToBase64Url(signature) + ', k=' + publicKey;
}
async function encryptWebPushPayload(payload: string, subscriptionPublicKey: string, authSecret: string): Promise<Uint8Array> {
  const uaPublic = base64UrlToBytes(subscriptionPublicKey);
  const auth = base64UrlToBytes(authSecret);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || auth.length < 16) throw new Error('Invalid browser push encryption keys');
  const uaKey = await crypto.subtle.importKey('raw', asArrayBuffer(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256));
  const keyPrk = await hmacSha256(auth, shared);
  const keyInfo = concatBytes(encoder.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdfExpand(keyPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand(prk, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, encoder.encode('Content-Encoding: nonce\0'), 12);
  const plain = concatBytes(encoder.encode(payload), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', asArrayBuffer(cek), 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asArrayBuffer(nonce), tagLength: 128 }, aesKey, asArrayBuffer(plain)));
  const recordHeader = new Uint8Array(21);
  recordHeader.set(salt, 0);
  new DataView(recordHeader.buffer).setUint32(16, 4096, false);
  recordHeader[20] = asPublic.length;
  return concatBytes(recordHeader, asPublic, encrypted);
}
async function decryptPushAuthSecret(env: Bindings, packed: string): Promise<string> {
  const master = env.AI_ENCRYPTION_KEY || env.DATABASE_URL;
  if (!master) throw new Error('AI_ENCRYPTION_KEY is not configured');
  const raw = base64ToBytes(packed);
  if (raw.length < 29) throw new Error('Stored push subscription secret is invalid');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode('medar-ai-key-v1:' + master));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0,12) }, key, toArrayBuffer(raw.slice(12)));
  return new TextDecoder().decode(clear);
}
async function sendWebPush(subscription: { endpoint: string; p256dh_key: string; auth_secret: string }, payload: Record<string, unknown>, env: Bindings): Promise<{ ok: boolean; gone: boolean; status: number }> {
  const endpoint = allowedWebPushEndpoint(subscription.endpoint);
  if (!endpoint) throw new Error('Push endpoint host is not allowed');
  const body = JSON.stringify(payload);
  if (encoder.encode(body).length > 3500) throw new Error('Push payload is too large');
  const authSecret = await decryptPushAuthSecret(env, subscription.auth_secret);
  const encrypted = await encryptWebPushPayload(body, subscription.p256dh_key, authSecret);
  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: await vapidAuthorization(endpoint, env),
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '60',
      Urgency: 'normal',
    },
    body: asArrayBuffer(encrypted),
    signal: AbortSignal.timeout(10000),
  });
  return { ok: response.status >= 200 && response.status < 300, gone: response.status === 404 || response.status === 410, status: response.status };
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

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, rawIterations, saltText, expectedText] = encoded.split('$');
  if (algorithm !== 'pbkdf2_sha256' || !rawIterations || !saltText || !expectedText) return false;
  const iterations = Number(rawIterations);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 100_000) return false;
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
    "insert into public.medar_sessions(user_id,token_hash,expires_at,last_seen_at,user_agent,ip_hash) values($1::uuid,$2,now()+interval '14 days',now(),$3,$4)",
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

export const FAILED_LOGIN_UPSERT_SQL = `
INSERT INTO public.medar_rate_limits AS rate_limit
  (key_hash, attempts, window_started_at, updated_at)
VALUES ($1, 1, now(), now())
ON CONFLICT (key_hash) DO UPDATE SET
  attempts = CASE
    WHEN rate_limit.window_started_at < now() - interval '15 minutes' THEN 1
    ELSE rate_limit.attempts + 1
  END,
  window_started_at = CASE
    WHEN rate_limit.window_started_at < now() - interval '15 minutes' OR rate_limit.attempts = 4 THEN now()
    ELSE rate_limit.window_started_at
  END,
  updated_at = now()
`;

async function recordFailedLogin(c: Ctx, keys: string[]): Promise<void> {
  const sql = sqlFor(c);
  for (const key of keys) {
    await sql.query(FAILED_LOGIN_UPSERT_SQL, [key]);
  }
  await sql.query("delete from public.medar_rate_limits where updated_at<now()-interval '1 day'");
}

async function recordSignupFailure(c: Ctx, key: string): Promise<void> {
  try {
    await recordFailedLogin(c, [key]);
  } catch {
    // A rate-limit storage failure must not mask the primary signup response.
  }
}

export const CREATE_OWNER_WORKSPACE_SQL = `
with new_user as (
  insert into public.medar_users(username,display_name,password_hash,requested_role,account_status)
  values($1,$1,$2,'owner','active')
  returning id,username,username_normalized,display_name
), new_profile as (
  insert into public.profiles(id,full_name,phone) select id,display_name,null from new_user
  on conflict(id) do update set full_name=excluded.full_name returning id
), new_company as (
  insert into public.companies(name) select 'مجموعه ' || display_name from new_user returning id
), new_membership as (
  insert into public.memberships(company_id,user_id,role,active,created_by)
  select c.id,u.id,'owner',true,u.id from new_user u cross join new_company c returning company_id
)
select u.id,u.username_normalized as username,null::text as phone,u.display_name as full_name,m.company_id as "companyId"
from new_user u cross join new_membership m
`;

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

  const apiAccess = resolveApiModeAccess(c.env.MEDAR_MODE, c.req.method, c.req.path);
  if (apiAccess === 'anonymous-session') return c.json({ user: null, memberships: [] });
  if (apiAccess === 'deny') {
    return c.json({
      message: 'این سرویس فقط برای نمایش عمومی است؛ برای عملیات واقعی وارد محیط عملیاتی مدار شو.',
      code: 'PUBLIC_DEMO_READ_ONLY',
    }, 403);
  }

  await next();
});

app.onError((error, c) => {
  const details = error as { name?: string; code?: string; constraint?: string };
  // Log only safe error metadata; never log request bodies, credentials, or SQL parameters.
  console.error('Medar API request failed', {
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    name: details?.name ?? 'Error',
    code: details?.code ?? null,
    constraint: details?.constraint ?? null,
  });
  return c.json(
    { message: 'سرویس مدار نتوانست درخواست را تکمیل کند؛ چند لحظه بعد دوباره تلاش کن.' },
    500,
  );
});

app.get('/api/health', async (c) => {
  if (!c.env.DATABASE_URL) return c.json({ ok: false, service: 'medar-api', database: false }, 503);
  try {
    const sql = sqlFor(c);
    await sql`select 1 as ready`;
    return c.json({ ok: true, service: c.env.MEDAR_MODE === 'operational' ? 'medar-ops' : 'medar-api', database: true, authentication: 'username-password' });
  } catch {
    return c.json({ ok: false, service: 'medar-api', database: false }, 503);
  }
});

app.get('/api/auth/me', async (c) => {
  const session = await currentSession(c);
  if (!session) return c.json({ user: null, memberships: [] });
  return c.json({ user: session.user, memberships: await getMemberships(c, session.user.id) });
});

/** Record a low-sensitivity heartbeat for this authenticated client in an existing company. */
app.post('/api/client/heartbeat', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const raw = await c.req.json<unknown>().catch(() => null);
  const heartbeat = parseClientHeartbeat(raw);
  if (!heartbeat) return c.json({ message: 'اطلاعات وضعیت دستگاه معتبر نیست.' }, 422);
  const sql = sqlFor(c);
  const rows = await sql.query(
    `insert into public.medar_client_presence(company_id,user_id,client_id,platform,app_version)
     select m.company_id,m.user_id,$3::uuid,$4,$5
     from public.memberships m
     where m.company_id=$1::uuid and m.user_id=$2::uuid and m.active=true
     on conflict(company_id,user_id,client_id) do update
       set platform=excluded.platform,app_version=excluded.app_version,last_seen_at=now()
     returning last_seen_at`,
    [heartbeat.companyId, user.id, heartbeat.clientId, heartbeat.platform, heartbeat.appVersion],
  );
  if (!rows.length) return c.json({ message: 'این حساب به مجموعه‌ی انتخاب‌شده دسترسی فعال ندارد.' }, 403);
  return c.json({ ok: true, lastSeenAt: (rows[0] as { last_seen_at: string }).last_seen_at });
});

/** Central admin view of web/native clients seen in this company. Never accepts a browser-supplied role. */
app.get('/api/admin/system/clients', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId)) {
    return c.json({ message: 'شناسه‌ی مجموعه معتبر نیست.' }, 422);
  }
  const sql = sqlFor(c);
  const permissions = await sql.query(
    `select role::text as role from public.memberships
     where company_id=$1::uuid and user_id=$2::uuid and active=true`,
    [companyId, user.id],
  );
  if (!(permissions as Array<{ role: string }>).some(row => row.role === 'owner' || row.role === 'admin')) {
    return c.json({ message: 'فقط مالک یا مدیر مجموعه می‌تواند وضعیت اتصال کاربران را ببیند.' }, 403);
  }
  const clients = await sql.query(
    `select p.client_id::text as "clientId",p.platform,p.app_version as "appVersion",
      u.username,m.role,p.first_seen_at as "firstSeenAt",p.last_seen_at as "lastSeenAt",
      (p.last_seen_at > now()-interval '3 minutes') as online
     from public.medar_client_presence p
     join public.medar_users u on u.id=p.user_id
     join lateral (
       select role::text as role from public.memberships
       where company_id=p.company_id and user_id=p.user_id and active=true
       order by case role::text when 'owner' then 0 when 'admin' then 1 when 'staff' then 2 when 'supplier' then 3 when 'driver' then 4 else 5 end
       limit 1
     ) m on true
     where p.company_id=$1::uuid
     order by p.last_seen_at desc
     limit 100`,
    [companyId],
  );
  const onlineCount = clients.filter(row => Boolean((row as { online?: boolean }).online)).length;
  return c.json({ companyId, clients, summary: { knownClients: clients.length, onlineClients: onlineCount, staleAfterSeconds: 180 } });
});


type AiProvider = 'openai' | 'gemini' | 'deepseek' | 'anthropic';
type AiChatMessage = { role: 'user' | 'assistant'; content: string };
type AiAttachmentPayload = { name: string; mimeType: string; base64?: string };
export const AI_PROVIDERS: Record<AiProvider, { label: string; model: string }> = {
  openai: { label: 'OpenAI', model: 'gpt-6-luna' },
  gemini: { label: 'Gemini', model: 'gemini-3.8-flash' },
  deepseek: { label: 'DeepSeek', model: 'deepseek-flash' },
  anthropic: { label: 'Claude', model: 'claude-sonnet-5-5' },
};
const COMPANY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function aiProvider(value: unknown): AiProvider | null {
  return value === 'openai' || value === 'gemini' || value === 'deepseek' || value === 'anthropic' ? value : null;
}
type AiCompanyMembership = { role: string; supplierId: string | null; customerId: string | null };
async function aiCompanyMembership(c: Ctx, companyId: string, userId: string): Promise<AiCompanyMembership | null> {
  const rows = await sqlFor(c).query(
    'select role::text as role,supplier_id::text as "supplierId",customer_id::text as "customerId" from public.memberships where company_id=$1::uuid and user_id=$2::uuid and active=true order by case role::text when \'owner\' then 0 when \'admin\' then 1 when \'staff\' then 2 when \'supplier\' then 3 when \'driver\' then 4 else 5 end, created_at, id limit 1',
    [companyId, userId],
  );
  return rows[0] as AiCompanyMembership | undefined ?? null;
}
export function requireAiEncryptionKey(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('AI_ENCRYPTION_KEY is not configured; a dedicated encryption secret is required.');
  }
  return value;
}

async function aiEncryptionKey(c: Ctx): Promise<CryptoKey> {
  const master = requireAiEncryptionKey(c.env.AI_ENCRYPTION_KEY);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode('medar-ai-key-v1:' + master));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function encryptAiKey(c: Ctx, apiKey: string): Promise<string> {
  const key = await aiEncryptionKey(c);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(apiKey));
  return bytesToBase64(new Uint8Array([...iv, ...new Uint8Array(encrypted)]));
}
async function decryptAiKey(c: Ctx, packed: string): Promise<string> {
  const raw = base64ToBytes(packed);
  if (raw.length < 29) throw new Error('Stored AI key is invalid');
  const key = await aiEncryptionKey(c);
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, toArrayBuffer(raw.slice(12)));
  return new TextDecoder().decode(clear);
}
function readProviderError(body: string, status: number): string {
  try {
    const payload = JSON.parse(body) as { error?: { message?: string }; message?: string };
    const message = payload.error?.message || payload.message;
    if (message && message.length < 240) return 'ارائه‌دهنده پاسخ نداد (' + status + '): ' + message;
  } catch { /* do not surface an unparsed provider response */ }
  return 'ارتباط با ارائه‌دهنده هوش مصنوعی برقرار نشد (' + status + '). کلید و شناسه مدل را بررسی کن.';
}
async function requestAiProvider(provider: AiProvider, model: string, key: string, messages: AiChatMessage[], systemPrompt: string, attachment: AiAttachmentPayload | null): Promise<string> {
  const signal = AbortSignal.timeout(45000);
  let response: Response;
  if (provider === 'openai') {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: systemPrompt },
          ...messages.map((message, index) => {
            if (attachment?.base64 && message.role === 'user' && index === messages.length - 1) {
              return {
                role: 'user',
                content: [
                  { type: 'input_file', filename: attachment.name, file_data: 'data:' + attachment.mimeType + ';base64,' + attachment.base64 },
                  { type: 'input_text', text: message.content },
                ],
              };
            }
            return message;
          }),
        ],
        max_output_tokens: 1800,
      }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(readProviderError(body, response.status));
    const parsed = JSON.parse(body) as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const text = parsed.output_text || parsed.output?.flatMap(item => item.content ?? []).filter(part => part.type === 'output_text' || part.type === 'text').map(part => part.text || '').join('');
    if (!text?.trim()) throw new Error('پاسخ متنی از OpenAI دریافت نشد.');
    return text.trim();
  }
  if (provider === 'deepseek') {
    if (attachment?.base64) throw new Error('برای فایل PDF یا Office، OpenAI، Gemini یا Claude را انتخاب کن.');
    response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...messages], max_tokens: 1800, temperature: 0.3 }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(readProviderError(body, response.status));
    const parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
    const content = parsed.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content : content?.map(part => part.text || '').join('');
    if (!text?.trim()) throw new Error('پاسخ متنی از DeepSeek دریافت نشد.');
    return text.trim();
  }
  if (provider === 'anthropic') {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages: messages.map((message, index) => {
          if (attachment?.base64 && message.role === 'user' && index === messages.length - 1) {
            return {
              role: 'user',
              content: [
                { type: 'document', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.base64 }, title: attachment.name },
                { type: 'text', text: message.content },
              ],
            };
          }
          return message;
        }),
        max_tokens: 1800,
      }),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(readProviderError(body, response.status));
    const parsed = JSON.parse(body) as { content?: Array<{ type?: string; text?: string }> };
    const text = parsed.content?.filter(part => part.type === 'text').map(part => part.text || '').join('');
    if (!text?.trim()) throw new Error('پاسخ متنی از Claude دریافت نشد.');
    return text.trim();
  }
  response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST', signal, headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: messages.map((message, index) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [
          { text: message.content },
          ...(attachment?.base64 && message.role === 'user' && index === messages.length - 1
            ? [{ inlineData: { mimeType: attachment.mimeType, data: attachment.base64 } }]
            : []),
        ],
      })),
      generationConfig: { maxOutputTokens: 1800, temperature: 0.3 },
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(readProviderError(body, response.status));
  const parsed = JSON.parse(body) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = parsed.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
  if (!text?.trim()) throw new Error('پاسخ متنی از Gemini دریافت نشد.');
  return text.trim();
}

app.get('/api/finance/bank-accounts', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  if (!(await aiCompanyMembership(c, companyId, user.id))) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (!(await userHasModulePermission(c, user.id, companyId, 'finance', 'can_read'))) return c.json({ message: 'مجوز مشاهده مالی نداری.' }, 403);
  const sql = sqlFor(c);
  const accounts = await sql.query(
    'select a.id::text as id,a.label,a.bank_name as "bankName",a.masked_account as "maskedAccount",a.currency,a.provider,a.connection_status as "connectionStatus",a.active,a.last_imported_at as "lastImportedAt",a.created_at as "createdAt",' +
    '(select count(*)::int from public.medar_bank_transactions t where t.company_id=a.company_id and t.bank_account_id=a.id) as "transactionCount",' +
    "(select count(*)::int from public.medar_bank_transactions t where t.company_id=a.company_id and t.bank_account_id=a.id and t.reconciliation_status in ('unmatched','suggested')) as \"unmatchedCount\" " +
    'from public.medar_bank_accounts a where a.company_id=$1::uuid and a.active=true order by a.created_at desc limit 100', [companyId]);
  const summary = await sql.query(
    "select count(*)::int as total,count(*) filter(where reconciliation_status in ('unmatched','suggested'))::int as unmatched,count(*) filter(where reconciliation_status='reconciled')::int as reconciled from public.medar_bank_transactions where company_id=$1::uuid",
    [companyId]);
  const [canCreate,canUpdate,canReconcile]=await Promise.all([
    userHasModulePermission(c,user.id,companyId,'finance','can_create'),
    userHasModulePermission(c,user.id,companyId,'finance','can_update'),
    userHasModulePermission(c,user.id,companyId,'finance','can_approve')
  ]);
  return c.json({accounts,summary:summary[0]??{total:0,unmatched:0,reconciled:0},capabilities:{canCreate,canUpdate,canDelete:false,canReconcile}});
});

app.post('/api/finance/bank-accounts', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string,unknown>>().catch(()=>null);
  if (!body) return c.json({message:'اطلاعات حساب معتبر نیست.'},400);
  const companyId=typeof body.companyId==='string'?body.companyId:'';
  const label=typeof body.label==='string'?body.label.trim():'';
  const bankName=typeof body.bankName==='string'?body.bankName.trim():'';
  const maskedAccount=typeof body.maskedAccount==='string'?body.maskedAccount.trim():'';
  const currency=typeof body.currency==='string'?body.currency.trim().toUpperCase():'IRR';
  if(!COMPANY_ID_RE.test(companyId)||label.length<2||label.length>120||bankName.length>120||maskedAccount.length>40||!/^[A-Z]{3}$/.test(currency))return c.json({message:'اطلاعات حساب یا ارز معتبر نیست.'},422);
  if(!isMaskedBankAccountValid(maskedAccount))return c.json({message:'فقط چهار رقم پایانی را وارد کن؛ شماره کامل حساب ذخیره نمی‌شود.'},422);
  const membership=await aiCompanyMembership(c,companyId,user.id);
  if(!membership||!['owner','admin','staff'].includes(membership.role))return c.json({message:'فقط اعضای داخلی می‌توانند حساب تعریف کنند.'},403);
  if(!(await userHasModulePermission(c,user.id,companyId,'finance','can_create')))return c.json({message:'مجوز ایجاد حساب مالی نداری.'},403);
  const rows=await sqlFor(c).query(
    "insert into public.medar_bank_accounts(company_id,label,bank_name,masked_account,currency,provider,connection_status,created_by) values($1::uuid,$2,$3,$4,$5,'manual_csv','manual_import',$6::uuid) returning id::text as id,label,bank_name as \"bankName\",masked_account as \"maskedAccount\",currency,provider,connection_status as \"connectionStatus\",active,created_at as \"createdAt\"",
    [companyId,label,bankName,maskedAccount,currency,user.id]);
  const account=rows[0];
  await sqlFor(c).query("insert into public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata) values($1::uuid,'bank_account.created','medar_bank_account',$2::text,jsonb_build_object('company_id',$3::text,'provider','manual_csv','currency',$4::text))",[user.id,String(account.id),companyId,currency]);
  return c.json({account},201);
});

app.get('/api/finance/bank-transactions', async (c) => {
  const user=await requireUser(c);
  if(user instanceof Response)return user;
  const companyId=c.req.query('companyId')??'',accountId=c.req.query('accountId')??'',status=c.req.query('status')??'all';
  if(!COMPANY_ID_RE.test(companyId)||(accountId&&!COMPANY_ID_RE.test(accountId)))return c.json({message:'شناسه حساب معتبر نیست.'},422);
  if(!['all','unmatched','suggested','reconciled','ignored'].includes(status))return c.json({message:'فیلتر وضعیت نامعتبر است.'},422);
  if(!(await aiCompanyMembership(c,companyId,user.id)))return c.json({message:'به این فضای کاری دسترسی فعال نداری.'},403);
  if(!(await userHasModulePermission(c,user.id,companyId,'finance','can_read')))return c.json({message:'مجوز مشاهده مالی نداری.'},403);
  const params:unknown[]=[companyId];let where='company_id=$1::uuid';
  if(accountId){params.push(accountId);where+=' and bank_account_id=$'+params.length+'::uuid';}
  if(status!=='all'){params.push(status);where+=' and reconciliation_status=$'+params.length;}
  params.push(500);
  const transactions=await sqlFor(c).query(
    'select id::text as id,bank_account_id::text as "bankAccountId",external_transaction_id as "externalTransactionId",booked_at as "bookedAt",amount::text as amount,currency,description,counterparty,reference,direction,reconciliation_status as "reconciliationStatus",matched_entity_type as "matchedEntityType",matched_entity_id::text as "matchedEntityId",matched_at as "matchedAt",imported_at as "importedAt" '+
    'from public.medar_bank_transactions where '+where+' order by booked_at desc limit $'+params.length,params);
  return c.json({transactions});
});


app.post('/api/finance/bank-transactions/import', async (c) => {
  const user=await requireUser(c);
  if(user instanceof Response)return user;
  const body=await c.req.json<Record<string,unknown>>().catch(()=>null);
  if(!body)return c.json({message:'اطلاعات ورود صورت‌حساب معتبر نیست.'},400);
  const companyId=typeof body.companyId==='string'?body.companyId:'';
  const accountId=typeof body.accountId==='string'?body.accountId:'';
  if(!COMPANY_ID_RE.test(companyId)||!COMPANY_ID_RE.test(accountId))return c.json({message:'شناسه حساب یا مجموعه معتبر نیست.'},422);
  const membership=await aiCompanyMembership(c,companyId,user.id);
  if(!membership||!['owner','admin','staff'].includes(membership.role))return c.json({message:'فقط اعضای داخلی می‌توانند صورت‌حساب وارد کنند.'},403);
  if(!(await userHasModulePermission(c,user.id,companyId,'finance','can_create')))return c.json({message:'مجوز ورود تراکنش مالی نداری.'},403);
  if(!Array.isArray(body.transactions)||body.transactions.length<1||body.transactions.length>500)return c.json({message:'در هر بار باید بین ۱ تا ۵۰۰ تراکنش وارد شود.'},422);
  const sql=sqlFor(c);
  const account=await sql.query('select id,currency from public.medar_bank_accounts where id=$1::uuid and company_id=$2::uuid and active=true limit 1',[accountId,companyId]);
  if(!account.length)return c.json({message:'حساب فعال در این مجموعه پیدا نشد.'},404);
  const accountCurrency = String((account[0] as {currency?:string}).currency ?? '');
  const ids=new Set<string>(), rows:Array<Record<string,string>>=[];
  for(let index=0;index<body.transactions.length;index++){
    const raw=body.transactions[index];
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return c.json({message:'ساختار تراکنش معتبر نیست.'},422);
    const item=raw as Record<string,unknown>;
    const externalId=typeof item.externalTransactionId==='string'?item.externalTransactionId.trim():'';
    const bookedAt=typeof item.bookedAt==='string'?item.bookedAt:'';
    const parsedDate=new Date(bookedAt);
    const amount=Number(item.amount);
    const currency=typeof item.currency==='string'?item.currency.trim().toUpperCase():'IRR';
    const description=typeof item.description==='string'?item.description.trim():'';
    const counterparty=typeof item.counterparty==='string'?item.counterparty.trim():'';
    const reference=typeof item.reference==='string'?item.reference.trim():'';
    if(externalId.length<8||externalId.length>240||/[\r\n\0]/.test(externalId)||ids.has(externalId))return c.json({message:'شناسه تراکنش خالی، تکراری یا نامعتبر است.'},422);
    ids.add(externalId);
    if(!bookedAt||!Number.isFinite(parsedDate.getTime()))return c.json({message:'تاریخ یک تراکنش معتبر نیست.'},422);
    if(!Number.isFinite(amount)||Math.abs(amount)<0.01||Math.abs(amount)>1e15||Math.abs(amount*100-Math.round(amount*100))>0.0001)return c.json({message:'مبلغ باید غیرصفر و حداکثر با دو رقم اعشار باشد.'},422);
    if(!/^[A-Z]{3}$/.test(currency)||!isBankTransactionCurrencyCompatible(accountCurrency,currency)||description.length>1500||counterparty.length>300||reference.length>240)return c.json({message:'ارز تراکنش باید با ارز حساب مقصد یکسان باشد و توضیح یا مرجع معتبر باشد.'},422);
    rows.push({external_transaction_id:externalId,booked_at:parsedDate.toISOString(),amount:amount.toFixed(2),currency,description,counterparty,reference,direction:amount>0?'incoming':'outgoing'});
  }
  try {
    const results=await sql.transaction([
      sql.query(
        'insert into public.medar_bank_transactions(company_id,bank_account_id,external_transaction_id,booked_at,amount,currency,description,counterparty,reference,direction,imported_by) '+
        'select $1::uuid,$2::uuid,x.external_transaction_id,x.booked_at,x.amount,x.currency,x.description,x.counterparty,x.reference,x.direction,$3::uuid '+
        'from jsonb_to_recordset($4::jsonb) as x(external_transaction_id text,booked_at timestamptz,amount numeric,currency text,description text,counterparty text,reference text,direction text) '+
        'on conflict(company_id,bank_account_id,external_transaction_id) do nothing returning id',
        [companyId,accountId,user.id,JSON.stringify(rows)]),
      sql.query('update public.medar_bank_accounts set last_imported_at=now(),updated_at=now() where id=$1::uuid and company_id=$2::uuid',[accountId,companyId]),
      sql.query("insert into public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata) values($1::uuid,'bank_transactions.imported','medar_bank_account',$2::text,jsonb_build_object('company_id',$3::text,'submitted_count',$4::int))",[user.id,accountId,companyId,rows.length]),
    ]);
    const inserted=(results[0]??[]) as Array<{id:string}>;
    return c.json({inserted:inserted.length,skippedDuplicates:rows.length-inserted.length,submitted:rows.length});
  } catch {
    return c.json({message:'ورود صورت‌حساب ثبت نشد؛ این دسته تراکنش‌ها به‌صورت ناقص ذخیره نشده‌اند.'},500);
  }
});

app.get('/api/finance/bank-transactions/:id/candidates', async (c) => {
  const user=await requireUser(c);
  if(user instanceof Response)return user;
  const companyId=c.req.query('companyId')??'',transactionId=c.req.param('id');
  if(!COMPANY_ID_RE.test(companyId)||!COMPANY_ID_RE.test(transactionId))return c.json({message:'شناسه تراکنش معتبر نیست.'},422);
  if(!(await aiCompanyMembership(c,companyId,user.id)))return c.json({message:'به این فضای کاری دسترسی فعال نداری.'},403);
  if(!(await userHasModulePermission(c,user.id,companyId,'finance','can_read')))return c.json({message:'برای مشاهده اسناد مالی مجوز نداری.'},403);
  const sql=sqlFor(c);
  const rows=await sql.query('select id::text as id,direction,amount::text as amount,currency,reconciliation_status as status from public.medar_bank_transactions where id=$1::uuid and company_id=$2::uuid limit 1',[transactionId,companyId]);
  const transaction=rows[0] as {id:string;direction:string;amount:string;currency:string;status:string}|undefined;
  if(!transaction)return c.json({message:'تراکنش بانکی پیدا نشد.'},404);
  if(['reconciled','ignored'].includes(transaction.status))return c.json({candidates:[]});
  let candidates:Array<Record<string,unknown>>=[];
  if(transaction.direction==='incoming'){
    const invoices=await sql.query(
      "select 'invoice' as \"entityType\",i.id::text as \"entityId\",'فاکتور '||i.reference||' · '||coalesce(c.name,'مشتری') as label,(i.amount-i.paid_amount)::text as amount,i.due_date::text as \"dueAt\",i.status "+
      "from public.invoices i left join public.customers c on c.company_id=i.company_id and c.id=i.customer_id where i.company_id=$1::uuid and i.status in ('issued','partially_paid','overdue') order by i.due_date asc nulls last limit 50",[companyId]);
    const partners=await sql.query(
      "select 'partner_financial_entry' as \"entityType\",e.id::text as \"entityId\",'سند شریک '||e.entry_type as label,(e.amount-e.paid_amount)::text as amount,e.recognized_on::text as \"dueAt\",e.status from public.partner_financial_entries e where e.company_id=$1::uuid and e.status in ('submitted','approved') and e.direction in ('inflow_to_company','partner_to_company') order by e.recognized_on desc limit 30",[companyId]);
    candidates=[...invoices,...partners];
  } else {
    const settlements=await sql.query(
      "select 'settlement' as \"entityType\",s.id::text as \"entityId\",'تسویه '||coalesce(nullif(s.invoice_ref,''),'تأمین‌کننده') as label,s.amount::text as amount,s.due_date::text as \"dueAt\",s.status from public.settlements s where s.company_id=$1::uuid and s.status in ('pending','approved') order by s.due_date asc nulls last limit 50",[companyId]);
    const orders=await sql.query(
      "select 'purchase_order' as \"entityType\",po.id::text as \"entityId\",'سفارش خرید '||po.reference as label,coalesce(sum(i.ordered_quantity*i.unit_cost),0)::text as amount,po.expected_delivery::text as \"dueAt\",po.status from public.purchase_orders po left join public.purchase_order_items i on i.company_id=po.company_id and i.purchase_order_id=po.id where po.company_id=$1::uuid and po.status in ('approved','partially_received') group by po.id order by po.expected_delivery asc nulls last limit 50",[companyId]);
    const partners=await sql.query(
      "select 'partner_financial_entry' as \"entityType\",e.id::text as \"entityId\",'سند شریک '||e.entry_type as label,(e.amount-e.paid_amount)::text as amount,e.recognized_on::text as \"dueAt\",e.status from public.partner_financial_entries e where e.company_id=$1::uuid and e.status in ('submitted','approved') and e.direction in ('outflow_from_company','company_to_partner') order by e.recognized_on desc limit 30",[companyId]);
    candidates=[...settlements,...orders,...partners];
  }
  return c.json({candidates:candidates.slice(0,100),transaction:{direction:transaction.direction,amount:transaction.amount,currency:transaction.currency}});
});

app.post('/api/finance/bank-transactions/:id/reconcile', async (c) => {
  const user=await requireUser(c);
  if(user instanceof Response)return user;
  const transactionId=c.req.param('id');
  const body=await c.req.json<Record<string,unknown>>().catch(()=>null);
  if(!body)return c.json({message:'اطلاعات تطبیق معتبر نیست.'},400);
  const companyId=typeof body.companyId==='string'?body.companyId:'';
  const entityType=typeof body.entityType==='string'?body.entityType:'';
  const entityId=typeof body.entityId==='string'?body.entityId:'';
  if(!COMPANY_ID_RE.test(transactionId)||!COMPANY_ID_RE.test(companyId)||!COMPANY_ID_RE.test(entityId))return c.json({message:'شناسه تراکنش، مجموعه یا سند معتبر نیست.'},422);
  const targets:Record<string,string>={invoice:'invoices',purchase_order:'purchase_orders',settlement:'settlements',partner_financial_entry:'partner_financial_entries'};
  const table=targets[entityType];
  if(!table)return c.json({message:'نوع سند برای تطبیق پشتیبانی نمی‌شود.'},422);
  const membership=await aiCompanyMembership(c,companyId,user.id);
  if(!membership||!['owner','admin','staff'].includes(membership.role))return c.json({message:'فقط اعضای داخلی می‌توانند تطبیق دهند.'},403);
  if(!(await userHasModulePermission(c,user.id,companyId,'finance','can_approve')))return c.json({message:'مجوز تأیید تطبیق مالی نداری.'},403);
  const sql=sqlFor(c);
  const [txn,target]=await Promise.all([
    sql.query('select direction,reconciliation_status from public.medar_bank_transactions where id=$1::uuid and company_id=$2::uuid limit 1',[transactionId,companyId]),
    sql.query(
      entityType === 'partner_financial_entry'
        ? 'select id,direction from public.'+table+' where id=$1::uuid and company_id=$2::uuid limit 1'
        : 'select id from public.'+table+' where id=$1::uuid and company_id=$2::uuid limit 1',
      [entityId,companyId]),
  ]);
  const transaction=txn[0] as {direction:string;reconciliation_status:string}|undefined;
  if(!transaction||!target.length)return c.json({message:'تراکنش یا سند در همین مجموعه پیدا نشد.'},404);
  if(transaction.reconciliation_status==='reconciled')return c.json({message:'این تراکنش قبلاً تطبیق نهایی شده است.'},409);
  if(transaction.reconciliation_status==='ignored')return c.json({message:'این تراکنش نادیده گرفته شده است.'},409);
  const targetDirection = (target[0] as { direction?: string }).direction;
  if (!isBankReconciliationDirectionCompatible(entityType, transaction.direction, targetDirection)) {
    return c.json({message:'جهت تراکنش با نوع سند هماهنگ نیست.'},422);
  }
  const changed=await sql.query(
    "update public.medar_bank_transactions set reconciliation_status='reconciled',matched_entity_type=$1,matched_entity_id=$2::uuid,matched_by=$3::uuid,matched_at=now() where id=$4::uuid and company_id=$5::uuid and reconciliation_status in ('unmatched','suggested') returning id",
    [entityType,entityId,user.id,transactionId,companyId]);
  if(!changed.length)return c.json({message:'تراکنش هم‌زمان تغییر کرده است؛ دوباره تازه‌سازی کن.'},409);
  await sql.query("insert into public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata) values($1::uuid,'bank_transaction.reconciled','medar_bank_transaction',$2::text,jsonb_build_object('company_id',$3::text,'matched_entity_type',$4::text,'matched_entity_id',$5::text))",[user.id,transactionId,companyId,entityType,entityId]);
  return c.json({ok:true,status:'reconciled'});
});

app.post('/api/finance/bank-transactions/:id/ignore', async (c) => {
  const user=await requireUser(c);
  if(user instanceof Response)return user;
  const transactionId=c.req.param('id'),body=await c.req.json<Record<string,unknown>>().catch(()=>null);
  const companyId=typeof body?.companyId==='string'?body.companyId:'';
  if(!COMPANY_ID_RE.test(transactionId)||!COMPANY_ID_RE.test(companyId))return c.json({message:'شناسه تراکنش یا مجموعه نامعتبر است.'},422);
  const membership=await aiCompanyMembership(c,companyId,user.id);
  if(!membership||!['owner','admin','staff'].includes(membership.role))return c.json({message:'فقط اعضای داخلی می‌توانند وضعیت تراکنش را تغییر دهند.'},403);
  if(!(await userHasModulePermission(c,user.id,companyId,'finance','can_update')))return c.json({message:'مجوز ویرایش مالی نداری.'},403);
  const rows=await sqlFor(c).query("update public.medar_bank_transactions set reconciliation_status='ignored' where id=$1::uuid and company_id=$2::uuid and reconciliation_status in ('unmatched','suggested') returning id",[transactionId,companyId]);
  if(!rows.length)return c.json({message:'تراکنش پیدا نشد یا نهایی شده است.'},409);
  await sqlFor(c).query("insert into public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata) values($1::uuid,'bank_transaction.ignored','medar_bank_transaction',$2::text,jsonb_build_object('company_id',$3::text))",[user.id,transactionId,companyId]);
  return c.json({ok:true,status:'ignored'});
});

app.get('/api/ai/providers', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (!(await userHasModulePermission(c, user.id, companyId, 'agents', 'can_read'))) {
    return c.json({ message: 'برای مشاهده تنظیمات و وضعیت دستیار مجوز نداری.' }, 403);
  }
  const rows = await sqlFor(c).query('select provider,model,is_default as "isDefault",updated_at as "updatedAt" from public.medar_ai_provider_configs where company_id=$1::uuid order by is_default desc,provider', [companyId]);
  const byProvider = new Map((rows as Array<{ provider: string; model: string; isDefault: boolean; updatedAt: string }>).map(row => [row.provider, row]));
  const providers = (Object.keys(AI_PROVIDERS) as AiProvider[]).map(provider => {
    const item = byProvider.get(provider);
    return { provider, model: item?.model || AI_PROVIDERS[provider].model, isDefault: Boolean(item?.isDefault), configured: Boolean(item), updatedAt: item?.updatedAt ?? null };
  });
  return c.json({ companyId, activeProvider: providers.find(item => item.isDefault)?.provider ?? null, providers, canConfigure: membership.role === 'owner' || membership.role === 'admin' });
});

app.put('/api/ai/providers', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'تنظیمات پرووایدر معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  const provider = aiProvider(body.provider);
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const makeDefault = body.isDefault !== false;
  if (!COMPANY_ID_RE.test(companyId) || !provider) return c.json({ message: 'شناسه مجموعه یا پرووایدر معتبر نیست.' }, 422);
  if (!model || model.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(model)) return c.json({ message: 'شناسه مدل معتبر نیست.' }, 422);
  if (apiKey.length > 512 || (apiKey && apiKey.length < 12)) return c.json({ message: 'فرمت کلید API معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (membership.role !== 'owner' && membership.role !== 'admin') return c.json({ message: 'فقط مالک یا مدیر مجموعه می‌تواند پرووایدرهای هوش مصنوعی را تنظیم کند.' }, 403);
  const sql = sqlFor(c);
  const existingRows = await sql.query('select encrypted_api_key from public.medar_ai_provider_configs where company_id=$1::uuid and provider=$2 limit 1', [companyId, provider]);
  const existing = existingRows[0] as { encrypted_api_key: string } | undefined;
  if (!apiKey && !existing) return c.json({ message: 'برای اتصال اولیه باید API key وارد شود.' }, 422);
  let encrypted = existing?.encrypted_api_key ?? '';
  if (apiKey) {
    try { encrypted = await encryptAiKey(c, apiKey); }
    catch { return c.json({ message: 'رمزنگاری کلید هوش مصنوعی در سمت سرور آماده نیست.' }, 503); }
  }
  if (makeDefault) await sql.query('update public.medar_ai_provider_configs set is_default=false,updated_at=now() where company_id=$1::uuid and is_default=true and provider<>$2', [companyId, provider]);
  const query = [
    'insert into public.medar_ai_provider_configs(company_id,provider,model,encrypted_api_key,is_default,updated_by)',
    'values($1::uuid,$2,$3,$4,$5,$6::uuid)',
    'on conflict(company_id,provider) do update set model=excluded.model,encrypted_api_key=excluded.encrypted_api_key,is_default=excluded.is_default,updated_by=excluded.updated_by,updated_at=now()',
    'returning provider,model,is_default as "isDefault",updated_at as "updatedAt"',
  ].join(' ');
  const rows = await sql.query(query, [companyId, provider, model, encrypted, makeDefault, user.id]);
  return c.json({ ok: true, config: rows[0], message: 'تنظیمات پرووایدر ذخیره شد.' });
});

app.post('/api/ai/provider-test', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'درخواست تست اتصال معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  const provider = aiProvider(body.provider);
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!COMPANY_ID_RE.test(companyId) || !provider) return c.json({ message: 'شناسه مجموعه یا پرووایدر معتبر نیست.' }, 422);
  if (!model || model.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(model)) return c.json({ message: 'شناسه مدل معتبر نیست.' }, 422);
  if (apiKey.length > 512 || (apiKey && apiKey.length < 12)) return c.json({ message: 'فرمت کلید API معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (membership.role !== 'owner' && membership.role !== 'admin') return c.json({ message: 'فقط مالک یا مدیر می‌تواند پرووایدر هوش مصنوعی را تست کند.' }, 403);
  const sql = sqlFor(c);
  const limits = await sql.query([
    "select (select count(*)::int from public.medar_ai_usage_log where user_id=$1::uuid and created_at>now()-interval '1 minute') as minute_count,",
    "(select count(*)::int from public.medar_ai_usage_log where user_id=$1::uuid and created_at>now()-interval '1 day') as day_count",
  ].join(' '), [user.id]);
  const limit = limits[0] as { minute_count: number; day_count: number } | undefined;
  if (Number(limit?.minute_count ?? 0) >= 8 || Number(limit?.day_count ?? 0) >= 120) {
    return c.json({ message: 'سقف درخواست دستیار در بازه فعلی پر شده است. کمی بعد دوباره تلاش کن.' }, 429);
  }
  let providerKey = apiKey;
  if (!providerKey) {
    const rows = await sql.query(
      'select encrypted_api_key from public.medar_ai_provider_configs where company_id=$1::uuid and provider=$2 limit 1',
      [companyId, provider],
    );
    const stored = rows[0] as { encrypted_api_key: string } | undefined;
    if (!stored) return c.json({ message: 'برای تست اتصال، API key را وارد کن؛ این endpoint کلید واردشده را ذخیره نمی‌کند.' }, 422);
    try { providerKey = await decryptAiKey(c, stored.encrypted_api_key); }
    catch { return c.json({ message: 'رمزگشایی کلید ذخیره‌شده ناموفق بود؛ کلید را دوباره در تنظیمات وارد کن.' }, 503); }
  }
  try {
    await sql.query(
      'insert into public.medar_ai_usage_log(company_id,user_id,provider,model,input_chars) values($1::uuid,$2::uuid,$3,$4,$5)',
      [companyId, user.id, provider, model, 2],
    );
    const response = await requestAiProvider(
      provider, model, providerKey,
      [{ role: 'user', content: 'Reply with exactly OK.' }],
      'This is a connection test. Reply with exactly OK and do not do anything else.',
      null,
    );
    if (!response.trim()) return c.json({ message: 'ارائه‌دهنده پاسخ خالی برگرداند؛ مدل و کلید را بررسی کن.' }, 502);
    return c.json({ ok: true, provider, model, message: 'اتصال به ' + AI_PROVIDERS[provider].label + ' موفق بود. این تست کلید جدید را ذخیره نکرد.' });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'تست اتصال انجام نشد.';
    return c.json({ ok: false, message }, 502);
  }
});


/**
 * AI/automation action proposals are inert records. No business write occurs until
 * the authenticated user explicitly confirms the proposal through /execute.
 */

/* Removed obsolete /api/finance/bank/* endpoints; the canonical /api/finance/bank-accounts and /api/finance/bank-transactions routes above enforce module permissions. */

app.get('/api/ai/actions', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (!['owner','admin','staff'].includes(membership.role)) {
    return c.json({ message: 'این بخش فقط برای اعضای داخلی مجموعه فعال است.' }, 403);
  }
  if (!(await userHasModulePermission(c, user.id, companyId, 'agents', 'can_read'))) {
    return c.json({ message: 'برای مشاهده مرکز ایجنت‌ها مجوز نداری.' }, 403);
  }
  const rows = await sqlFor(c).query(
    `select a.id, a.tool_key as "toolKey", a.status, a.arguments, a.result,
            a.created_at as "createdAt", a.executed_at as "executedAt",
            u.display_name as "requestedByName", a.requested_by::text as "requestedBy"
       from public.medar_ai_action_runs a
       join public.medar_users u on u.id = a.requested_by
      where a.company_id = $1::uuid and ($2 in ('owner','admin') or a.requested_by = $3::uuid)
      order by a.created_at desc limit 50`,
    [companyId, membership.role, user.id],
  );
  return c.json({ actions: rows });
});

app.post('/api/ai/actions/propose', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'درخواست پیشنهاد اقدام معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (!['owner','admin','staff'].includes(membership.role)) {
    return c.json({ message: 'فقط اعضای داخلی مجموعه می‌توانند اقدام عملیاتی پیشنهاد کنند.' }, 403);
  }
  if (!(await userHasModulePermission(c, user.id, companyId, 'agents', 'can_create')) ||
      !(await userHasModulePermission(c, user.id, companyId, 'operational-tasks', 'can_create'))) {
    return c.json({ message: 'برای پیشنهاد وظیفه در این مجموعه مجوز ایجاد نداری.' }, 403);
  }
  const toolKey = typeof body.toolKey === 'string' ? body.toolKey : 'create_operational_task';
  if (toolKey !== 'create_operational_task') return c.json({ message: 'این نوع اقدام هنوز پشتیبانی نمی‌شود.' }, 422);
  const rawArgs = body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
    ? body.arguments as Record<string, unknown> : {};
  const title = typeof rawArgs.title === 'string' ? rawArgs.title.trim() : '';
  const instructions = typeof rawArgs.instructions === 'string' ? rawArgs.instructions.trim() : '';
  const priority = typeof rawArgs.priority === 'string' ? rawArgs.priority : 'normal';
  const dueAtRaw = typeof rawArgs.dueAt === 'string' ? rawArgs.dueAt.trim() : '';
  const assigneeUserIdRaw = typeof rawArgs.assigneeUserId === 'string' ? rawArgs.assigneeUserId.trim() : '';
  const assigneeSupplierIdRaw = typeof rawArgs.assigneeSupplierId === 'string' ? rawArgs.assigneeSupplierId.trim() : '';
  if (title.length < 2 || title.length > 180) return c.json({ message: 'عنوان وظیفه باید بین ۲ تا ۱۸۰ نویسه باشد.' }, 422);
  if (instructions.length > 3000) return c.json({ message: 'شرح وظیفه نباید بیشتر از ۳۰۰۰ نویسه باشد.' }, 422);
  if (!['low','normal','high','critical'].includes(priority)) return c.json({ message: 'اولویت وظیفه معتبر نیست.' }, 422);
  if (dueAtRaw && (!Number.isFinite(Date.parse(dueAtRaw)) || dueAtRaw.length > 80)) {
    return c.json({ message: 'زمان سررسید معتبر نیست.' }, 422);
  }
  if (assigneeUserIdRaw && !COMPANY_ID_RE.test(assigneeUserIdRaw)) return c.json({ message: 'شناسه مسئول وظیفه معتبر نیست.' }, 422);
  if (assigneeSupplierIdRaw && !COMPANY_ID_RE.test(assigneeSupplierIdRaw)) return c.json({ message: 'شناسه تأمین‌کننده معتبر نیست.' }, 422);
  if (assigneeUserIdRaw && assigneeSupplierIdRaw) return c.json({ message: 'وظیفه فقط می‌تواند یک مسئول داشته باشد.' }, 422);
  const assigneeUserId = assigneeUserIdRaw || (!assigneeSupplierIdRaw ? user.id : '');
  const sql = sqlFor(c);
  if (assigneeUserId) {
    const assignee = await sql.query(
      "select 1 from public.memberships where user_id=$1::uuid and company_id=$2::uuid and active=true and role::text in ('owner','admin','staff','driver') limit 1",
      [assigneeUserId, companyId],
    );
    if (!assignee.length) return c.json({ message: 'مسئول انتخاب‌شده عضو فعال و مجاز این مجموعه نیست.' }, 422);
  }
  if (assigneeSupplierIdRaw) {
    const supplier = await sql.query(
      'select 1 from public.suppliers where id=$1::uuid and company_id=$2::uuid and active=true limit 1',
      [assigneeSupplierIdRaw, companyId],
    );
    if (!supplier.length) return c.json({ message: 'تأمین‌کننده انتخاب‌شده فعال نیست یا به این مجموعه تعلق ندارد.' }, 422);
  }
  const argumentsJson = {
    title, instructions, priority,
    ...(dueAtRaw ? { dueAt: new Date(dueAtRaw).toISOString() } : {}),
    ...(assigneeUserId ? { assigneeUserId } : {}),
    ...(assigneeSupplierIdRaw ? { assigneeSupplierId: assigneeSupplierIdRaw } : {}),
  };
  try {
    const rows = await sql.query(
      "insert into public.medar_ai_action_runs(company_id,requested_by,tool_key,status,arguments) values($1::uuid,$2::uuid,'create_operational_task','proposed',$3::jsonb) returning id,status,tool_key as \"toolKey\",arguments,created_at as \"createdAt\"",
      [companyId, user.id, JSON.stringify(argumentsJson)],
    );
    const action = rows[0];
    await sql.query(
      "insert into public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata) values($1::uuid,'ai_action.proposed','ai_action_run',$2::text,jsonb_build_object('company_id',$3::text,'tool_key','create_operational_task'))",
      [user.id, String(action.id), companyId],
    );
    return c.json({ action, requiresConfirmation: true }, 201);
  } catch {
    return c.json({ message: 'پیشنهاد اقدام ذخیره نشد. تغییری در وظایف کسب‌وکار ایجاد نشده است.' }, 500);
  }
});

app.post('/api/ai/actions/:id/execute', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const actionId = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(actionId) || !COMPANY_ID_RE.test(companyId)) {
    return c.json({ message: 'شناسه اقدام یا مجموعه معتبر نیست.' }, 422);
  }
  if (body?.confirmed !== true) return c.json({ message: 'برای اجرای اقدام باید تأیید صریح ارسال شود.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (!['owner','admin','staff'].includes(membership.role)) {
    return c.json({ message: 'برای اجرای اقدام عملیاتی دسترسی لازم وجود ندارد.' }, 403);
  }
  if (!(await userHasModulePermission(c, user.id, companyId, 'agents', 'can_approve')) ||
      !(await userHasModulePermission(c, user.id, companyId, 'operational-tasks', 'can_create'))) {
    return c.json({ message: 'برای تأیید این اقدام یا ایجاد وظیفه مجوز نداری.' }, 403);
  }
  try {
    const rows = await sqlFor(c).query(
      'select public.medar_execute_ai_create_task($1::uuid,$2::uuid,$3::uuid) as result',
      [user.id, companyId, actionId],
    );
    if (!rows.length) return c.json({ message: 'نتیجه اجرای اقدام دریافت نشد.' }, 502);
    return c.json({ ok: true, result: (rows[0] as { result: unknown }).result });
  } catch {
    return c.json({ message: 'اقدام اجرا نشد؛ پیشنهاد تغییری در داده‌های عملیاتی ایجاد نکرد. دسترسی و اطلاعات پیشنهاد را بررسی کن.' }, 409);
  }
});

app.post('/api/ai/actions/:id/cancel', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const actionId = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(actionId) || !COMPANY_ID_RE.test(companyId)) {
    return c.json({ message: 'شناسه اقدام یا مجموعه معتبر نیست.' }, 422);
  }
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (!['owner','admin','staff'].includes(membership.role)) return c.json({ message: 'دسترسی لغو پیشنهاد را نداری.' }, 403);
  if (!(await userHasModulePermission(c, user.id, companyId, 'agents', 'can_update'))) {
    return c.json({ message: 'برای لغو پیشنهاد مجوز ویرایش نداری.' }, 403);
  }
  const sql = sqlFor(c);
  const rows = await sql.query(
    "update public.medar_ai_action_runs set status='cancelled',updated_at=now() where id=$1::uuid and company_id=$2::uuid and status='proposed' and (requested_by=$3::uuid or $4 in ('owner','admin')) returning id",
    [actionId, companyId, user.id, membership.role],
  );
  if (!rows.length) return c.json({ message: 'پیشنهاد پیدا نشد یا دیگر قابل لغو نیست.' }, 409);
  await sql.query(
    "insert into public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata) values($1::uuid,'ai_action.cancelled','ai_action_run',$2::text,jsonb_build_object('company_id',$3::text))",
    [user.id, actionId, companyId],
  );
  return c.json({ ok: true });
});


/**
 * Real-time Persian voice over WebRTC. The main provider key stays server-side;
 * the browser sends SDP only after authenticated tenant membership is checked.
 */
app.post('/api/ai/realtime/session', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (!(await userHasModulePermission(c, user.id, companyId, 'agents', 'can_read'))) {
    return c.json({ message: 'برای استفاده از دستیار هوشمند مجوز مشاهده نداری.' }, 403);
  }

  const sdp = await c.req.text().catch(() => '');
  if (!sdp || sdp.length < 100 || sdp.length > 100000 || !sdp.startsWith('v=0')) {
    return c.json({ message: 'درخواست شروع مکالمه صوتی معتبر نیست.' }, 422);
  }

  const sql = sqlFor(c);
  const limits = await sql.query([
    "select (select count(*)::int from public.medar_ai_usage_log where user_id=$1::uuid and model='gpt-realtime-2.1' and created_at>now()-interval '1 minute') as minute_count,",
    "(select count(*)::int from public.medar_ai_usage_log where user_id=$1::uuid and model='gpt-realtime-2.1' and created_at>now()-interval '1 day') as day_count",
  ].join(' '), [user.id]);
  const usage = limits[0] as { minute_count: number; day_count: number } | undefined;
  if (Number(usage?.minute_count ?? 0) >= 4 || Number(usage?.day_count ?? 0) >= 40) {
    return c.json({ message: 'تعداد شروع مکالمه صوتی به سقف موقت رسیده است. کمی بعد دوباره تلاش کن.' }, 429);
  }

  const configs = await sql.query(
    "select model,encrypted_api_key from public.medar_ai_provider_configs where company_id=$1::uuid and provider='openai' order by is_default desc,updated_at desc limit 1",
    [companyId],
  );
  const config = configs[0] as { model: string; encrypted_api_key: string } | undefined;
  if (!config) {
    return c.json({ message: 'برای مکالمه صوتی realtime باید یک کلید OpenAI در تنظیمات همین مجموعه ذخیره شده باشد.' }, 409);
  }
  let apiKey: string;
  try {
    apiKey = await decryptAiKey(c, config.encrypted_api_key);
  } catch {
    return c.json({ message: 'کلید OpenAI قابل خواندن نیست؛ آن را دوباره در تنظیمات دستیار ذخیره کن.' }, 503);
  }

  let voiceContext: Record<string, unknown> = {};
  try {
    if (['owner','admin','staff'].includes(membership.role)) {
      const metrics = await sql.query([
        'select',
        "(select count(*)::int from public.operational_tasks where company_id=$1::uuid and status not in ('approved','cancelled')) as active_tasks,",
        "(select count(*)::int from public.operational_tasks where company_id=$1::uuid and due_at<now() and status not in ('approved','cancelled')) as overdue_tasks,",
        "(select count(*)::int from public.operational_incidents where company_id=$1::uuid and status not in ('resolved','closed','cancelled')) as open_incidents,",
        "(select count(*)::int from public.orders where company_id=$1::uuid and requested_delivery<current_date and status not in ('delivered','cancelled')) as late_orders",
      ].join(' '), [companyId]);
      const [tasks, incidents] = await Promise.all([
        sql.query("select title,status,priority,due_at from public.operational_tasks where company_id=$1::uuid and status not in ('approved','cancelled') order by due_at asc nulls last limit 8", [companyId]),
        sql.query("select title,severity,status,created_at from public.operational_incidents where company_id=$1::uuid and status not in ('resolved','closed','cancelled') order by created_at desc limit 4", [companyId]),
      ]);
      voiceContext = { metrics: metrics[0] ?? {}, activeTasks: tasks, openIncidents: incidents };
      if (['owner','admin'].includes(membership.role)) {
        const finance = await sql.query([
          'select',
          "(select count(*)::int from public.invoices where company_id=$1::uuid and status in ('issued','partially_paid','overdue')) as open_invoices,",
          "(select count(*)::int from public.purchase_orders where company_id=$1::uuid and status in ('draft','approved','partially_received')) as open_purchase_orders",
        ].join(' '), [companyId]);
        voiceContext = { ...voiceContext, ownerMetrics: finance[0] ?? {} };
      }
    } else if (membership.role === 'supplier' && membership.supplierId) {
      const [tasks, commitments] = await Promise.all([
        sql.query("select title,status,priority,due_at from public.operational_tasks where company_id=$1::uuid and assignee_supplier_id=$2::uuid and status not in ('approved','cancelled') order by due_at asc nulls last limit 8", [companyId, membership.supplierId]),
        sql.query("select count(*)::int as active_commitments from public.capacity_commitments where company_id=$1::uuid and supplier_id=$2::uuid and status in ('confirmed','committed') and period_end>=current_date", [companyId, membership.supplierId]),
      ]);
      voiceContext = { activeTasks: tasks, capacity: commitments[0] ?? {} };
    } else if (membership.role === 'driver') {
      const shipments = await sql.query("select s.stage,s.planned_departure,s.delivered_at,o.reference as order_reference from public.shipments s join public.orders o on o.company_id=s.company_id and o.id=s.order_id where s.company_id=$1::uuid and s.driver_user_id=$2::uuid and s.stage not in ('delivered','returned','failed') order by s.planned_departure asc nulls last limit 8", [companyId, user.id]);
      voiceContext = { assignedOpenShipments: shipments.length, assignedShipments: shipments };
    } else if (membership.role === 'customer' && membership.customerId) {
      const orders = await sql.query("select reference,status,requested_delivery from public.orders where company_id=$1::uuid and customer_id=$2::uuid order by created_at desc limit 8", [companyId, membership.customerId]);
      voiceContext = { ownRecentOrders: orders };
    }
  } catch {
    voiceContext = { note: 'بعضی داده‌های نقش فعلی برای این مکالمه خوانده نشدند. درباره آن‌ها حدس نزن.' };
  }

  const canProposeOperationalTasks = ['owner', 'admin', 'staff'].includes(membership.role) &&
    await userHasModulePermission(c, user.id, companyId, 'agents', 'can_create') &&
    await userHasModulePermission(c, user.id, companyId, 'operational-tasks', 'can_create');
  const instructions = [
    'تو دستیار صوتی عملیاتی مدار هستی و با فارسی روان، طبیعی و کوتاه صحبت می‌کنی.',
    'ابتدا پاسخ مستقیم بده؛ هنگام توضیح چند مرحله، جمله‌ها را کوتاه و قابل شنیدن نگه دار.',
    'از اطلاعات زمینه فقط برای همین مجموعه و همین نقش استفاده کن. عدد، وضعیت، شخص یا رویداد نساز و زمان داده‌ها را در صورت نیاز توضیح بده.',
    canProposeOperationalTasks
      ? 'وقتی کاربر صریحاً درخواست ساخت یک وظیفه عملیاتی را دارد و عنوان و نتیجه مورد انتظار روشن است، می‌توانی ابزار propose_operational_task را فقط برای ایجاد پیش‌نویس پیشنهاد استفاده کنی. اگر اطلاعات اصلی مبهم است ابتدا سؤال بپرس. ابزار صرفاً پیشنهاد می‌سازد و وظیفه واقعی را ایجاد نمی‌کند. پس از نتیجه ابزار صریحاً بگو پیشنهاد برای بررسی در مرکز ایجنت‌ها آماده است و کاربر باید آن را جداگانه تأیید کند.'
      : 'در این نشست ابزار تغییر داده‌ها فعال نیست. هیچ وظیفه یا تغییر عملیاتی را اجراشده معرفی نکن. فقط درباره اطلاعات مجاز و موجود پاسخ بده.',
    'هیچ پرداخت، انتقال وجه، تغییر مالی، ارسال بیرونی یا عملیات برگشت‌ناپذیری را انجام نده. اطلاعات تماس خصوصی و رازها را افشا نکن. اگر اطلاعات لازم وجود ندارد، واضح بگو.',
    'نقش فعلی: ' + membership.role + '. زمان سرور: ' + new Date().toISOString() + '.',
    'داده‌های مجاز و محدود همین مجموعه: ' + JSON.stringify(voiceContext),
  ].join(' ');
  const voiceTools = canProposeOperationalTasks ? [{
    type: 'function',
    name: 'propose_operational_task',
    description: 'Create a reviewable, inert proposal for one operational task. Never execute the task, payments, or external actions. Use only after the user explicitly requests creating a task and the title and expected outcome are clear.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title in Persian, 2 to 180 characters.' },
        instructions: { type: 'string', description: 'Task instructions and expected outcome in Persian, up to 3000 characters.' },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'critical'] },
        dueAt: { type: 'string', description: 'Optional ISO 8601 date-time with timezone; omit it if the date or timezone is unclear.' },
      },
      required: ['title', 'instructions', 'priority'],
      additionalProperties: false,
    },
  }] : [];

  const safetyDigest = await crypto.subtle.digest('SHA-256', encoder.encode('medar-realtime-safety-v1:' + user.id));
  const safetyIdentifier = Array.from(new Uint8Array(safetyDigest), byte => byte.toString(16).padStart(2, '0')).join('');
  const sessionConfig = {
    type: 'realtime',
    model: 'gpt-realtime-2.1',
    instructions,
    audio: {
      input: {
        transcription: { model: 'gpt-4o-mini-transcribe', language: 'fa' },
        turn_detection: { type: 'semantic_vad' },
      },
      output: { voice: 'marin' },
    },
    ...(voiceTools.length ? { tools: voiceTools, tool_choice: 'auto' } : {}),
  };
  const form = new FormData();
  form.set('sdp', sdp);
  form.set('session', JSON.stringify(sessionConfig));
  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'OpenAI-Safety-Identifier': safetyIdentifier },
      body: form,
    });
    const answer = await upstream.text();
    if (!upstream.ok || !answer.startsWith('v=0')) {
      console.warn('Medar realtime voice session initialization failed with status', upstream.status);
      return c.json({
        message: upstream.status === 401 || upstream.status === 403
          ? 'دسترسی API برای مکالمه realtime تأیید نشد؛ کلید و دسترسی مدل را بررسی کن.'
          : upstream.status === 429
            ? 'سرویس صوتی به سقف درخواست رسیده است؛ کمی بعد دوباره تلاش کن.'
            : 'ارتباط realtime با سرویس صوتی برقرار نشد؛ اتصال و دسترسی مدل OpenAI را بررسی کن.',
      }, upstream.status === 429 ? 429 : 502);
    }
    await sql.query(
      'insert into public.medar_ai_usage_log(company_id,user_id,provider,model,input_chars) values($1::uuid,$2::uuid,$3,$4,$5)',
      [companyId, user.id, 'openai', 'gpt-realtime-2.1', sdp.length],
    );
    return c.body(answer, 200, { 'Content-Type': 'application/sdp', 'Cache-Control': 'no-store' });
  } catch {
    return c.json({ message: 'اتصال realtime قطع شد؛ مجوز میکروفون، شبکه و تنظیمات OpenAI را بررسی کن.' }, 502);
  }
});

app.post('/api/ai/chat', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'پیام دستیار معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  const role = membership.role;
  if (!(await userHasModulePermission(c, user.id, companyId, 'agents', 'can_read'))) {
    return c.json({ message: 'برای استفاده از دستیار هوشمند مجوز مشاهده نداری.' }, 403);
  }
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 12) return c.json({ message: 'گفتگو باید بین ۱ تا ۱۲ پیام آخر را داشته باشد.' }, 422);
  const messages: AiChatMessage[] = [];
  let inputChars = 0;
  for (const raw of body.messages) {
    if (!raw || typeof raw !== 'object') return c.json({ message: 'ساختار پیام معتبر نیست.' }, 422);
    const item = raw as Record<string, unknown>;
    if ((item.role !== 'user' && item.role !== 'assistant') || typeof item.content !== 'string' || item.content.length < 1 || item.content.length > 6000) {
      return c.json({ message: 'هر پیام باید متن معتبر با حداکثر ۶۰۰۰ نویسه داشته باشد.' }, 422);
    }
    inputChars += item.content.length;
    messages.push({ role: item.role, content: item.content });
  }
  const attachmentRaw = body.attachment && typeof body.attachment === 'object' ? body.attachment as Record<string, unknown> : null;
  let providerAttachment: AiAttachmentPayload | null = null;
  if (attachmentRaw) {
    const attachmentText = typeof attachmentRaw.text === 'string' ? attachmentRaw.text : '';
    const attachmentName = typeof attachmentRaw.name === 'string' ? attachmentRaw.name.replace(/[\r\n\\/]/g, '_').slice(0, 160) : 'attached-file';
    if (attachmentText.length > 24000) return c.json({ message: 'متن فایل بیش از حد مجاز است.' }, 413);
    inputChars += attachmentText.length;
    if (inputChars > 32000) return c.json({ message: 'حجم پیام و فایل پیوست بیش از حد مجاز است.' }, 413);
    if (attachmentText) {
      const last = messages[messages.length - 1];
      if (last?.role !== 'user') return c.json({ message: 'فایل باید همراه با پیام کاربر ارسال شود.' }, 422);
      last.content += '\n\nمحتوای فایل ' + attachmentName + ':\n' + attachmentText;
    }
    const base64 = typeof attachmentRaw.base64 === 'string' ? attachmentRaw.base64 : '';
    if (!attachmentText && !base64) return c.json({ message: 'محتوای فایل پیوست خالی است.' }, 422);
    if (base64) {
      const mimeType = typeof attachmentRaw.mimeType === 'string' ? attachmentRaw.mimeType : '';
      const allowedMimeTypes = new Set([
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/rtf',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ]);
      if (!allowedMimeTypes.has(mimeType)) return c.json({ message: 'نوع فایل باینری پشتیبانی نمی‌شود.' }, 415);
      if (base64.length > 8388608 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        return c.json({ message: 'فایل کدگذاری معتبر ندارد یا بیش از ۶ مگابایت است.' }, 413);
      }
      providerAttachment = { name: attachmentName, mimeType, base64 };
    }
  } else if (inputChars > 32000) return c.json({ message: 'حجم گفتگو بیش از حد مجاز است.' }, 413);
  if (messages[messages.length - 1]?.role !== 'user') return c.json({ message: 'آخرین پیام باید پیام کاربر باشد.' }, 422);
  const sql = sqlFor(c);
  const limits = await sql.query([
    "select (select count(*)::int from public.medar_ai_usage_log where user_id=$1::uuid and created_at>now()-interval '1 minute') as minute_count,",
    "(select count(*)::int from public.medar_ai_usage_log where user_id=$1::uuid and created_at>now()-interval '1 day') as day_count",
  ].join(' '), [user.id]);
  const limit = limits[0] as { minute_count: number; day_count: number } | undefined;
  if (Number(limit?.minute_count ?? 0) >= 8 || Number(limit?.day_count ?? 0) >= 120) return c.json({ message: 'سقف درخواست دستیار در بازه فعلی پر شده است. کمی بعد دوباره تلاش کن.' }, 429);
  const configurations = await sql.query('select provider,model,encrypted_api_key from public.medar_ai_provider_configs where company_id=$1::uuid and is_default=true limit 1', [companyId]);
  const config = configurations[0] as { provider: string; model: string; encrypted_api_key: string } | undefined;
  if (!config) return c.json({ message: 'هنوز پرووایدر هوش مصنوعی برای این مجموعه فعال نشده است.' }, 409);
  const provider = aiProvider(config.provider);
  if (!provider) return c.json({ message: 'پرووایدر ذخیره‌شده پشتیبانی نمی‌شود.' }, 503);
  if (providerAttachment && provider === 'deepseek') {
    return c.json({ message: 'این پرووایدر در مسیر فعلی فایل باینری را نمی‌خواند؛ برای PDF/Office، OpenAI، Gemini یا Claude را تنظیم کن.' }, 415);
  }
  if (providerAttachment && provider !== 'openai' && providerAttachment.mimeType !== 'application/pdf') {
    return c.json({ message: 'فایل‌های Office در این نسخه فقط با OpenAI پشتیبانی می‌شوند؛ برای Gemini یا Claude فایل را به PDF تبدیل کن.' }, 415);
  }
  let providerKey: string;
  try { providerKey = await decryptAiKey(c, config.encrypted_api_key); }
  catch { return c.json({ message: 'رمزگشایی کلید پرووایدر ناموفق بود؛ کلید را دوباره در تنظیمات ذخیره کن.' }, 503); }
  let context: Record<string, unknown> = {};
  let recentTasks: unknown[] = [];
  let recentIncidents: unknown[] = [];
  try {
    if (role === 'owner' || role === 'admin' || role === 'staff') {
      const aggregate = await sql.query([
        'select',
        '(select count(*)::int from public.orders where company_id=$1::uuid) as orders_total,',
        "(select count(*)::int from public.orders where company_id=$1::uuid and requested_delivery<current_date and status not in ('delivered','cancelled')) as late_orders,",
        '(select count(*)::int from public.customers where company_id=$1::uuid and active=true) as active_customers,',
        '(select count(*)::int from public.suppliers where company_id=$1::uuid and active=true) as active_suppliers,',
        "(select count(*)::int from public.shipments where company_id=$1::uuid and stage not in ('delivered','returned','failed')) as open_shipments,",
        "(select count(*)::int from public.operational_tasks where company_id=$1::uuid and status not in ('approved','cancelled')) as active_tasks,",
        "(select count(*)::int from public.operational_tasks where company_id=$1::uuid and due_at<now() and status not in ('approved','cancelled')) as overdue_tasks,",
        "(select count(*)::int from public.operational_incidents where company_id=$1::uuid and status not in ('resolved','closed','cancelled')) as open_incidents,",
        '(select count(*)::int from public.farm_sites where company_id=$1::uuid and active=true and latitude is not null and longitude is not null) as mapped_sites',
      ].join(' '), [companyId]);
      context = aggregate[0] as Record<string, unknown> || {};
      recentTasks = await sql.query([
        'select title,status,priority,due_at as due from public.operational_tasks',
        "where company_id=$1::uuid and status not in ('approved','cancelled')",
        'order by due_at asc nulls last limit 5',
      ].join(' '), [companyId]).catch(() => []);
      recentIncidents = await sql.query([
        'select title,severity,status from public.operational_incidents',
        "where company_id=$1::uuid and status not in ('resolved','closed','cancelled')",
        'order by created_at desc limit 4',
      ].join(' '), [companyId]).catch(() => []);
      if (role === 'owner' || role === 'admin') {
        const financeAndOperations = await sql.query([
          'select',
          "(select count(*)::int from public.invoices where company_id=$1::uuid and status in ('issued','partially_paid','overdue')) as open_invoices,",
          "(select coalesce(sum(amount-paid_amount),0)::numeric(18,0) from public.invoices where company_id=$1::uuid and status in ('issued','partially_paid','overdue')) as accounts_receivable,",
          "(select count(*)::int from public.invoices where company_id=$1::uuid and due_date<current_date and status in ('issued','partially_paid','overdue')) as overdue_invoices,",
          "(select count(*)::int from public.settlements where company_id=$1::uuid and status in ('pending','approved')) as outstanding_supplier_settlements,",
          "(select coalesce(sum(amount),0)::numeric(18,0) from public.settlements where company_id=$1::uuid and status in ('pending','approved')) as outstanding_supplier_settlement_amount,",
          "(select count(*)::int from public.settlements where company_id=$1::uuid and due_date<current_date and status in ('pending','approved')) as overdue_supplier_settlements,",
          "(select count(*)::int from public.purchase_orders where company_id=$1::uuid and status in ('draft','approved','partially_received')) as open_purchase_orders,",
          "(select count(*)::int from public.purchase_orders where company_id=$1::uuid and expected_delivery<current_date and status in ('approved','partially_received')) as overdue_purchase_orders,",
          "(select count(*)::int from public.production_batches where company_id=$1::uuid and status not in ('completed','cancelled','rejected')) as active_production_batches,",
          "(select count(*)::int from public.inventory_movements where company_id=$1::uuid and occurred_at>now()-interval '30 days') as inventory_movements_30d,",
          "(select count(*)::int from public.inventory_movements where company_id=$1::uuid and movement_type='waste_out' and occurred_at>now()-interval '30 days') as waste_events_30d",
        ].join(' '), [companyId]);
        Object.assign(context, financeAndOperations[0] as Record<string, unknown> || {});
        const [purchaseOrders, invoices, production, inventoryByProduct] = await Promise.all([
          sql.query([
            'select po.reference,po.status,po.expected_delivery as due,s.name as supplier',
            'from public.purchase_orders po join public.suppliers s on s.company_id=po.company_id and s.id=po.supplier_id',
            "where po.company_id=$1::uuid and po.status in ('draft','approved','partially_received')",
            'order by po.expected_delivery asc nulls last limit 5',
          ].join(' '), [companyId]).catch(() => []),
          sql.query([
            'select reference,status,amount,paid_amount,due_date from public.invoices',
            "where company_id=$1::uuid and status in ('issued','partially_paid','overdue')",
            'order by due_date asc nulls last limit 5',
          ].join(' '), [companyId]).catch(() => []),
          sql.query([
            'select batch_code,production_kind,status,planned_quantity,produced_quantity,unit,expected_on,quality_status',
            'from public.production_batches where company_id=$1::uuid',
            "and status not in ('completed','cancelled','rejected')",
            'order by expected_on asc nulls last limit 5',
          ].join(' '), [companyId]).catch(() => []),
          sql.query([
            'select p.name,p.sku,p.unit,coalesce(sum(case',
            "when im.movement_type in ('purchase_in','adjustment_in','return_in') then im.quantity",
            "when im.movement_type in ('sale_out','adjustment_out','waste_out') then -im.quantity else 0 end),0) as available_quantity",
            'from public.products p left join public.inventory_movements im',
            'on im.company_id=p.company_id and im.product_id=p.id',
            'where p.company_id=$1::uuid and p.active=true',
            'group by p.id,p.name,p.sku,p.unit order by available_quantity asc,p.name limit 8',
          ].join(' '), [companyId]).catch(() => []),
        ]);
        Object.assign(context, {
          upcomingPurchaseOrders: purchaseOrders,
          unpaidInvoices: invoices,
          activeProduction: production,
          stockByProduct: inventoryByProduct,
        });
      }
    } else if (role === 'supplier' && membership.supplierId) {
      const scoped = await sql.query([
        'select',
        "(select count(*)::int from public.operational_tasks where company_id=$1::uuid and assignee_supplier_id=$2::uuid and status not in ('approved','cancelled')) as assigned_tasks,",
        "(select count(*)::int from public.operational_tasks where company_id=$1::uuid and assignee_supplier_id=$2::uuid and due_at<now() and status not in ('approved','cancelled')) as overdue_tasks,",
        "(select count(*)::int from public.capacity_commitments where company_id=$1::uuid and supplier_id=$2::uuid and status in ('confirmed','committed') and period_end>=current_date) as active_capacity_commitments,",
        "(select count(*)::int from public.settlements where company_id=$1::uuid and supplier_id=$2::uuid and status in ('pending','approved')) as own_open_settlements,",
        "(select coalesce(sum(amount),0)::numeric(18,0) from public.settlements where company_id=$1::uuid and supplier_id=$2::uuid and status in ('pending','approved')) as own_settlement_amount,",
        "(select count(*)::int from public.settlements where company_id=$1::uuid and supplier_id=$2::uuid and due_date<current_date and status in ('pending','approved')) as own_overdue_settlements",
      ].join(' '), [companyId, membership.supplierId]);
      context = scoped[0] as Record<string, unknown> || {};
      recentTasks = await sql.query([
        'select title,status,priority,due_at as due from public.operational_tasks',
        "where company_id=$1::uuid and assignee_supplier_id=$2::uuid and status not in ('approved','cancelled')",
        'order by due_at asc nulls last limit 8',
      ].join(' '), [companyId, membership.supplierId]).catch(() => []);
    } else if (role === 'driver') {
      const scoped = await sql.query([
        'select',
        "(select count(*)::int from public.shipments where company_id=$1::uuid and driver_user_id=$2::uuid and stage not in ('delivered','returned','failed')) as assigned_open_shipments,",
        "(select count(*)::int from public.shipments where company_id=$1::uuid and driver_user_id=$2::uuid and stage='failed') as assigned_failed_shipments",
      ].join(' '), [companyId, user.id]);
      context = scoped[0] as Record<string, unknown> || {};
      recentTasks = await sql.query([
        'select s.stage,s.planned_departure,s.departed_at,s.delivered_at,o.reference as order_reference',
        'from public.shipments s join public.orders o on o.company_id=s.company_id and o.id=s.order_id',
        'where s.company_id=$1::uuid and s.driver_user_id=$2::uuid',
        'order by s.planned_departure asc nulls last limit 8',
      ].join(' '), [companyId, user.id]).catch(() => []);
    } else if (role === 'customer' && membership.customerId) {
      const scoped = await sql.query([
        'select',
        '(select count(*)::int from public.orders where company_id=$1::uuid and customer_id=$2::uuid) as own_orders,',
        "(select count(*)::int from public.orders where company_id=$1::uuid and customer_id=$2::uuid and requested_delivery<current_date and status not in ('delivered','cancelled')) as own_late_orders,",
        "(select count(*)::int from public.invoices where company_id=$1::uuid and customer_id=$2::uuid and status in ('issued','partially_paid','overdue')) as own_open_invoices,",
        "(select coalesce(sum(amount-paid_amount),0)::numeric(18,0) from public.invoices where company_id=$1::uuid and customer_id=$2::uuid and status in ('issued','partially_paid','overdue')) as own_receivables",
      ].join(' '), [companyId, membership.customerId]);
      context = scoped[0] as Record<string, unknown> || {};
      recentTasks = await sql.query([
        'select reference,status,requested_delivery as delivery_due from public.orders',
        'where company_id=$1::uuid and customer_id=$2::uuid order by created_at desc limit 8',
      ].join(' '), [companyId, membership.customerId]).catch(() => []);
    } else {
      context = { note: 'شناسه‌ی مرتبط برای خواندن جزئیات این نقش تعریف نشده است؛ اطلاعات عمومی محدود است.' };
    }
  } catch {
    context = { note: 'برخی شاخص‌های مجاز در دسترس نیستند؛ فقط درباره داده موجود نتیجه‌گیری کن.' };
  }
  const systemPrompt = 'تو دستیار عملیاتی مدار هستی. فقط براساس داده‌ی خلاصه‌ی ارائه‌شده و متن کاربر نتیجه بگیر؛ عدد، مشتری، رویداد یا واقعیت ساختگی نساز. اگر داده ناقص است صریح بگو. پیشنهادها را به اقدام‌های اولویت‌دار، مسئول پیشنهادی و موعد تقسیم کن. عملیات مالی، تغییر سفارش، ارسال پیام به افراد یا هر تغییری را خودت اجرا نکن و برای چنین اقداماتی تأیید انسانی لازم بدان. اطلاعات حساس شخصی را بازگو نکن. زبان پاسخ فارسی و واضح باشد. نقش کاربر: ' + role + '. فقط درباره سوابق و شاخص‌های موجود در بخش زمینه پاسخ بده. مبلغ‌ها را بدون نسبت‌دادن واحد پولیِ ثبت‌نشده بیان کن. موجودی محصولات با واحدهای متفاوت را با هم جمع نکن و فقط تراز هر محصول را براساس واحد همان محصول گزارش بده. اگر پرسش نیاز به داده‌ای دارد که در زمینه موجود نیست، صریح بگو این داده به دستیار ارائه نشده است. زمینه خلاصه و محدود همین مجموعه (بدون شماره تلفن و اطلاعات هویتی مخاطبین): ' + JSON.stringify({ metrics: context, activeTasks: recentTasks, openIncidents: recentIncidents });
  try {
    await sql.query('insert into public.medar_ai_usage_log(company_id,user_id,provider,model,input_chars) values($1::uuid,$2::uuid,$3,$4,$5)', [companyId, user.id, provider, config.model, inputChars]);
    await sql.query("delete from public.medar_ai_usage_log where created_at<now()-interval '90 days'").catch(() => []);
    const content = await requestAiProvider(provider, String(config.model), providerKey, messages, systemPrompt, providerAttachment);
    return c.json({ content, provider, model: config.model });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'پاسخ‌گویی هوش مصنوعی انجام نشد.';
    return c.json({ message }, 502);
  }
});


app.post('/api/contacts/classify', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'درخواست تحلیل مخاطبین معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (membership.role !== 'owner' && membership.role !== 'admin') return c.json({ message: 'فقط مالک یا مدیر می‌تواند مخاطبین را با هوش مصنوعی تحلیل کند.' }, 403);
  if (!Array.isArray(body.contacts) || body.contacts.length < 1 || body.contacts.length > 40) {
    return c.json({ message: 'هر درخواست تحلیل باید بین ۱ تا ۴۰ مخاطب داشته باشد.' }, 422);
  }
  // Only non-sensitive business context is sent to the model. Never include phones,
  // emails, street addresses, IDs, or existing customer/supplier records.
  const contactCount = body.contacts.length;
  const contacts: Array<{ index: number; name: string; organization: string; city: string; notes: string; tags: string[]; hintedKind: string }> = [];
  let inputChars = 0;
  for (let index = 0; index < body.contacts.length; index++) {
    const raw = body.contacts[index];
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const pick = (key: string, max: number) => typeof item[key] === 'string' ? item[key].trim().slice(0, max) : '';
    const name = pick('name', 160);
    if (name.length < 2) continue;
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim().slice(0, 40)).filter(Boolean).slice(0, 8)
      : [];
    const record = {
      index,
      name,
      organization: pick('organization', 160),
      city: pick('city', 80),
      notes: pick('notes', 300),
      tags,
      hintedKind: item.kindDetected === true && item.kind === 'customers' ? 'customer' : item.kindDetected === true && item.kind === 'suppliers' ? 'supplier' : '',
    };
    inputChars += JSON.stringify(record).length;
    contacts.push(record);
  }
  if (!contacts.length) return c.json({ message: 'برای تحلیل، مخاطب قابل خواندنی پیدا نشد.' }, 422);
  if (inputChars > 22000) return c.json({ message: 'حجم اطلاعات برای یک درخواست زیاد است؛ مخاطبین را در دسته‌های کوچک‌تر تحلیل کن.' }, 413);
  const sql = sqlFor(c);
  const limits = await sql.query([
    "select (select count(*)::int from public.medar_ai_usage_log where user_id=$1::uuid and created_at>now()-interval '1 minute') as minute_count,",
    "(select count(*)::int from public.medar_ai_usage_log where user_id=$1::uuid and created_at>now()-interval '1 day') as day_count",
  ].join(' '), [user.id]);
  const limit = limits[0] as { minute_count: number; day_count: number } | undefined;
  if (Number(limit?.minute_count ?? 0) >= 8 || Number(limit?.day_count ?? 0) >= 120) {
    return c.json({ message: 'سقف درخواست دستیار در بازه فعلی پر شده است. کمی بعد دوباره تلاش کن.' }, 429);
  }
  const rows = await sql.query(
    'select provider,model,encrypted_api_key from public.medar_ai_provider_configs where company_id=$1::uuid and is_default=true limit 1',
    [companyId],
  );
  const config = rows[0] as { provider: string; model: string; encrypted_api_key: string } | undefined;
  if (!config) return c.json({ message: 'برای تحلیل مخاطبین، مالک یا مدیر باید یک پرووایدر هوش مصنوعی فعال کند.' }, 409);
  const provider = aiProvider(config.provider);
  if (!provider) return c.json({ message: 'پرووایدر ذخیره‌شده پشتیبانی نمی‌شود.' }, 503);
  let apiKey: string;
  try { apiKey = await decryptAiKey(c, config.encrypted_api_key); }
  catch { return c.json({ message: 'رمزگشایی کلید پرووایدر ناموفق بود؛ کلید را دوباره در تنظیمات ذخیره کن.' }, 503); }
  const systemPrompt = [
    'تو دستیار مدیریت ارتباطات کسب‌وکار مدار هستی.',
    'دسته هر مخاطب را فقط با شواهد صریح موجود تعیین کن؛ از روی اسم به تنهایی حدس نزن.',
    'customer فقط وقتی انتخاب شود که توضیحات/برچسب/سازمان شواهد روشنی از خریدار، مشتری، فروشگاه یا خریدار سازمانی بدهند.',
    'supplier فقط وقتی انتخاب شود که شواهد روشنی از تأمین‌کننده، تولیدکننده، مزرعه، عمده‌فروش یا عرضه‌کننده وجود داشته باشد.',
    'اگر شواهد کافی نیست kind را unknown و confidence را حداکثر 0.55 قرار بده. شماره تلفن، ایمیل و نشانی به تو داده نشده است.',
    'حداکثر سه برچسب کوتاه فارسی پیشنهاد بده. هیچ عملیات یا تغییری را اجرا نکن؛ فقط نتیجه پیشنهادی بده.',
    'فقط JSON معتبر بدون markdown و دقیقاً با این ساختار برگردان: {"results":[{"index":0,"kind":"customers|suppliers|unknown","confidence":0.0,"reason":"کوتاه و فارسی","tags":["برچسب"]}]}',
  ].join(' ');
  try {
    const message = JSON.stringify({ contacts });
    await sql.query(
      'insert into public.medar_ai_usage_log(company_id,user_id,provider,model,input_chars) values($1::uuid,$2::uuid,$3,$4,$5)',
      [companyId, user.id, provider, config.model, inputChars],
    );
    const responseText = await requestAiProvider(provider, config.model, apiKey, [{ role: 'user', content: message }], systemPrompt, null);
    const rawResponse = responseText.trim();
    const jsonStart = rawResponse.indexOf('{');
    const jsonEnd = rawResponse.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) throw new Error('AI classification response was not JSON');
    const parsed = JSON.parse(rawResponse.slice(jsonStart, jsonEnd + 1)) as { results?: unknown };
    if (!Array.isArray(parsed.results)) throw new Error('AI classification response did not include results');
    const sanitized = parsed.results.flatMap(raw => {
      if (!raw || typeof raw !== 'object') return [];
      const item = raw as Record<string, unknown>;
      const index = Number(item.index);
      if (!Number.isInteger(index) || index < 0 || index >= contactCount) return [];
      const kind = item.kind === 'customers' || item.kind === 'suppliers' ? item.kind : 'unknown';
      const confidence = Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0;
      const reason = typeof item.reason === 'string' ? item.reason.replace(/[\\r\\n]/g, ' ').trim().slice(0, 180) : '';
      const tags = Array.isArray(item.tags)
        ? item.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim().replace(/[\\r\\n,;]/g, '').slice(0, 40)).filter(Boolean).slice(0, 3)
        : [];
      return [{ index, kind, confidence, reason, tags }];
    });
    if (!sanitized.length) throw new Error('AI classification response contained no valid result rows');
    return c.json({ results: sanitized, analyzed: contacts.length, provider, model: config.model });
  } catch {
    return c.json({ message: 'تحلیل هوشمند دسته‌بندی کامل نشد؛ فایل و تنظیمات مدل را بررسی کن. اطلاعات مخاطبین ذخیره یا تغییر داده نشد.' }, 502);
  }
});

app.post('/api/contacts/import', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'داده واردسازی معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  const defaultKind = body.kind === 'customers' || body.kind === 'suppliers' ? body.kind : null;
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (membership.role !== 'owner' && membership.role !== 'admin') return c.json({ message: 'فقط مالک یا مدیر می‌تواند مخاطبین مجموعه را وارد کند.' }, 403);
  if (!Array.isArray(body.contacts) || body.contacts.length < 1 || body.contacts.length > 1000) return c.json({ message: 'تعداد مخاطبین باید بین ۱ تا ۱۰۰۰ باشد.' }, 422);
  type ImportKind = 'customers' | 'suppliers';
  type ContactRecord = { name: string; phone: string; city: string; address: string; email: string; organization: string; notes: string; tags: string[]; kind: ImportKind };
  const contacts: ContactRecord[] = [];
  const seenNames = new Set<string>();
  const seenPhones = new Set<string>();
  for (const raw of body.contacts) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim().replace(/\\s+/g, ' ') : '';
    const phone = typeof item.phone === 'string' ? item.phone.trim().replace(/[۰-۹٠-٩]/g, digit => {
      const code = digit.charCodeAt(0);
      return String(code - (code >= 0x06f0 && code <= 0x06f9 ? 0x06f0 : 0x0660));
    }).slice(0, 40) : '';
    const city = typeof item.city === 'string' ? item.city.trim().slice(0, 100) : '';
    const address = typeof item.address === 'string' ? item.address.trim().slice(0, 500) : '';
    const email = typeof item.email === 'string' ? item.email.trim().slice(0, 254) : '';
    const organization = typeof item.organization === 'string' ? item.organization.trim().replace(/\\s+/g, ' ').slice(0, 160) : '';
    const notes = typeof item.notes === 'string' ? item.notes.trim().slice(0, 2000) : '';
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim().replace(/[\\r\\n,;]/g, '').slice(0, 40)).filter(Boolean).slice(0, 12)
      : [];
    const kind = item.kind === 'customers' || item.kind === 'suppliers' ? item.kind : defaultKind;
    if (!kind || name.length < 2 || name.length > 160) continue;
    if (email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) continue;
    const category = kind + ':';
    const nameKey = category + name.toLocaleLowerCase('fa-IR');
    const phoneNumber = phone.replace(/\\D/g, '');
    const phoneKey = phoneNumber ? category + phoneNumber : '';
    if (seenNames.has(nameKey) || (phoneKey && seenPhones.has(phoneKey))) continue;
    seenNames.add(nameKey);
    if (phoneKey) seenPhones.add(phoneKey);
    contacts.push({ name, phone, city, address, email, organization, notes, tags, kind });
  }
  if (!contacts.length) return c.json({ message: 'مخاطب معتبر با دسته‌ی مقصد مشخص برای واردسازی باقی نمانده است.' }, 422);
  const sql = sqlFor(c);
  const byKind: Record<ImportKind, { imported: number; updated: number }> = {
    customers: { imported: 0, updated: 0 },
    suppliers: { imported: 0, updated: 0 },
  };
  for (const kind of ['customers', 'suppliers'] as const) {
    const categorized = contacts.filter(contact => contact.kind === kind);
    for (let start = 0; start < categorized.length; start += 100) {
      const batch = categorized.slice(start, start + 100);
      const params: unknown[] = [];
      const values: string[] = [];
      batch.forEach(item => {
        const offset = params.length;
        params.push(companyId, item.name, item.phone || null, item.city || null, item.address || null,
          item.email || null, item.organization || null, item.notes || null, JSON.stringify(item.tags), 'phone_import');
        values.push('($' + (offset+1) + '::uuid,$' + (offset+2) + ',$' + (offset+3) + ',$' + (offset+4) + ',$' + (offset+5) +
          ',$' + (offset+6) + ',$' + (offset+7) + ',$' + (offset+8) + ',ARRAY(SELECT jsonb_array_elements_text($' + (offset+9) + '::jsonb)),$' + (offset+10) + ')');
      });
      const query = kind === 'customers'
        ? "insert into public.customers(company_id,name,phone,city,address,email,organization_name,contact_notes,contact_tags,contact_source) values " + values.join(',') +
          " on conflict(company_id,name) do update set phone=coalesce(nullif(excluded.phone,''),customers.phone),city=coalesce(nullif(excluded.city,''),customers.city),address=coalesce(nullif(excluded.address,''),customers.address),email=coalesce(nullif(excluded.email,''),customers.email),organization_name=coalesce(nullif(excluded.organization_name,''),customers.organization_name),contact_notes=coalesce(nullif(excluded.contact_notes,''),customers.contact_notes),contact_tags=case when cardinality(excluded.contact_tags)>0 then excluded.contact_tags else customers.contact_tags end,contact_source='phone_import',updated_at=now() returning (xmax=0) as inserted"
        : "insert into public.suppliers(company_id,name,phone,city,address,email,organization_name,contact_notes,contact_tags,contact_source) values " + values.join(',') +
          " on conflict(company_id,name) do update set phone=coalesce(nullif(excluded.phone,''),suppliers.phone),city=coalesce(nullif(excluded.city,''),suppliers.city),address=coalesce(nullif(excluded.address,''),suppliers.address),email=coalesce(nullif(excluded.email,''),suppliers.email),organization_name=coalesce(nullif(excluded.organization_name,''),suppliers.organization_name),contact_notes=coalesce(nullif(excluded.contact_notes,''),suppliers.contact_notes),contact_tags=case when cardinality(excluded.contact_tags)>0 then excluded.contact_tags else suppliers.contact_tags end,contact_source='phone_import',updated_at=now() returning (xmax=0) as inserted";
      const rows = await sql.query(query, params) as Array<{ inserted: boolean }>;
      for (const row of rows) if (row.inserted) byKind[kind].imported++; else byKind[kind].updated++;
    }
  }
  const imported = byKind.customers.imported + byKind.suppliers.imported;
  const updated = byKind.customers.updated + byKind.suppliers.updated;
  return c.json({ imported, updated, skipped: Number(body.contacts.length) - contacts.length, byKind });
});


app.post('/api/auth/signup', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'اطلاعات ثبت‌نام معتبر نیست.' }, 400);
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username) return c.json({ message: 'نام کاربری باید ۳ تا ۳۲ نویسه باشد و با نقطه یا خط تیره شروع یا تمام نشود.' }, 422);
  if (password.length < 8 || password.length > 128) return c.json({ message: 'رمز عبور باید بین ۸ تا ۱۲۸ نویسه باشد.' }, 422);
  const signupIp = c.req.header('cf-connecting-ip') ?? 'unknown';
  // A new key avoids stale counters created when successful registrations were counted as failures.
  const signupBucket = await sha256('signup-ip-v2:' + signupIp);
  if (await isRateLimited(c, [signupBucket])) return c.json({ message: 'تلاش‌های ثبت‌نام از این اتصال بیش از حد است؛ ۱۵ دقیقه دیگر دوباره امتحان کن.' }, 429);

  const sql = sqlFor(c);
  try {
    const conflicts = await sql.query(
      "select id from public.medar_users where coalesce(username_normalized,lower(username))=$1 limit 1",
      [username],
    );
    if (conflicts.length) {
      await recordSignupFailure(c, signupBucket);
      return c.json({ message: 'این نام کاربری قبلاً ثبت شده است.' }, 409);
    }
    const passwordHash = await hashPassword(password);
    const result = await sql.query(CREATE_OWNER_WORKSPACE_SQL, [username, passwordHash]);
    const created = result[0] as (Record<string, unknown> & { id: string; companyId: string }) | undefined;
    if (!created) {
      await recordSignupFailure(c, signupBucket);
      return c.json({ message: 'ساخت حساب و فضای کاری انجام نشد. دوباره تلاش کن.' }, 500);
    }
    await createSession(c, created.id);
    const memberships = await getMemberships(c, created.id);
    await sql.query("delete from public.medar_rate_limits where key_hash=$1", [signupBucket]);
    return c.json({ user: safeUser(created), companyId: created.companyId, memberships }, 201);
  } catch (error) {
    const databaseError = error as { code?: string; constraint?: string };
    if (databaseError.code === '23505') {
      await recordSignupFailure(c, signupBucket);
      return c.json({ message: 'این نام کاربری قبلاً ثبت شده است.' }, 409);
    }
    await recordSignupFailure(c, signupBucket);
    throw error;
  }
});

app.post('/api/auth/signup-with-invite', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'اطلاعات ثبت‌نام معتبر نیست.' }, 400);
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode.trim().toLowerCase() : '';
  if (!username) return c.json({ message: 'نام کاربری باید ۳ تا ۳۲ نویسه باشد و با نقطه یا خط تیره شروع یا تمام نشود.' }, 422);
  if (password.length < 8 || password.length > 128) return c.json({ message: 'رمز عبور باید بین ۸ تا ۱۲۸ نویسه باشد.' }, 422);
  if (!/^[a-f0-9]{64}$/.test(inviteCode)) return c.json({ message: 'برای پیوستن به مجموعه، کد دعوت معتبر ۶۴ نویسه‌ای وارد کن.' }, 422);

  const signupIp = c.req.header('cf-connecting-ip') ?? 'unknown';
  const signupBucket = await sha256('signup-ip-v2:' + signupIp);
  if (await isRateLimited(c, [signupBucket])) return c.json({ message: 'تلاش‌های ثبت‌نام از این اتصال بیش از حد است؛ ۱۵ دقیقه دیگر دوباره امتحان کن.' }, 429);

  const sql = sqlFor(c);
  try {
    const passwordHash = await hashPassword(password);
    const tokenHash = await sha256(inviteCode);
    // Consume the invitation and create the account + membership in one statement.
    // A duplicate username or invalid invite rolls back the whole statement, including uses++.
    const result = await sql.query(
      "with invite as (" +
        "update public.company_invites set uses=uses+1,updated_at=now() " +
        "where token_hash=$3 and revoked_at is null and expires_at>now() and uses<max_uses " +
        "returning company_id,role,customer_id,supplier_id" +
      "), new_user as (" +
        "insert into public.medar_users(username,display_name,password_hash,requested_role,account_status) " +
        "select $1,$1,$2,i.role,'active' from invite i " +
        "returning id,username,username_normalized,display_name" +
      "), new_profile as (" +
        "insert into public.profiles(id,full_name,phone) select id,display_name,null from new_user " +
        "on conflict(id) do update set full_name=excluded.full_name returning id" +
      "), new_membership as (" +
        "insert into public.memberships(company_id,user_id,role,active,created_by,customer_id,supplier_id) " +
        "select i.company_id,u.id,i.role,true,u.id,i.customer_id,i.supplier_id from invite i cross join new_user u " +
        "returning id,company_id,role" +
      ") select u.id,u.username_normalized as username,null::text as phone,u.display_name as full_name," +
      "m.company_id as \"companyId\" from new_user u cross join new_membership m",
      [username, passwordHash, tokenHash],
    );
    const created = result[0] as (Record<string, unknown> & { id: string; companyId: string }) | undefined;
    if (!created) {
      await recordSignupFailure(c, signupBucket);
      return c.json({ message: 'کد دعوت نامعتبر، منقضی یا مصرف‌شده است.' }, 422);
    }
    await createSession(c, created.id);
    const memberships = await getMemberships(c, created.id);
    await sql.query("delete from public.medar_rate_limits where key_hash=$1", [signupBucket]);
    return c.json({ user: safeUser(created), companyId: created.companyId, memberships }, 201);
  } catch (error) {
    const databaseError = error as { code?: string; constraint?: string };
    if (databaseError.code === '23505') {
      await recordSignupFailure(c, signupBucket);
      return c.json({ message: 'این نام کاربری قبلاً ثبت شده است.' }, 409);
    }
    await recordSignupFailure(c, signupBucket);
    throw error;
  }
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'اطلاعات ورود معتبر نیست.' }, 400);
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password || password.length > 128) return c.json({ message: 'نام کاربری یا رمز عبور نادرست است.' }, 401);
  const keys = await rateLimitKeys(c, username);
  if (await isRateLimited(c, keys)) return c.json({ message: 'تلاش‌های ورود بیش از حد است. ۱۵ دقیقه دیگر دوباره امتحان کن.' }, 429);
  const sql = sqlFor(c);
  const rows = await sql.query(
    "select id,username,username_normalized,phone_e164,display_name,password_hash,account_status " +
    "from public.medar_users where coalesce(username_normalized,lower(username))=$1 limit 1",
    [username],
  );
  const account = rows[0] as (Record<string, unknown> & { id: string; password_hash: string; account_status: string }) | undefined;
  // Verify a fixed dummy hash for unknown accounts so missing usernames follow the same PBKDF2 path.
  const passwordMatches = await verifyPassword(password, account?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!account || !passwordMatches) {
    await recordFailedLogin(c, keys);
    return c.json({ message: 'نام کاربری یا رمز عبور نادرست است.' }, 401);
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
    insert into public.company_invites(company_id, role, token_hash, created_by, expires_at, customer_id, supplier_id, max_uses)
    values (${companyId}, ${role}::public.app_role, ${tokenHash}, ${user.id}, now() + interval '7 days', ${customerId}, ${supplierId}, 1)
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


app.get('/api/workspace/my-module-permissions', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const sql = sqlFor(c);
  const memberships = await sql.query(
    "select m.id::text as membership_id,m.role::text as role,p.module_key,p.inherit_role_defaults,p.can_read " +
    "from public.memberships m left join public.medar_membership_module_permissions p " +
    "on p.membership_id=m.id and p.company_id=m.company_id " +
    "where m.user_id=$1::uuid and m.company_id=$2::uuid and m.active=true",
    [user.id, companyId],
  ) as Array<{ membership_id: string; role: string; module_key: string | null; inherit_role_defaults: boolean | null; can_read: boolean | null }>;
  if (!memberships.length) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  const uniqueMemberships = Array.from(new Map(memberships.map(row => [row.membership_id, row])).values());
  const permissions: Record<string, boolean> = {};
  for (const module of MODULE_PERMISSION_CATALOG) {
    permissions[module.key] = uniqueMemberships.some(row => row.role === 'owner' || row.role === 'admin') ||
      uniqueMemberships.length > 0 && uniqueMemberships.every(member => {
        if (member.role === 'owner' || member.role === 'admin') return true;
        const policy = memberships.find(row => row.membership_id === member.membership_id && row.module_key === module.key);
        // Read is inherited by default, but an explicit denial on any delegated membership wins.
        return !policy || policy.inherit_role_defaults === true || policy.inherit_role_defaults === null || policy.can_read === true;
      });
  }
  return c.json({ companyId, permissions });
});

app.get('/api/workspace/members/:membershipId/permissions', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  const membershipId = c.req.param('membershipId');
  if (!COMPANY_ID_RE.test(companyId) || !COMPANY_ID_RE.test(membershipId)) {
    return c.json({ message: 'شناسه مجموعه یا عضویت معتبر نیست.' }, 422);
  }
  const sql = sqlFor(c);
  const actorRows = await sql.query(
    "select role::text as role from public.memberships where user_id=$1::uuid and company_id=$2::uuid and active=true limit 1",
    [user.id, companyId],
  );
  const actorRole = (actorRows[0] as { role: string } | undefined)?.role;
  if (!actorRole || !['owner','admin'].includes(actorRole)) {
    return c.json({ message: 'فقط مالک یا مدیر می‌تواند مجوزهای اعضا را مدیریت کند.' }, 403);
  }
  const targets = await sql.query(
    "select id::text as membership_id,role::text as role,active from public.memberships where id=$1::uuid and company_id=$2::uuid limit 1",
    [membershipId, companyId],
  );
  const target = targets[0] as { membership_id: string; role: string; active: boolean } | undefined;
  if (!target || !target.active) return c.json({ message: 'عضویت فعال در این مجموعه پیدا نشد.' }, 404);
  if (target.role === 'owner' || target.role === 'admin') {
    return c.json({ message: 'مجوزهای مالک و مدیر از این صفحه قابل محدودکردن نیستند.' }, 403);
  }
  const rows = await sql.query(
    'select membership_id::text,module_key,inherit_role_defaults,can_read,can_create,can_update,can_delete,can_approve from public.medar_membership_module_permissions where company_id=$1::uuid and membership_id=$2::uuid',
    [companyId, membershipId],
  ) as ModulePermissionRow[];
  const byKey = new Map(rows.map(row => [row.module_key, row]));
  const modules = MODULE_PERMISSION_CATALOG.map(module => {
    const saved = byKey.get(module.key);
    const configured = Boolean(saved && !saved.inherit_role_defaults);
    return {
      key: module.key,
      label: module.label,
      configured,
      can_read: configured ? saved!.can_read : true,
      can_create: configured ? saved!.can_create : true,
      can_update: configured ? saved!.can_update : true,
      can_delete: configured ? saved!.can_delete : false,
      can_approve: configured ? saved!.can_approve : false,
    };
  });
  return c.json({ companyId, membership: { id: target.membership_id, role: target.role }, modules });
});

app.post('/api/workspace/members/:membershipId/permissions', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'درخواست مجوزها معتبر نیست.' }, 400);
  const actualCompanyId = typeof body.companyId === 'string' ? body.companyId : '';
  const membershipId = c.req.param('membershipId');
  if (!COMPANY_ID_RE.test(actualCompanyId) || !COMPANY_ID_RE.test(membershipId)) {
    return c.json({ message: 'شناسه مجموعه یا عضویت معتبر نیست.' }, 422);
  }
  if (!Array.isArray(body.modules) || body.modules.length !== MODULE_PERMISSION_CATALOG.length) {
    return c.json({ message: 'همه ماژول‌ها باید در درخواست مجوز حضور داشته باشند.' }, 422);
  }
  const catalogKeys = new Set(MODULE_PERMISSION_CATALOG.map(module => module.key));
  const seen = new Set<string>();
  const modules: Array<{ key: string; configured: boolean; can_read: boolean; can_create: boolean; can_update: boolean; can_delete: boolean; can_approve: boolean }> = [];
  for (const item of body.modules) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return c.json({ message: 'ساختار یک مجوز معتبر نیست.' }, 422);
    const raw = item as Record<string, unknown>;
    const key = typeof raw.key === 'string' ? raw.key : '';
    if (!catalogKeys.has(key as typeof MODULE_PERMISSION_CATALOG[number]['key']) || seen.has(key)) {
      return c.json({ message: 'کلید ماژول ناشناخته یا تکراری است.' }, 422);
    }
    const fields = ['configured','can_read','can_create','can_update','can_delete','can_approve'];
    if (fields.some(field => typeof raw[field] !== 'boolean')) {
      return c.json({ message: 'تمام مجوزها باید مقدار روشن یا خاموش داشته باشند.' }, 422);
    }
    seen.add(key);
    modules.push({
      key,
      configured: raw.configured as boolean,
      can_read: raw.can_read as boolean,
      can_create: raw.can_create as boolean,
      can_update: raw.can_update as boolean,
      can_delete: raw.can_delete as boolean,
      can_approve: raw.can_approve as boolean,
    });
  }
  const sql = sqlFor(c);
  const actorRows = await sql.query(
    "select role::text as role from public.memberships where user_id=$1::uuid and company_id=$2::uuid and active=true limit 1",
    [user.id, actualCompanyId],
  );
  const actorRole = (actorRows[0] as { role: string } | undefined)?.role;
  if (!actorRole || !['owner','admin'].includes(actorRole)) {
    return c.json({ message: 'فقط مالک یا مدیر می‌تواند مجوزهای اعضا را مدیریت کند.' }, 403);
  }
  const targets = await sql.query(
    "select id::text as membership_id,role::text as role,active from public.memberships where id=$1::uuid and company_id=$2::uuid limit 1",
    [membershipId, actualCompanyId],
  );
  const target = targets[0] as { membership_id: string; role: string; active: boolean } | undefined;
  if (!target || !target.active) return c.json({ message: 'عضویت فعال در این مجموعه پیدا نشد.' }, 404);
  if (target.role === 'owner' || target.role === 'admin' || (target.role === 'admin' && actorRole !== 'owner')) {
    return c.json({ message: 'مجوزهای مالک یا مدیر از این صفحه قابل محدودکردن نیستند.' }, 403);
  }
  const records = modules.map(module => ({
    module_key: module.key,
    configured: module.configured,
    can_read: module.can_read,
    can_create: module.can_create,
    can_update: module.can_update,
    can_delete: module.can_delete,
    can_approve: module.can_approve,
  }));
  await sql.query(
    'insert into public.medar_membership_module_permissions(company_id,membership_id,module_key,inherit_role_defaults,can_read,can_create,can_update,can_delete,can_approve,updated_by,updated_at) ' +
    'select $1::uuid,$2::uuid,x.module_key,not x.configured,x.can_read,x.can_create,x.can_update,x.can_delete,x.can_approve,$3::uuid,now() ' +
    'from jsonb_to_recordset($4::jsonb) as x(module_key text,configured boolean,can_read boolean,can_create boolean,can_update boolean,can_delete boolean,can_approve boolean) ' +
    'on conflict(company_id,membership_id,module_key) do update set inherit_role_defaults=excluded.inherit_role_defaults,can_read=excluded.can_read,can_create=excluded.can_create,can_update=excluded.can_update,can_delete=excluded.can_delete,can_approve=excluded.can_approve,updated_by=excluded.updated_by,updated_at=now()',
    [actualCompanyId, membershipId, user.id, JSON.stringify(records)],
  );
  await sql.query(
    "insert into public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata) values($1::uuid,'membership.permissions_updated','membership',$2::text,jsonb_build_object('company_id',$3::text,'configured_modules',$4::int))",
    [user.id, membershipId, actualCompanyId, modules.filter(module => module.configured).length],
  );
  return c.json({ ok: true, configuredModules: modules.filter(module => module.configured).length });
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


app.post('/api/workspace/members/reset-password', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const membershipId = typeof body?.membershipId === 'string' ? body.membershipId : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  if (!/^[0-9a-f-]{36}$/i.test(companyId) || !/^[0-9a-f-]{36}$/i.test(membershipId)) {
    return c.json({ message: 'شناسه مجموعه یا عضویت معتبر نیست.' }, 422);
  }
  if (newPassword.length < 12 || newPassword.length > 128) {
    return c.json({ message: 'گذرواژه موقت باید بین ۱۲ تا ۱۲۸ نویسه باشد.' }, 422);
  }
  const sql = sqlFor(c);
  const actors = await sql.query(
    "select role::text from public.memberships where user_id=$1::uuid and company_id=$2::uuid and active=true limit 1",
    [user.id, companyId],
  );
  const actorRole = (actors[0] as { role: string } | undefined)?.role;
  if (!actorRole || !['owner','admin'].includes(actorRole)) {
    return c.json({ message: 'فقط مالک یا مدیر می‌تواند گذرواژه عضو را بازنشانی کند.' }, 403);
  }
  const targets = await sql.query(
    "select m.user_id::text as user_id,m.role::text as role from public.memberships m " +
    "where m.id=$1::uuid and m.company_id=$2::uuid and m.active=true limit 1",
    [membershipId, companyId],
  );
  const target = targets[0] as { user_id: string; role: string } | undefined;
  if (!target) return c.json({ message: 'عضویت فعال در این مجموعه پیدا نشد.' }, 404);
  if (target.role === 'owner') return c.json({ message: 'گذرواژه مالک از این مسیر بازنشانی نمی‌شود.' }, 403);
  if (target.role === 'admin' && actorRole !== 'owner') {
    return c.json({ message: 'فقط مالک می‌تواند گذرواژه مدیر دیگری را بازنشانی کند.' }, 403);
  }
  const passwordHash = await hashPassword(newPassword);
  await sql.query("update public.medar_users set password_hash=$1,updated_at=now() where id=$2::uuid", [passwordHash, target.user_id]);
  await sql.query("update public.medar_sessions set revoked_at=now() where user_id=$1::uuid and revoked_at is null", [target.user_id]);
  await sql.query(
    "insert into public.medar_audit_log(actor_user_id,action,entity_type,entity_id,metadata) values($1::uuid,'member.password_reset','membership',$2::uuid,jsonb_build_object('company_id',$3::text,'target_user_id',$4::text))",
    [user.id, membershipId, companyId, target.user_id],
  );
  return c.json({ ok: true, message: 'گذرواژه بازنشانی شد و نشست‌های قبلی عضو بسته شدند.' });
});

const DATA_TABLES = new Set([
 'access_requests','customers','suppliers','products','price_agreements','orders','order_items','capacity_commitments','lots','quality_reviews',
 'shipments','delivery_evidence','invoices','settlements','notifications','audit_events','farm_sites','partnership_agreements',
 'purchase_orders','purchase_order_items',
 'flock_cycles','production_batches','daily_production_records','task_templates','operational_tasks','task_evidence',
 'operational_incidents','partner_financial_entries','partner_settlement_periods','shipment_locations','inventory_movements',
 'inventory_balances','company_goals'
]);
export function resolveRpcArguments(
  argNames: string[], argTypes: string[], defaultCount: number, suppliedArgs: Record<string, unknown>,
): { names: string[]; types: string[]; values: unknown[] } | null {
  const safeName = (value: string) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value);
  const safeType = (value: string) => /^[a-zA-Z_][a-zA-Z0-9_ .]*(?:\([0-9, ]+\))?(?:\[\])?$/.test(value);
  if (!Number.isInteger(defaultCount) || defaultCount < 0 || defaultCount > argNames.length || argNames.length !== argTypes.length ||
      argNames.some(name => !safeName(name)) || argTypes.some(type => !safeType(type))) return null;
  const requiredCount = argNames.length - defaultCount;
  const allowedCallerArgs = new Set(argNames.filter(name => name !== '_actor'));
  if (argNames.some((name, index) => index < requiredCount && !Object.prototype.hasOwnProperty.call(suppliedArgs, name)) ||
      Object.keys(suppliedArgs).some(name => name !== '_actor' && !allowedCallerArgs.has(name))) return null;
  const names = argNames.filter((name, index) => index < requiredCount || Object.prototype.hasOwnProperty.call(suppliedArgs, name));
  return { names, types: names.map(name => argTypes[argNames.indexOf(name)]), values: names.map(name => suppliedArgs[name] ?? null) };
}
const RPC_ALLOWLIST = new Set([
 'allocate_order_item','record_inventory_movement','record_quality_review','company_members','start_operational_task','submit_operational_task',
 'review_operational_task','create_partner_settlement_period','refresh_partner_settlement_period','approve_partner_settlement_period',
 'record_partner_settlement_payment','create_purchase_order','approve_purchase_order','receive_purchase_order'
]);
const RPC_TARGETS: Record<string, string> = {
  allocate_order_item: 'medar_allocate_order_item',
  record_inventory_movement: 'medar_record_inventory_movement',
  record_quality_review: 'medar_record_quality_review',
  start_operational_task: 'medar_start_operational_task',
  submit_operational_task: 'medar_submit_operational_task',
  review_operational_task: 'medar_review_operational_task',
  create_partner_settlement_period: 'medar_create_partner_settlement_period',
  refresh_partner_settlement_period: 'medar_refresh_partner_settlement_period',
  approve_partner_settlement_period: 'medar_approve_partner_settlement_period',
  record_partner_settlement_payment: 'medar_record_partner_settlement_payment',
  create_purchase_order: 'medar_create_purchase_order',
  approve_purchase_order: 'medar_approve_purchase_order',
  receive_purchase_order: 'medar_receive_purchase_order',
};
const RPC_MODULE_PERMISSIONS: Record<string, { module: string; capability: ModulePermissionCapability }> = {
  allocate_order_item: { module: 'orders', capability: 'can_update' },
  record_inventory_movement: { module: 'inventory', capability: 'can_create' },
  record_quality_review: { module: 'quality', capability: 'can_approve' },
  start_operational_task: { module: 'operational-tasks', capability: 'can_update' },
  submit_operational_task: { module: 'operational-tasks', capability: 'can_update' },
  review_operational_task: { module: 'operational-tasks', capability: 'can_approve' },
  create_partner_settlement_period: { module: 'partner-settlements', capability: 'can_create' },
  refresh_partner_settlement_period: { module: 'partner-settlements', capability: 'can_update' },
  approve_partner_settlement_period: { module: 'partner-settlements', capability: 'can_approve' },
  record_partner_settlement_payment: { module: 'partner-settlements', capability: 'can_approve' },
  create_purchase_order: { module: 'purchase-orders', capability: 'can_create' },
  approve_purchase_order: { module: 'purchase-orders', capability: 'can_approve' },
  receive_purchase_order: { module: 'purchase-orders', capability: 'can_update' },
};
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
 purchase_orders:{suppliers:{target:'suppliers',local:'supplier_id',foreign:'id'},purchase_order_items:{target:'purchase_order_items',local:'id',foreign:'purchase_order_id',many:true}},
 purchase_order_items:{products:{target:'products',local:'product_id',foreign:'id'}},
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
  const name=match[1],cfg=links[name],childModule=MODULE_KEY_BY_TABLE[cfg.target];
  const allowedCompanyIds=new Set<string>();
  if(childModule){
   const companyIds=Array.from(new Set(rows.map(row=>String(row.company_id??'')).filter(Boolean)));
   for(const companyId of companyIds){
    if(await userHasModulePermission(c,userId,companyId,childModule,'can_read'))allowedCompanyIds.add(companyId);
   }
  }
  const eligibleRows=childModule?rows.filter(row=>allowedCompanyIds.has(String(row.company_id??''))):rows;
  const ids=Array.from(new Set(eligibleRows.map(row=>row[cfg.local]).filter(v=>typeof v==='string'&&v.length)));
  if(!ids.length){for(const row of rows)row[name]=cfg.many?[]:null;continue;}
  const marks=ids.map((_,i)=>'$'+(i+1)).join(',');
  const child=await runForUser(c,userId,'select * from public.'+quoteSqlIdentifier(cfg.target)+' where '+quoteSqlIdentifier(cfg.foreign)+' in ('+marks+') limit 500',ids);
  const expanded=await expandRelations(c,userId,cfg.target,child,match[2],depth+1),group=new Map<string,Record<string,unknown>[]>();
  for(const row of expanded){const key=String(row[cfg.foreign]??''),arr=group.get(key)??[];arr.push(row);group.set(key,arr);}
  for(const row of rows){
   if(childModule&&!allowedCompanyIds.has(String(row.company_id??''))){row[name]=cfg.many?[]:null;continue;}
   const found=group.get(String(row[cfg.local]??''))??[];row[name]=cfg.many?found:(found[0]??null);
  }
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
 membership_id?: string;
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
const RPC_ONLY_TABLES = new Set(['inventory_movements','quality_reviews','partner_settlement_periods','inventory_balances','audit_events','notifications','purchase_orders','purchase_order_items']);
async function loadMembershipScopes(c:Ctx,userId:string):Promise<MembershipScope[]> {
 const sql=sqlFor(c);
 const rows=await sql.query(
  "select id::text as membership_id,company_id::text,role::text,customer_id::text,supplier_id::text from public.memberships where user_id=$1::uuid and active=true",
  [userId]
 );
 return rows as MembershipScope[];
}
export function buildMembershipScopeSql(table:string,columns:Set<string>,memberships:MembershipScope[],userId:string,params:unknown[],startAt=1):string {
 if(!columns.has('company_id')||!memberships.length)return 'false';
 const add=(value:unknown)=>{params.push(value);return '$'+(startAt+params.length-1);};
 const branches=memberships.map(m=>{
  const company=add(m.company_id),base='company_id = '+company;
  if(INTERNAL_ROLES.has(m.role))return '('+base+')';
  if(m.role==='customer'&&m.customer_id){
   if(table==='notifications'&&columns.has('user_id'))return '('+base+' and user_id = '+add(userId)+')';
   if(table==='customers')return '('+base+' and id = '+add(m.customer_id)+')';
   if(table==='orders'||table==='invoices'||table==='price_agreements')return '('+base+' and customer_id = '+add(m.customer_id)+')';
   if(table==='products')return '('+base+' and active = true)';
   const customerOrders='select o.id from public.orders o where o.company_id = '+company+' and o.customer_id = '+add(m.customer_id);
   if(table==='order_items')return '('+base+' and order_id in ('+customerOrders+'))';
   if(table==='shipments')return '('+base+' and order_id in ('+customerOrders+'))';
   const customerShipments='select s.id from public.shipments s join public.orders o on o.company_id=s.company_id and o.id=s.order_id where s.company_id = '+company+' and o.customer_id = '+add(m.customer_id);
   if(table==='delivery_evidence'||table==='shipment_locations')return '('+base+' and shipment_id in ('+customerShipments+'))';
   return '(false)';
  }
  if(m.role==='supplier'&&m.supplier_id){
   if(table==='notifications'&&columns.has('user_id'))return '('+base+' and user_id = '+add(userId)+')';
   if(table==='products')return '('+base+' and active = true)';
   if(table==='suppliers')return '('+base+' and id = '+add(m.supplier_id)+')';
   if(columns.has('supplier_id'))return '('+base+' and supplier_id = '+add(m.supplier_id)+')';
   if(table==='operational_tasks')return '('+base+' and assignee_supplier_id = '+add(m.supplier_id)+')';
   if(table==='task_evidence')return '('+base+' and task_id in (select t.id from public.operational_tasks t where t.company_id = '+company+' and t.assignee_supplier_id = '+add(m.supplier_id)+'))';
   if(table==='daily_production_records')return '('+base+' and batch_id in (select b.id from public.production_batches b where b.company_id = '+company+' and b.supplier_id = '+add(m.supplier_id)+'))';
   if(table==='flock_cycles')return '('+base+' and farm_site_id in (select f.id from public.farm_sites f where f.company_id = '+company+' and f.supplier_id = '+add(m.supplier_id)+'))';
   if(table==='operational_incidents')return '('+base+' and (reported_supplier_id = '+add(m.supplier_id)+' or batch_id in (select b.id from public.production_batches b where b.company_id = '+company+' and b.supplier_id = '+add(m.supplier_id)+')))'; 
   return '(false)';
  }
  if(m.role==='driver'){
   if(table==='notifications'&&columns.has('user_id'))return '('+base+' and user_id = '+add(userId)+')';
   if(table==='products')return '('+base+' and active = true)';
   if(table==='shipments')return '('+base+' and driver_user_id = '+add(userId)+')';
   if(table==='shipment_locations')return '('+base+' and driver_user_id = '+add(userId)+')';
   if(table==='delivery_evidence')return '('+base+' and shipment_id in (select s.id from public.shipments s where s.company_id = '+company+' and s.driver_user_id = '+add(userId)+'))';
   const assignedOrders='select s.order_id from public.shipments s where s.company_id = '+company+' and s.driver_user_id = '+add(userId);
   if(table==='orders')return '('+base+' and id in ('+assignedOrders+'))';
   if(table==='order_items')return '('+base+' and order_id in ('+assignedOrders+'))';
   if(table==='customers')return '('+base+' and id in (select o.customer_id from public.orders o where o.company_id = '+company+' and o.id in ('+assignedOrders+')))';
   return '(false)';
  }
  return '(false)';
 });
 return '('+branches.join(' or ')+')';
}
export function sanitizeExternalRows(table:string,rows:Record<string,unknown>[],memberships:MembershipScope[]):Record<string,unknown>[] {
 const redact=(input:Record<string,unknown>):Record<string,unknown>=>{
  const result={...input};
  const company=String(input.company_id??'');
  const roles=memberships.filter(m=>m.company_id===company).map(m=>m.role);
  if(!roles.some(role=>INTERNAL_ROLES.has(role))){
   if(roles.includes('driver')){
    for(const key of ['credit_limit','unit_price','amount','paid_amount','paid_at','paid_by','payment_reference','net_result','company_share_amount','partner_share_amount','balance_due_to_partner','balance_due_to_company','approved_shared_expenses','unpaid_approved_expenses','company_paid_shared_expenses','partner_paid_shared_expenses','recorded_cash_available','settled_amount','external_reference','calculation_snapshot'])delete result[key];
   }else if(roles.includes('customer')){
    for(const key of ['credit_limit','net_result','company_share_amount','partner_share_amount','balance_due_to_partner','balance_due_to_company','approved_shared_expenses','unpaid_approved_expenses','company_paid_shared_expenses','partner_paid_shared_expenses','recorded_cash_available','settled_amount','calculation_snapshot'])delete result[key];
   }
  }
  for(const [key,value] of Object.entries(result)){
   if(Array.isArray(value))result[key]=value.map(item=>item&&typeof item==='object'&&!Array.isArray(item)?redact(item as Record<string,unknown>):item);
   else if(value&&typeof value==='object')result[key]=redact(value as Record<string,unknown>);
  }
  return result;
 };
 return rows.map(redact);
}
function companyRole(memberships:MembershipScope[],companyId:string):MembershipScope|undefined {
 return memberships.find(m=>m.company_id===companyId);
}

const MODULE_PERMISSION_CATALOG = [
  { key: 'home', label: 'صفحه اصلی و کارهای روزانه' },
  { key: 'command', label: 'مرکز فرمان و گزارش‌ها' },
  { key: 'agents', label: 'دستیار و مرکز ایجنت‌ها' },
  { key: 'contacts', label: 'دفترچه مخاطبین و واردکردن مخاطب' },
  { key: 'customers', label: 'مشتریان و قراردادهای مشتری' },
  { key: 'suppliers', label: 'تأمین‌کنندگان و ظرفیت' },
  { key: 'orders', label: 'سفارش‌ها و اقلام سفارش' },
  { key: 'purchase-orders', label: 'خرید و سفارش خرید' },
  { key: 'products', label: 'محصولات و کاتالوگ' },
  { key: 'inventory', label: 'موجودی و گردش انبار' },
  { key: 'capacity', label: 'ظرفیت و تعهد تأمین' },
  { key: 'quality', label: 'کیفیت و کنترل محموله' },
  { key: 'shipments', label: 'حمل‌ونقل، رانندگان و مدارک' },
  { key: 'finance', label: 'امور مالی و تسویه‌ها' },
  { key: 'farm-sites', label: 'سایت‌ها و نقشه' },
  { key: 'flock-cycles', label: 'چرخه‌های کشت و پرورش' },
  { key: 'production-batches', label: 'دوره‌های تولید' },
  { key: 'daily-production', label: 'ثبت روزانهٔ تولید' },
  { key: 'operational-tasks', label: 'وظایف و شواهد کار' },
  { key: 'task-templates', label: 'الگوهای وظیفه' },
  { key: 'incidents', label: 'رخدادها و مغایرت‌ها' },
  { key: 'partnership-agreements', label: 'قراردادهای مشارکت' },
  { key: 'partner-finance', label: 'دفتر مالی شریک' },
  { key: 'partner-settlements', label: 'دوره‌ها و تسویهٔ شریک' },
  { key: 'goals', label: 'اهداف و برنامه' },
  { key: 'members', label: 'اعضا و دعوت‌ها' },
  { key: 'audit', label: 'تاریخچه و ممیزی' },
] as const;
type ModulePermissionCapability = 'can_read' | 'can_create' | 'can_update' | 'can_delete' | 'can_approve';
type UserModulePermissionRow = { role: string; inherit_role_defaults: boolean | null } & Partial<Record<ModulePermissionCapability, boolean | null>>;

/** Resolve one capability conservatively when a user has several active roles in one company. */
export function aggregateModulePermissionRows(rows: UserModulePermissionRow[], capability: ModulePermissionCapability): boolean {
  if (!rows.length) return false;
  // Owner/admin authority is explicit and intentionally not configurable through member overrides.
  if (rows.some(row => row.role === 'owner' || row.role === 'admin')) return true;
  const inheritedDefault = capability !== 'can_delete' && capability !== 'can_approve';
  // Deny wins across delegated memberships: a permissive or unconfigured membership cannot
  // override a restriction saved against another active membership for the same user/company.
  return rows.every(row => {
    if (row.inherit_role_defaults === null || row.inherit_role_defaults === true) return inheritedDefault;
    return row[capability] === true;
  });
}
type ModulePermissionRow = {
  membership_id: string;
  module_key: string;
  inherit_role_defaults: boolean;
  can_read: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_approve: boolean;
};
const MODULE_KEY_BY_TABLE: Record<string, string> = {
  access_requests: 'members', customers: 'customers', suppliers: 'suppliers', products: 'products',
  price_agreements: 'customers', orders: 'orders', order_items: 'orders',
  capacity_commitments: 'capacity', lots: 'inventory', quality_reviews: 'quality',
  shipments: 'shipments', shipment_locations: 'shipments', delivery_evidence: 'shipments',
  invoices: 'finance', settlements: 'finance', inventory_movements: 'inventory',
  inventory_balances: 'inventory', notifications: 'home', audit_events: 'audit',
  farm_sites: 'farm-sites', partnership_agreements: 'partnership-agreements',
  purchase_orders: 'purchase-orders', purchase_order_items: 'purchase-orders',
  flock_cycles: 'flock-cycles', production_batches: 'production-batches',
  daily_production_records: 'daily-production', task_templates: 'task-templates',
  operational_tasks: 'operational-tasks', task_evidence: 'operational-tasks',
  operational_incidents: 'incidents', partner_financial_entries: 'partner-finance',
  partner_settlement_periods: 'partner-settlements', company_goals: 'goals',
};

async function loadModulePermissionOverrides(
  c: Ctx,
  scopes: MembershipScope[],
  moduleKey: string,
): Promise<Map<string, ModulePermissionRow>> {
  const ids = scopes.map(scope => scope.membership_id).filter((id): id is string => Boolean(id));
  if (!ids.length) return new Map();
  const rows = await sqlFor(c).query(
    'select membership_id::text,module_key,inherit_role_defaults,can_read,can_create,can_update,can_delete,can_approve from public.medar_membership_module_permissions where membership_id=any($1::uuid[]) and module_key=$2',
    [ids, moduleKey],
  );
  return new Map((rows as ModulePermissionRow[]).map(row => [row.membership_id, row]));
}

export function scopeHasModulePermission(
  scope: MembershipScope,
  overrides: Map<string, ModulePermissionRow>,
  capability: ModulePermissionCapability,
): boolean {
  if (scope.role === 'owner' || scope.role === 'admin') return true;
  const override = scope.membership_id ? overrides.get(scope.membership_id) : undefined;
  if (!override || override.inherit_role_defaults) {
    // Match the permission editor's inherited defaults: read/create/update are inherited;
    // delete and approve require explicit grants for delegated roles.
    return capability !== 'can_delete' && capability !== 'can_approve';
  }
  return override[capability] === true;
}

async function userHasModulePermission(
  c: Ctx,
  userId: string,
  companyId: string,
  moduleKey: string,
  capability: ModulePermissionCapability,
): Promise<boolean> {
  const rows = await sqlFor(c).query(
    'select m.role::text as role,p.inherit_role_defaults,p.can_read,p.can_create,p.can_update,p.can_delete,p.can_approve from public.memberships m left join public.medar_membership_module_permissions p on p.membership_id=m.id and p.company_id=m.company_id and p.module_key=$3 where m.user_id=$1::uuid and m.company_id=$2::uuid and m.active=true',
    [userId, companyId, moduleKey],
  ) as UserModulePermissionRow[];
  return aggregateModulePermissionRows(rows, capability);
}

const UPDATE_PROTECTED_FIELDS:Record<string,Set<string>>={
 orders:new Set(['status','created_by']),
 shipments:new Set(['stage','departed_at','delivered_at','failure_reason','driver_user_id']),
 invoices:new Set(['status','paid_amount','paid_at','paid_by','payment_reference']),
 settlements:new Set(['status','paid_at','paid_by','payment_reference']),
 operational_tasks:new Set(['status','started_at','submitted_at','reviewed_at','reviewed_by','review_note','assigned_by']),
 production_batches:new Set(['status','farm_site_id','supplier_id','agreement_id','flock_cycle_id','product_id','produced_quantity','started_on','quality_status','completed_on','rejected_quantity']),
 partner_financial_entries:new Set(['status','submitted_at','approved_by','approved_at','posted_by','posted_at']),
 partner_settlement_periods:new Set(['status','approved_by','approved_at','settled_by','settled_at','calculation_snapshot','net_result','company_share_amount','partner_share_amount','balance_due_to_partner','balance_due_to_company']),
 inventory_movements:new Set(['company_id','product_id','movement_type','quantity','unit_cost'])
};
export const MEDAR_STATUS_TRANSITIONS: Record<string, Record<string, readonly string[]>> = {
  orders: {
    draft: ['submitted', 'cancelled'],
    submitted: ['confirmed', 'cancelled'],
    confirmed: ['allocated', 'cancelled'],
    allocated: ['in_fulfillment', 'cancelled'],
    in_fulfillment: ['dispatched', 'cancelled'],
    dispatched: ['delivered'],
  },
  shipments: {
    planned: ['loading', 'failed'],
    loading: ['in_transit', 'failed'],
    in_transit: ['arrived', 'failed'],
    arrived: ['delivered', 'returned', 'failed'],
  },
  invoices: {
    draft: ['issued', 'void'],
    issued: ['partially_paid', 'paid', 'overdue', 'void'],
    partially_paid: ['paid', 'overdue', 'void'],
    overdue: ['partially_paid', 'paid', 'void'],
  },
  settlements: {
    pending: ['approved', 'disputed'],
    approved: ['paid', 'disputed'],
    disputed: ['pending', 'approved'],
  },
  production_batches: {
    planned: ['active', 'cancelled'],
    active: ['submitted_for_review', 'on_hold', 'cancelled'],
    submitted_for_review: ['approved', 'on_hold', 'rejected'],
    approved: ['completed', 'on_hold'],
    on_hold: ['active', 'rejected', 'cancelled'],
    rejected: ['active', 'cancelled'],
  },
  partner_financial_entries: {
    draft: ['submitted', 'rejected'],
    submitted: ['approved', 'rejected'],
    approved: ['posted', 'rejected'],
    rejected: ['draft'],
  },
};
export function canTransitionMedarStatus(table: string, current: string, next: string): boolean {
  return (MEDAR_STATUS_TRANSITIONS[table]?.[current] ?? []).includes(next);
}

export function isProductionBatchSubmissionValid(producedQuantity: unknown, rejectedQuantity: unknown): boolean {
  const produced = Number(producedQuantity);
  const rejected = Number(rejectedQuantity ?? 0);
  return Number.isFinite(produced) && produced > 0 &&
    Number.isFinite(rejected) && rejected >= 0 && rejected <= produced;
}

export function isProductionBatchCompletionReady(
  qualityStatus: unknown,
  lotId: unknown,
  hasReleasedLotAndPassingReview: boolean,
): boolean {
  return qualityStatus === 'passed' &&
    typeof lotId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(lotId) &&
    hasReleasedLotAndPassingReview;
}

export function isPartnerFinancialEntryReadyToPost(
  entryType: unknown,
  paymentStatus: unknown,
  paidAmount: unknown,
  amount: unknown,
  externalReference: unknown,
): boolean {
  if (!['sale_collection','partner_advance','settlement_payment'].includes(String(entryType))) return true;
  const paid = Number(paidAmount);
  const total = Number(amount);
  return paymentStatus === 'paid' && Number.isFinite(total) && total > 0 &&
    Number.isFinite(paid) && paid === total &&
    typeof externalReference === 'string' && externalReference.trim().length > 0;
}

export function isSaleCollectionWithinInvoice(
  invoiceAmount: unknown,
  alreadyCollected: unknown,
  collectionAmount: unknown,
): boolean {
  const invoice = Number(invoiceAmount);
  const collected = Number(alreadyCollected ?? 0);
  const collection = Number(collectionAmount);
  return Number.isFinite(invoice) && invoice > 0 &&
    Number.isFinite(collected) && collected >= 0 &&
    Number.isFinite(collection) && collection > 0 &&
    collected + collection <= invoice;
}

export function isBankReconciliationDirectionCompatible(
  entityType: string,
  transactionDirection: string,
  targetDirection?: string | null,
): boolean {
  if (entityType === 'invoice') return transactionDirection === 'incoming';
  if (entityType === 'purchase_order' || entityType === 'settlement') return transactionDirection === 'outgoing';
  if (entityType === 'partner_financial_entry') {
    if (transactionDirection === 'incoming') return targetDirection === 'inflow_to_company' || targetDirection === 'partner_to_company';
    if (transactionDirection === 'outgoing') return targetDirection === 'outflow_from_company' || targetDirection === 'company_to_partner';
  }
  return false;
}

export function isBankTransactionCurrencyCompatible(accountCurrency: string, transactionCurrency: string): boolean {
  return /^[A-Z]{3}$/.test(accountCurrency) && accountCurrency === transactionCurrency;
}

export function isMaskedBankAccountValid(value: string): boolean {
  const asciiDigits = value.replace(/[۰-۹٠-٩]/g, digit => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 && code <= 0x06f9 ? code - 0x06f0 : code - 0x0660);
  }).replace(/\D/g, '');
  return value.length <= 40 && asciiDigits.length <= 4;
}

function applyInsertActorFields(table:string,row:Record<string,unknown>,columns:Set<string>,userId:string):Record<string,unknown> {
 const out={...row};
 for(const field of ['id','user_id','created_at','updated_at','deleted_at','created_by','updated_by','recorded_by','captured_by','uploaded_by','reported_by','submitted_by'])delete out[field];
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
  const moduleKey=MODULE_KEY_BY_TABLE[table];
  const moduleOverrides=moduleKey?await loadModulePermissionOverrides(c,scopes,moduleKey):new Map<string,ModulePermissionRow>();
  const hasPermission=(scope:MembershipScope,capability:ModulePermissionCapability)=>!moduleKey||scopeHasModulePermission(scope,moduleOverrides,capability);
  if(action==='select'){
   const readableScopes=scopes.filter(scope=>hasPermission(scope,'can_read'));
   const params:unknown[]=[];
   const filters=Array.isArray(body.filters)?body.filters as DataFilter[]:[];
   const where=buildFilterSql(filters,columns,params,1);
   const ors=Array.isArray(body.orFilters)?body.orFilters as DataFilter[]:[];
   const orWhere=buildFilterSql(ors,columns,params,1,'or');
   const scope=buildMembershipScopeSql(table,columns,readableScopes,user.id,params,1);
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
  const writeFilters=Array.isArray(body.filters)?body.filters as DataFilter[]:[];
  if(!writeFilters.length&&action!=='insert')return c.json({message:'برای ویرایش یا حذف باید فیلتر رکورد مشخص شود.'},422);
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
    if(!hasPermission(membership,'can_create'))return c.json({message:'برای ایجاد رکورد در این ماژول مجوز نداری.'},403);
    const row=applyInsertActorFields(table,original,columns,user.id);
    if(INTERNAL_ROLES.has(membership.role)){
     if(RPC_ONLY_TABLES.has(table))return c.json({message:'این رکورد باید از عملیات معتبر سمت سرور ثبت شود.'},403);
     if(table==='orders'){row.status='draft';row.created_by=user.id;}
     if(table==='shipments')row.stage='planned';
     if(table==='operational_tasks')row.status='pending';
     if(table==='partner_financial_entries'){row.status='draft';row.created_by=user.id;row.submitted_by=null;if(columns.has('submitted_at'))row.submitted_at=null;if(columns.has('approved_by'))row.approved_by=null;if(columns.has('approved_at'))row.approved_at=null;if(columns.has('posted_by'))row.posted_by=null;if(columns.has('posted_at'))row.posted_at=null;}
     if(table==='production_batches'){
      const siteId=typeof row.farm_site_id==='string'?row.farm_site_id:'';
      const supplierId=typeof row.supplier_id==='string'?row.supplier_id:null;
      const productId=typeof row.product_id==='string'?row.product_id:'';
      const agreementId=typeof row.agreement_id==='string'?row.agreement_id:null;
      const flockCycleId=typeof row.flock_cycle_id==='string'?row.flock_cycle_id:null;
      const validId=(value:unknown)=>value===null||(typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value));
      if(!/^[0-9a-f-]{36}$/i.test(siteId)||!supplierId||!validId(supplierId)||!validId(productId)||!validId(agreementId)||!validId(flockCycleId))return c.json({message:'برای بچ تولید، سایت فعال، تأمین‌کننده و محصول معتبر لازم است.'},422);
      const scopeRows=await runForUser(c,user.id,
       "select fs.id from public.farm_sites fs where fs.id=$1::uuid and fs.company_id=$2::uuid and fs.active=true and fs.supplier_id is not distinct from $3::uuid and exists (select 1 from public.products p where p.id=$6::uuid and p.company_id=$2::uuid) and ($4::uuid is null or exists (select 1 from public.partnership_agreements a where a.id=$4::uuid and a.company_id=$2::uuid and a.supplier_id is not distinct from $3::uuid and a.status='active')) and ($5::uuid is null or exists (select 1 from public.flock_cycles fc where fc.id=$5::uuid and fc.company_id=$2::uuid and fc.farm_site_id=fs.id))",
       [siteId,companyId,supplierId,agreementId,flockCycleId,productId]);
      if(!scopeRows.length)return c.json({message:'مزرعه، تأمین‌کننده، قرارداد و چرخهٔ انتخاب‌شده با هم سازگار نیستند.'},422);
      if(row.lot_id){
       const lotRows=await runForUser(c,user.id,
        'select id from public.lots where id=$1::uuid and company_id=$2::uuid and supplier_id is not distinct from $3::uuid and product_id is not distinct from $4::uuid',
        [row.lot_id,companyId,supplierId,row.product_id??null]);
       if(!lotRows.length)return c.json({message:'لات انتخاب‌شده با شرکت، تأمین‌کننده یا محصول بچ مطابقت ندارد.'},422);
      }
      row.status='planned';row.quality_status='not_inspected';row.produced_quantity=0;row.started_on=null;row.completed_on=null;row.rejected_quantity=0;row.created_by=user.id;
     }
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
     row.unit_price=Number(price.unit_price);
     delete row.supplier_id;delete row.lot_id;delete row.capacity_commitment_id;
     sanitized.push(row);continue;
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
   const keys=Array.from(new Set(sanitized.flatMap(row=>Object.keys(row).filter(key=>columns.has(key)&&!['id','password_hash','token_hash','user_id'].includes(key)))));
   if(!keys.length||sanitized.some(row=>Object.keys(row).some(key=>!columns.has(key))))return c.json({message:'یکی از فیلدهای رکورد غیرمجاز است.'},422);
   const insertParams:unknown[]=[];
   const tuples=sanitized.map(row=>'('+keys.map(key=>{insertParams.push(row[key]??null);return '$'+insertParams.length;}).join(',')+')');
   const inserted=await runForUser(c,user.id,'insert into '+tableName+' ('+keys.map(quoteSqlIdentifier).join(',')+') values '+tuples.join(',')+' returning *',insertParams);
   return c.json({data:sanitizeExternalRows(table,inserted,scopes),count:inserted.length,error:null},201);
  }
  const values = action === 'update' && body.values && typeof body.values === 'object' && !Array.isArray(body.values)
    ? body.values as Record<string, unknown>
    : null;
  const transitionField: Record<string, string> = {
    orders: 'status', shipments: 'stage', invoices: 'status', settlements: 'status',
    production_batches: 'status', partner_financial_entries: 'status',
  };
  const stateField = transitionField[table];
  const requestedState = stateField && values ? values[stateField] : undefined;
  const isTransition = action === 'update' && typeof requestedState === 'string';
  const transitionFields = new Set<string>();
  if (isTransition && stateField) transitionFields.add(stateField);
  if (isTransition && table === 'shipments' && requestedState === 'failed') transitionFields.add('failure_reason');
  if (isTransition && table === 'invoices' && ['partially_paid','paid'].includes(String(requestedState))) {
    transitionFields.add('payment_reference');
    if (requestedState === 'partially_paid') transitionFields.add('paid_amount');
  }
  if (isTransition && table === 'settlements' && requestedState === 'paid') transitionFields.add('payment_reference');
  if (isTransition && table === 'production_batches') {
    if (requestedState === 'active') transitionFields.add('started_on');
    if (['submitted_for_review','approved','rejected'].includes(String(requestedState))) {
      transitionFields.add('quality_status');
      transitionFields.add('rejected_quantity');
    }
    if (requestedState === 'rejected') transitionFields.add('manager_notes');
    if (requestedState === 'submitted_for_review') transitionFields.add('produced_quantity');
    if (requestedState === 'completed') {
      transitionFields.add('quality_status');
      transitionFields.add('completed_on');
      transitionFields.add('lot_id');
    }
  }

  const ordinaryProtected = (key: string) =>
    protectedKeys.has(key) ||
    (UPDATE_PROTECTED_FIELDS[table]?.has(key) === true && !transitionFields.has(key));
  if (action === 'update') {
    if (!values || !Object.keys(values).length || Object.keys(values).some(key => !columns.has(key))) {
      return c.json({ message: 'فیلدهای ویرایش نامعتبرند.' }, 422);
    }
    if (isTransition) {
      if (Object.keys(values).some(key => !transitionFields.has(key))) {
        return c.json({ message: 'در تغییر وضعیت فقط فیلدهای مجاز همان گردش‌کار قابل ارسال‌اند.' }, 422);
      }
    } else if (Object.keys(values).some(ordinaryProtected)) {
      return c.json({ message: 'فیلدهای ویرایش محافظت‌شده‌اند؛ از مسیر تأییدشده عملیات استفاده کن.' }, 422);
    }
  }

  const externalOrderSubmit = isTransition && table === 'orders' &&
    scopes.some(m => m.role === 'customer' && m.customer_id);
  const externalDriverUpdate = isTransition && table === 'shipments' &&
    scopes.some(m => m.role === 'driver');
  const approvalRequired = isTransition && (
    ['approved','paid'].includes(String(requestedState)) ||
    (table === 'partner_financial_entries' && ['posted','rejected'].includes(String(requestedState))) ||
    (table === 'production_batches' && ['rejected','completed'].includes(String(requestedState)))
  );
  const mutationCapability: ModulePermissionCapability = action === 'delete'
    ? 'can_delete'
    : (approvalRequired ? 'can_approve' : 'can_update');
  const permissionFilteredScopes = scopes.filter(scope => hasPermission(scope, mutationCapability));
  const mutationScopes = isTransition
    ? permissionFilteredScopes.filter(m => INTERNAL_ROLES.has(m.role) ||
        (externalOrderSubmit && m.role === 'customer') ||
        (externalDriverUpdate && m.role === 'driver'))
    : permissionFilteredScopes.filter(m => INTERNAL_ROLES.has(m.role));
  if (!mutationScopes.length) return c.json({ message: 'ویرایش یا حذف برای نقش فعلی مجاز نیست.' }, 403);

  const params: unknown[] = [];
  const mutationFilters = Array.isArray(body.filters) ? body.filters as DataFilter[] : [];
  const where = buildFilterSql(mutationFilters, columns, params, 1);
  const ors = Array.isArray(body.orFilters) ? body.orFilters as DataFilter[] : [];
  const orWhere = buildFilterSql(ors, columns, params, 1, 'or');
  const scope = buildMembershipScopeSql(table, columns, mutationScopes, user.id, params, 1);
  const condition = [scope, where, orWhere].filter(Boolean).map(part => '(' + part + ')').join(' and ');

  if ((action === 'update' || action === 'delete') && !isTransition &&
      (table === 'partner_financial_entries' || table === 'production_batches')) {
    const guardedRows = await runForUser(c, user.id,
      'select status from ' + tableName + ' where ' + condition + ' limit 501', params
    ) as Array<{ status: string }>;
    if (table === 'partner_financial_entries' && action === 'update' && guardedRows.some(row => row.status !== 'draft')) {
      return c.json({ message: 'سند مالی فقط در وضعیت پیش‌نویس قابل ویرایش است؛ برای اصلاح، آن را به پیش‌نویس برگردان یا سند تعدیلی ثبت کن.' }, 409);
    }
    if (table === 'partner_financial_entries' && action === 'delete' && guardedRows.some(row => !['draft','rejected'].includes(row.status))) {
      return c.json({ message: 'سند مالی ارسال‌شده یا ثبت‌شده قابل حذف نیست.' }, 409);
    }
    if (table === 'production_batches' && guardedRows.some(row => row.status === 'completed')) {
      return c.json({ message: 'بچ تولید تکمیل‌شده قابل ویرایش یا حذف نیست.' }, 409);
    }
  }

  if (action === 'update' && isTransition && stateField) {
    const currentRows = await runForUser(c, user.id,
      'select * from ' + tableName + ' where ' + condition + ' limit 501', params);
    if (!currentRows.length) return c.json({ message: 'رکورد در محدوده دسترسی فعلی پیدا نشد.' }, 404);
    if (currentRows.length !== 1) return c.json({ message: 'برای جلوگیری از تغییر وضعیت گروهی، هر بار فقط یک رکورد را تغییر بده.' }, 422);

    const current = currentRows[0];
    const currentState = String(current[stateField] ?? '');
    const nextState = String(requestedState);
    if (!canTransitionMedarStatus(table, currentState, nextState)) {
      return c.json({ message: 'این انتقال وضعیت با گردش‌کار فعلی مجاز نیست.' }, 422);
    }
    if (table === 'partner_financial_entries' && ['submitted','approved','posted'].includes(nextState)) {
      const supplierId = current.supplier_id;
      const agreementId = current.agreement_id;
      if (typeof supplierId !== 'string' || !/^[0-9a-f-]{36}$/i.test(supplierId) ||
          typeof agreementId !== 'string' || !/^[0-9a-f-]{36}$/i.test(agreementId)) {
        return c.json({ message: 'برای ثبت سند مالی، شریک و قرارداد معتبر لازم است.' }, 422);
      }
      const agreementRows = await runForUser(c, user.id,
        'select shared_expense_categories from public.partnership_agreements where id=$1::uuid and company_id=$2::uuid and supplier_id=$3::uuid limit 1',
        [agreementId, current.company_id, supplierId],
      ) as Array<{ shared_expense_categories?: unknown }>;
      if (!agreementRows.length) {
        return c.json({ message: 'قرارداد انتخاب‌شده به همین شریک و شرکت تعلق ندارد.' }, 422);
      }
      const sharedCategories = Array.isArray(agreementRows[0].shared_expense_categories)
        ? agreementRows[0].shared_expense_categories.map(String) : [];
      if (current.entry_type === 'expense' && current.is_shared_cost === true &&
          (typeof current.expense_category !== 'string' || !sharedCategories.includes(current.expense_category))) {
        return c.json({ message: 'این دسته هزینه در قرارداد به‌عنوان هزینهٔ مشترک مجاز نشده است.' }, 422);
      }
      if (current.entry_type === 'sale_collection') {
        const linkedId = current.linked_entry_id;
        if (typeof linkedId !== 'string' || !/^[0-9a-f-]{36}$/i.test(linkedId)) {
          return c.json({ message: 'دریافت فروش باید به یک فاکتور ثبت‌شده متصل باشد.' }, 422);
        }
        const invoiceRows = await runForUser(c, user.id,
          "select id, amount from public.partner_financial_entries where id=$1::uuid and company_id=$2::uuid and supplier_id=$3::uuid and agreement_id=$4::uuid and entry_type='sale_invoice' and status='posted' limit 1",
          [linkedId, current.company_id, supplierId, agreementId],
        ) as Array<{ id: string; amount: unknown }>;
        if (!invoiceRows.length) {
          return c.json({ message: 'فاکتور مرجع باید ثبت‌شده و متعلق به همین شریک و قرارداد باشد.' }, 422);
        }
        if (nextState === 'posted') {
          const collectedRows = await runForUser(c, user.id,
            "select coalesce(sum(amount),0)::text as collected from public.partner_financial_entries where company_id=$1::uuid and entry_type='sale_collection' and status='posted' and linked_entry_id=$2::uuid and id<>$3::uuid",
            [current.company_id, linkedId, current.id],
          ) as Array<{ collected: unknown }>;
          if (!isSaleCollectionWithinInvoice(invoiceRows[0].amount, collectedRows[0]?.collected ?? 0, current.amount)) {
            return c.json({ message: 'مجموع دریافت‌های ثبت‌شده نمی‌تواند از مبلغ فاکتور بیشتر شود.' }, 422);
          }
        }
      }
      if (current.entry_type === 'adjustment') {
        const linkedId = current.linked_entry_id;
        if (typeof linkedId !== 'string' || !/^[0-9a-f-]{36}$/i.test(linkedId) ||
            !['increase','decrease'].includes(String(current.adjustment_effect))) {
          return c.json({ message: 'سند تعدیلی باید به یک سند ثبت‌شده و اثر تعدیل مشخص متصل باشد.' }, 422);
        }
        const sourceRows = await runForUser(c, user.id,
          "select id from public.partner_financial_entries where id=$1::uuid and company_id=$2::uuid and supplier_id=$3::uuid and agreement_id=$4::uuid and status='posted' and entry_type<>'adjustment' limit 1",
          [linkedId, current.company_id, supplierId, agreementId],
        );
        if (!sourceRows.length) {
          return c.json({ message: 'سند تعدیلی باید به یک سند ثبت‌شده از همان شریک و قرارداد متصل باشد.' }, 422);
        }
      }
    }
    if (table === 'partner_financial_entries' && nextState === 'posted' &&
        !isPartnerFinancialEntryReadyToPost(current.entry_type,current.payment_status,current.paid_amount,current.amount,current.external_reference)) {
      return c.json({ message: 'ثبت نهایی این سند به مبلغ پرداخت‌شدهٔ کامل و مرجع رسید واقعی نیاز دارد.' }, 422);
    }
    if (table === 'production_batches' && nextState === 'submitted_for_review') {
      const produced = values?.produced_quantity ?? current.produced_quantity;
      const rejected = values?.rejected_quantity ?? current.rejected_quantity ?? 0;
      if (!isProductionBatchSubmissionValid(produced, rejected)) {
        return c.json({ message: 'برای ارسال بچ به بازبینی، مقدار تولید باید مثبت و مقدار مردودی در بازهٔ مجاز باشد.' }, 422);
      }
    }
    if (table === 'production_batches' && nextState === 'completed') {
      const lotId = typeof values?.lot_id === 'string' ? values.lot_id : current.lot_id;
      const qualityStatus = values?.quality_status ?? current.quality_status;
      if (qualityStatus !== 'passed' || typeof lotId !== 'string' || !/^[0-9a-f-]{36}$/i.test(lotId)) {
        return c.json({ message: 'تکمیل بچ فقط با کیفیت تأییدشده و شناسهٔ لات معتبر ممکن است.' }, 422);
      }
      const readyLots = await runForUser(c, user.id,
        "select l.id from public.lots l where l.id=$1::uuid and l.company_id=$2::uuid and l.status='released' and l.product_id is not distinct from $3::uuid and l.supplier_id is not distinct from $4::uuid and exists (select 1 from public.quality_reviews q where q.company_id=l.company_id and q.lot_id=l.id and q.result='pass') and exists (select 1 from public.farm_sites fs where fs.id=$5::uuid and fs.company_id=l.company_id and fs.supplier_id is not distinct from $4::uuid) and ($6::uuid is null or exists (select 1 from public.partnership_agreements a where a.id=$6::uuid and a.company_id=l.company_id and a.supplier_id is not distinct from $4::uuid)) and ($7::uuid is null or exists (select 1 from public.flock_cycles fc where fc.id=$7::uuid and fc.company_id=l.company_id and fc.farm_site_id=$5::uuid)) limit 1",
        [lotId, current.company_id, current.product_id, current.supplier_id, current.farm_site_id, current.agreement_id ?? null, current.flock_cycle_id ?? null],
      );
      if (!isProductionBatchCompletionReady(qualityStatus, lotId, readyLots.length > 0)) {
        return c.json({ message: 'برای تکمیل بچ، لات باید متعلق به همین شرکت/تأمین‌کننده/محصول، آزادشده و دارای بازبینی موفق باشد.' }, 422);
      }
    }
    const rowScopes = mutationScopes.filter(m => m.company_id === String(current.company_id));
    const rowHasInternalRole = rowScopes.some(m => INTERNAL_ROLES.has(m.role));
    if (table === 'orders' && !rowHasInternalRole) {
      if (!rowScopes.some(m => m.role === 'customer' && m.customer_id === String(current.customer_id)) ||
          currentState !== 'draft' || !['submitted', 'cancelled'].includes(nextState)) {
        return c.json({ message: 'مشتری فقط می‌تواند پیش‌نویس متعلق به خود را ارسال یا لغو کند.' }, 403);
      }
    }
    if (table === 'shipments' && !rowHasInternalRole) {
      if (!rowScopes.some(m => m.role === 'driver') ||
          !['loading', 'in_transit', 'arrived', 'delivered', 'failed'].includes(nextState)) {
        return c.json({ message: 'راننده فقط می‌تواند مرحله محموله تخصیص‌یافته را جلو ببرد.' }, 403);
      }
    }
    const safeValues: Record<string, unknown> = { [stateField]: nextState };
    if (table === 'orders' && nextState === 'submitted' && columns.has('updated_at')) safeValues.updated_at = new Date().toISOString();
    if (table === 'production_batches') {
      const today = new Date().toISOString().slice(0, 10);
      if (nextState === 'active') {
        safeValues.started_on = current.started_on || today;
        if (currentState === 'rejected') {
          safeValues.quality_status = 'not_inspected';
          safeValues.completed_on = null;
          safeValues.rejected_quantity = 0;
        }
      }
      if (nextState === 'submitted_for_review') {
        safeValues.quality_status = 'pending';
        safeValues.produced_quantity = Number(values?.produced_quantity ?? current.produced_quantity);
        safeValues.rejected_quantity = Number(values?.rejected_quantity ?? current.rejected_quantity ?? 0);
      }
      if (nextState === 'approved') {
        if (values?.quality_status !== undefined) safeValues.quality_status = values.quality_status;
        safeValues.rejected_quantity = Number(values?.rejected_quantity ?? current.rejected_quantity ?? 0);
      }
      if (nextState === 'rejected') {
        safeValues.quality_status = 'failed';
        safeValues.rejected_quantity = Number(values?.rejected_quantity ?? current.rejected_quantity ?? 0);
        if (typeof values?.manager_notes === 'string') safeValues.manager_notes = values.manager_notes;
      }
      if (nextState === 'completed') {
        safeValues.quality_status = 'passed';
        safeValues.completed_on = today;
        safeValues.lot_id = typeof values?.lot_id === 'string' ? values.lot_id : current.lot_id;
      }
      if (columns.has('updated_at')) safeValues.updated_at = new Date().toISOString();
    }
    if (table === 'partner_financial_entries') {
      const now = new Date().toISOString();
      if (nextState === 'submitted') {
        if (columns.has('submitted_at')) safeValues.submitted_at = now;
        if (columns.has('submitted_by')) safeValues.submitted_by = user.id;
      }
      if (nextState === 'approved') {
        if (columns.has('approved_at')) safeValues.approved_at = now;
        if (columns.has('approved_by')) safeValues.approved_by = user.id;
      }
      if (nextState === 'posted') {
        if (columns.has('posted_at')) safeValues.posted_at = now;
        if (columns.has('posted_by')) safeValues.posted_by = user.id;
      }
      if (nextState === 'draft') {
        for (const key of ['submitted_at','submitted_by','approved_at','approved_by','posted_at','posted_by']) {
          if (columns.has(key)) safeValues[key] = null;
        }
      }
      if (columns.has('updated_at')) safeValues.updated_at = now;
    }
    if (table === 'shipments') {
      if (nextState === 'failed') {
        const reason = typeof values?.failure_reason === 'string' ? values.failure_reason.trim() : '';
        if (reason.length < 3 || reason.length > 500) return c.json({ message: 'علت ناموفق بودن ارسال را با حداقل ۳ نویسه ثبت کن.' }, 422);
        safeValues.failure_reason = reason;
      }
      if (nextState === 'in_transit' && columns.has('departed_at')) safeValues.departed_at = new Date().toISOString();
      if (nextState === 'delivered' && columns.has('delivered_at')) safeValues.delivered_at = new Date().toISOString();
      if (columns.has('updated_at')) safeValues.updated_at = new Date().toISOString();
    }
    if (table === 'invoices') {
      if (nextState === 'issued' && columns.has('issued_at')) safeValues.issued_at = new Date().toISOString();
      if (nextState === 'partially_paid' || nextState === 'paid') {
        const reference = typeof values?.payment_reference === 'string' ? values.payment_reference.trim() : '';
        if (reference.length < 2 || reference.length > 120) return c.json({ message: 'مرجع پرداخت واقعی برای ثبت پرداخت فاکتور الزامی است.' }, 422);
        const total = Number(current.amount);
        const alreadyPaid = Number(current.paid_amount ?? 0);
        const requestedPaid = nextState === 'paid' ? total : Number(values?.paid_amount);
        if (!Number.isFinite(requestedPaid) || requestedPaid <= alreadyPaid || requestedPaid > total ||
            (nextState === 'partially_paid' && requestedPaid >= total)) {
          return c.json({ message: 'مبلغ پرداخت باید از پرداخت قبلی بیشتر و حداکثر برابر مبلغ فاکتور باشد؛ پرداخت جزئی نباید کل مبلغ را پوشش دهد.' }, 422);
        }
        safeValues.payment_reference = reference;
        safeValues.paid_amount = requestedPaid;
        safeValues.paid_at = new Date().toISOString();
        safeValues.paid_by = user.id;
      }
      if (nextState === 'overdue' && current.due_date && new Date(String(current.due_date)).getTime() >= Date.now()) {
        return c.json({ message: 'فاکتور پیش از سررسید قابل علامت‌گذاری به‌عنوان معوق نیست.' }, 422);
      }
    }
    if (table === 'settlements' && nextState === 'paid') {
      const reference = typeof values?.payment_reference === 'string' ? values.payment_reference.trim() : '';
      if (reference.length < 2 || reference.length > 120) return c.json({ message: 'مرجع پرداخت واقعی برای تسویه الزامی است.' }, 422);
      safeValues.payment_reference = reference;
      safeValues.paid_at = new Date().toISOString();
      safeValues.paid_by = user.id;
    }
    const updateParams: unknown[] = [];
    const setSql = Object.entries(safeValues).map(([key, value]) => {
      if (!columns.has(key)) throw new Error('فیلد گردش‌کار در جدول موجود نیست: ' + key);
      updateParams.push(value);
      return quoteSqlIdentifier(key) + ' = $' + updateParams.length;
    }).join(',');
    const isSaleCollectionPosting = table === 'partner_financial_entries' &&
      nextState === 'posted' && current.entry_type === 'sale_collection' &&
      typeof current.linked_entry_id === 'string';
    if (isSaleCollectionPosting) {
      const invoiceId = String(current.linked_entry_id);
      const txSql = sqlFor(c);
      const txParams: unknown[] = [...updateParams, String(current.id), currentState, String(current.company_id), invoiceId];
      const idParam = updateParams.length + 1;
      const stateParam = updateParams.length + 2;
      const companyParam = updateParams.length + 3;
      const invoiceParam = updateParams.length + 4;
      // Serialize postings for the same invoice. The aggregate is re-read in a
      // separate statement after acquiring the invoice row lock, so concurrent
      // collection requests cannot both spend the same remaining balance.
      const transactionResult = await txSql.transaction([
        txSql.query("select set_config('medar.user_id', $1, true)", [user.id]),
        txSql.query(
          "select id from public.partner_financial_entries where id=$1::uuid and company_id=$2::uuid and entry_type='sale_invoice' and status='posted' for update",
          [invoiceId, String(current.company_id)],
        ),
        txSql.query(
          'update public.partner_financial_entries as target set ' + setSql +
          ' where target.id = $' + idParam +
          ' and target.status = $' + stateParam +
          ' and target.company_id = $' + companyParam +
          " and target.entry_type = 'sale_collection' and target.linked_entry_id = $" + invoiceParam + '::uuid' +
          " and coalesce((select sum(col.amount) from public.partner_financial_entries col where col.company_id=target.company_id and col.entry_type='sale_collection' and col.status='posted' and col.linked_entry_id=target.linked_entry_id and col.id<>target.id),0) + target.amount <= " +
          "(select inv.amount from public.partner_financial_entries inv where inv.id=target.linked_entry_id and inv.company_id=target.company_id and inv.entry_type='sale_invoice' and inv.status='posted') returning target.*",
          txParams,
        ),
      ]);
      const updated = (transactionResult[2] ?? []) as Record<string, unknown>[];
      if (!updated.length) return c.json({ message: 'ماندهٔ فاکتور برای ثبت این دریافت کافی نیست یا وضعیت سند هم‌زمان تغییر کرده است؛ فهرست را تازه‌سازی کن.' }, 409);
      return c.json({ data: sanitizeExternalRows(table, updated, scopes), count: updated.length, error: null });
    }
    updateParams.push(String(current.id));
    const idParam = updateParams.length;
    updateParams.push(current[stateField]);
    const stateParam = updateParams.length;
    updateParams.push(String(current.company_id));
    const companyParam = updateParams.length;
    const updated = await runForUser(c, user.id,
      'update ' + tableName + ' set ' + setSql +
      ' where id = $' + idParam + ' and ' + quoteSqlIdentifier(stateField) + ' = $' + stateParam +
      ' and company_id = $' + companyParam + ' returning *',
      updateParams);
    if (!updated.length) return c.json({ message: 'وضعیت رکورد هم‌زمان تغییر کرده است؛ فهرست را تازه‌سازی کن.' }, 409);
    return c.json({ data: sanitizeExternalRows(table, updated, scopes), count: updated.length, error: null });
  }

  if (action === 'update') {
    const updateParams: unknown[] = [];
    const setSql = Object.entries(values ?? {}).map(([key, value]) => {
      updateParams.push(value ?? null);
      return quoteSqlIdentifier(key) + ' = $' + updateParams.length;
    }).join(',');
    const finalParams = [...updateParams, ...params];
    const adjusted = condition.replace(/\$(\d+)/g, (_match, n) => '$' + (Number(n) + updateParams.length));
    const updated = await runForUser(c, user.id,
      'update ' + tableName + ' set ' + setSql + ' where ' + adjusted + ' returning *',
      finalParams);
    return c.json({ data: sanitizeExternalRows(table, updated, mutationScopes), count: updated.length, error: null });
  }
  const deleted = await runForUser(c, user.id, 'delete from ' + tableName + ' where ' + condition + ' returning *', params);
  return c.json({ data: deleted, count: deleted.length, error: null }); }catch(error){
  const e=error as {code?:string};
  return c.json({message:e.code?'دسترسی یا اعتبارسنجی داده ناموفق بود.':(error instanceof Error?error.message:'درخواست داده ناموفق بود.')},400);
 }
});
app.post('/api/rpc/:name', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const requestedName = c.req.param('name');
  if (!RPC_ALLOWLIST.has(requestedName)) return c.json({ message: 'عملیات سرور مجاز نیست.' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const args = body?.args && typeof body.args === 'object' && !Array.isArray(body.args)
    ? body.args as Record<string, unknown>
    : {};
  const sql = sqlFor(c);
  try {
    if (requestedName === 'company_members') {
      const companyId = typeof args._company === 'string' ? args._company : '';
      if (!/^[0-9a-f-]{36}$/i.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
      const manager = await sql.query(
        "select role::text from public.memberships where user_id=$1::uuid and company_id=$2::uuid and active=true limit 1",
        [user.id, companyId],
      );
      const role = (manager[0] as { role: string } | undefined)?.role;
      if (!role || !['owner', 'admin', 'staff'].includes(role)) return c.json({ message: 'برای فهرست اعضای مجموعه دسترسی داخلی لازم است.' }, 403);
      if (!(await userHasModulePermission(c, user.id, companyId, 'members', 'can_read'))) return c.json({ message: 'برای مشاهده اعضای مجموعه مجوز نداری.' }, 403);
      const members = await sql.query(
        "select m.id as membership_id,m.company_id,m.user_id,coalesce(u.username_normalized,u.username) as username," +
        "u.phone_e164 as phone,u.display_name as full_name,m.role::text,m.customer_id,m.supplier_id,m.active,m.created_at " +
        "from public.memberships m join public.medar_users u on u.id=m.user_id " +
        "where m.company_id=$1::uuid order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,m.created_at",
        [companyId],
      );
      return c.json({ data: members, error: null });
    }

    const permission = RPC_MODULE_PERMISSIONS[requestedName];
    if (permission) {
      const companyValue = args._company ?? args.companyId ?? args.company_id ?? args._company_id;
      const companyId = typeof companyValue === 'string' ? companyValue : '';
      if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه برای این عملیات الزامی است.' }, 422);
      if (!(await userHasModulePermission(c, user.id, companyId, permission.module, permission.capability))) {
        return c.json({ message: 'مجوز لازم برای این عملیات در ماژول مربوطه وجود ندارد.' }, 403);
      }
    }
    const targetName = RPC_TARGETS[requestedName];
    const suppliedArgs: Record<string, unknown> = { ...args, _actor: user.id };
    if (requestedName === 'record_partner_settlement_payment' && suppliedArgs._paid_at == null) {
      suppliedArgs._paid_at = new Date().toISOString();
    }
    const metadata = await sql.query(
      "select p.proargnames[1:p.pronargs] as arg_names," +
      "array(select format_type(t,null) from unnest(p.proargtypes::oid[]) with ordinality as a(t,ord) order by ord) as arg_types," +
      "p.pronargdefaults as default_count " +
      "from pg_proc p join pg_namespace n on n.oid=p.pronamespace " +
      "where n.nspname='public' and p.proname=$1 order by p.pronargs limit 2",
      [targetName],
    );
    if (metadata.length !== 1) return c.json({ message: 'عملیات دیتابیس هنوز نصب نشده یا مبهم است.' }, 503);
    const info = metadata[0] as { arg_names: string[]; arg_types: string[]; default_count: number };
    const resolved = resolveRpcArguments(info.arg_names ?? [], info.arg_types ?? [], Number(info.default_count ?? 0), suppliedArgs);
    if (!resolved) return c.json({ message: 'پارامترهای عملیات کامل نیستند، نامعتبرند یا پارامتر ناشناخته وجود دارد.' }, 422);
    const placeholders = resolved.names.map((name, index) => name + ' => $' + (index + 1) + '::' + resolved.types[index]);
    const rows = await runForUser(
      c,
      user.id,
      'select * from public.' + quoteSqlIdentifier(targetName) + '(' + placeholders.join(',') + ')',
      resolved.values,
    );
    return c.json({ data: rows, error: null });
  } catch (error) {
    const caught = error as { code?: string };
    return c.json({
      message: caught.code ? 'این عملیات با توجه به نقش یا وضعیت فعلی مجاز نیست.' : 'اجرای عملیات ناموفق بود.',
    }, caught.code ? 400 : 500);
  }
});
app.post('/api/access-requests',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 return c.json({message:'درخواست نقش عمومی فعال نیست؛ با کد دعوت به یک مجموعه بپیوند.',account:user.username},410);
});
const PRIVATE_BUCKET_RULES:Record<string,{maxBytes:number;contentTypes:Set<string>}>={
 'delivery-evidence':{maxBytes:50*1024*1024,contentTypes:new Set(['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime','application/pdf'])},
 'operational-evidence':{maxBytes:50*1024*1024,contentTypes:new Set(['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime','application/pdf'])},
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
type PrivateFileAction = 'read' | 'write' | 'delete';
async function canAccessPrivateFile(c: Ctx, userId: string, bucket: string, path: string, action: PrivateFileAction): Promise<boolean> {
  const [companyId, resourceId] = path.split('/');
  const sql = sqlFor(c);
  if (action === 'delete') {
    const manager = await sql.query(
      "select exists(select 1 from public.memberships m where m.user_id=$1::uuid and m.company_id=$2::uuid and m.active=true and m.role::text in ('owner','admin')) as allowed",
      [userId, companyId],
    );
    return Boolean((manager[0] as {allowed?:boolean}|undefined)?.allowed);
  }
  const rows = await sql.query(
    "select case " +
    "when $4='contract-documents' then (" +
      "(exists(select 1 from public.memberships m where m.user_id=$1::uuid and m.company_id=$2::uuid and m.active=true and m.role::text in ('owner','admin')" +
      " and exists(select 1 from public.suppliers su where su.id=$3::uuid and su.company_id=$2::uuid))" +
      (action === 'read'
        ? " or exists(select 1 from public.memberships m where m.user_id=$1::uuid and m.company_id=$2::uuid and m.active=true and m.role::text='supplier' and m.supplier_id=$3::uuid)"
        : "") +
      ")" +
    ") " +
    "when $4='operational-evidence' then (" +
      "exists(select 1 from public.operational_tasks t where t.id=$3::uuid and t.company_id=$2::uuid and (" +
        "exists(select 1 from public.memberships m where m.user_id=$1::uuid and m.company_id=$2::uuid and m.active=true and m.role::text in ('owner','admin','staff')) " +
        "or t.assignee_user_id=$1::uuid " +
        "or exists(select 1 from public.memberships m where m.user_id=$1::uuid and m.company_id=$2::uuid and m.active=true and m.role::text='supplier' and m.supplier_id=t.assignee_supplier_id)" +
      ")) " +
    ") " +
    "when $4='delivery-evidence' then (" +
      "exists(select 1 from public.shipments s where s.id=$3::uuid and s.company_id=$2::uuid and (" +
        "exists(select 1 from public.memberships m where m.user_id=$1::uuid and m.company_id=$2::uuid and m.active=true and m.role::text in ('owner','admin','staff')) " +
        (action === 'read'
          ? "or s.driver_user_id=$1::uuid " +
            "or exists(select 1 from public.orders o join public.memberships m on m.company_id=o.company_id and m.customer_id=o.customer_id where o.id=s.order_id and o.company_id=s.company_id and m.user_id=$1::uuid and m.active=true and m.role::text='customer') "
          : "or s.driver_user_id=$1::uuid ") +
      ")) " +
    ") else false end as allowed",
    [userId, companyId, resourceId, bucket, path],
  );
  return Boolean((rows[0] as { allowed?: boolean } | undefined)?.allowed);
}

app.put('/api/storage/:bucket',async c=>{
 const user=await requireUser(c);if(user instanceof Response)return user;
 if(!c.env.FILE_STORE)return c.json({message:'فضای فایل خصوصی Cloudflare R2 هنوز پیکربندی نشده است.'},503);
 const bucket=c.req.param('bucket'),rules=PRIVATE_BUCKET_RULES[bucket];if(!rules)return c.json({message:'مخزن فایل مجاز نیست.'},404);
 const path=normalizePrivatePath(c.req.query('path')??'');if(!path)return c.json({message:'مسیر فایل معتبر نیست.'},422);
 const companyId=path.split('/')[0],role=await memberRoleForCompany(c,user.id,companyId);
 if(!role)return c.json({message:'برای این مجموعه دسترسی فعال نداری.'},403);
 const moduleKey = bucket === 'delivery-evidence' ? 'shipments' : bucket === 'contract-documents' ? 'suppliers' : 'operational-tasks';
 if(!(await userHasModulePermission(c,user.id,companyId,moduleKey,'can_create')))return c.json({message:'برای بارگذاری مدرک در این ماژول مجوز ایجاد نداری.'},403);
 if(!(await canAccessPrivateFile(c,user.id,bucket,path,'write')))return c.json({message:'نقش فعلی اجازه بارگذاری این مدرک در این مسیر را ندارد.'},403);
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
 const companyId=path.split('/')[0];
 const moduleKey = bucket === 'delivery-evidence' ? 'shipments' : bucket === 'contract-documents' ? 'suppliers' : 'operational-tasks';
 if(!(await userHasModulePermission(c,user.id,companyId,moduleKey,'can_read')))return c.json({message:'فایل پیدا نشد یا دسترسی به آن مجاز نیست.'},404);
 if(!(await canAccessPrivateFile(c,user.id,bucket,path,'read')))return c.json({message:'فایل پیدا نشد یا دسترسی به آن مجاز نیست.'},404);
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
  const candidates=await runForUser(c,user.id,'select name from public.medar_files where bucket_id=$1 and name in ('+marks.join(',')+')',params);
  const candidatesNames=candidates.map(row=>String(row.name));
  const names:string[]=[];
  for(const candidate of candidatesNames){
   const companyId=candidate.split('/')[0];
   const moduleKey = bucket === 'delivery-evidence' ? 'shipments' : bucket === 'contract-documents' ? 'suppliers' : 'operational-tasks';
   if(await userHasModulePermission(c,user.id,companyId,moduleKey,'can_delete') && await canAccessPrivateFile(c,user.id,bucket,candidate,'delete'))names.push(candidate);
  }
  if(!names.length)return c.json({data:[],error:null});
  await c.env.FILE_STORE.delete(names.map(name=>bucket+'/'+name));
  const deleteParams:unknown[]=[bucket],deleteMarks=names.map(name=>{deleteParams.push(name);return '$'+deleteParams.length;});
  await runForUser(c,user.id,'delete from public.medar_files where bucket_id=$1 and name in ('+deleteMarks.join(',')+') returning id',deleteParams);
  return c.json({data:names.map(name=>({name})),error:null});
 }catch{return c.json({message:'حذف فایل یا مشخصات آن ناموفق بود.'},400);}
});




const OPERATIONAL_EVENT_SOURCES: Record<string, string> = {
  order: 'orders', purchase_order: 'purchase_orders', task: 'operational_tasks',
  shipment: 'shipments', invoice: 'invoices', inventory: 'inventory_movements',
  production: 'production_batches', quality: 'quality_reviews', supplier: 'suppliers', incident: 'operational_incidents',
};

app.get('/api/operational/events', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (!(await userHasModulePermission(c, user.id, companyId, 'operational-tasks', 'can_read'))) return c.json({ message: 'برای مشاهده رویدادها مجوز نداری.' }, 403);
  const rows = await sqlFor(c).query(
    'select e.id::text as id,e.event_type as "eventType",e.severity,e.source_type as "sourceType",e.source_id::text as "sourceId",e.title,e.body,e.payload,e.occurred_at as "occurredAt",e.actor_user_id::text as "actorUserId",u.username as "actorUsername" from public.medar_operational_events e left join public.medar_users u on u.id=e.actor_user_id where e.company_id=$1::uuid order by e.occurred_at desc limit 100',
    [companyId],
  );
  return c.json({ events: rows });
});

app.post('/api/operational/events', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'درخواست رویداد معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership || !['owner','admin','staff'].includes(membership.role) || !(await userHasModulePermission(c, user.id, companyId, 'operational-tasks', 'can_create'))) return c.json({ message: 'برای ثبت رویداد عملیاتی مجوز نداری.' }, 403);
  const eventType = typeof body.eventType === 'string' ? body.eventType.trim() : '';
  const severity = typeof body.severity === 'string' ? body.severity : 'info';
  const sourceType = typeof body.sourceType === 'string' ? body.sourceType : 'system';
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.body === 'string' ? body.body.trim() : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
  if (!/^[a-z][a-z0-9_.-]{1,79}$/.test(eventType)) return c.json({ message: 'نوع رویداد معتبر نیست.' }, 422);
  if (!['info','warning','critical'].includes(severity)) return c.json({ message: 'شدت رویداد معتبر نیست.' }, 422);
  if (!['order','purchase_order','task','shipment','invoice','inventory','production','quality','supplier','incident','system','other'].includes(sourceType)) return c.json({ message: 'منبع رویداد معتبر نیست.' }, 422);
  if (title.length < 2 || title.length > 180 || description.length > 4000) return c.json({ message: 'عنوان یا شرح رویداد معتبر نیست.' }, 422);
  if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 240)) return c.json({ message: 'کلید ثبت تکراری معتبر نیست.' }, 422);
  if (sourceId && !COMPANY_ID_RE.test(sourceId)) return c.json({ message: 'شناسه رکورد مرتبط معتبر نیست.' }, 422);
  if (sourceId) {
    const sourceTable = OPERATIONAL_EVENT_SOURCES[sourceType];
    if (!sourceTable) return c.json({ message: 'این نوع رویداد نمی‌تواند به رکورد عملیاتی متصل شود.' }, 422);
    const found = await sqlFor(c).query('select 1 from public.' + sourceTable + ' where id=$1::uuid and company_id=$2::uuid limit 1', [sourceId, companyId]);
    if (!found.length) return c.json({ message: 'رکورد مرتبط در این شرکت پیدا نشد.' }, 404);
  }
  const rows = await sqlFor(c).query(
    'insert into public.medar_operational_events (company_id,actor_user_id,event_type,severity,source_type,source_id,title,body,payload,idempotency_key) values ($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7,$8,$9::jsonb,$10) on conflict (company_id,idempotency_key) where idempotency_key is not null do update set idempotency_key=excluded.idempotency_key returning id::text as id,company_id::text as "companyId",event_type as "eventType",severity,source_type as "sourceType",source_id::text as "sourceId",title,body,payload,occurred_at as "occurredAt",actor_user_id::text as "actorUserId"',
    [companyId,user.id,eventType,severity,sourceType,sourceId || null,title,description,JSON.stringify(payload),idempotencyKey || null],
  );
  const event = rows[0];
  if (severity === 'warning' || severity === 'critical' || body.createException === true) {
    const dedupeKey = idempotencyKey ? 'event:' + idempotencyKey : null;
    await sqlFor(c).query(
      "insert into public.medar_exception_cases(company_id,event_id,title,details,severity,created_by,dedupe_key) values ($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7) on conflict (company_id,dedupe_key) where dedupe_key is not null and status not in ('resolved','closed') do update set updated_at=now() returning id",
      [companyId,event.id,title,description,severity === 'critical' ? 'critical' : 'warning',user.id,dedupeKey],
    );
  }
  return c.json({ ok: true, event }, 201);
});

app.get('/api/operational/exceptions', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership || !['owner','admin','staff'].includes(membership.role) || !(await userHasModulePermission(c, user.id, companyId, 'operational-tasks', 'can_read'))) return c.json({ message: 'برای مشاهده صندوق استثناها مجوز نداری.' }, 403);
  const status = c.req.query('status') ?? '';
  if (status && !['open','acknowledged','in_progress','resolved','closed'].includes(status)) return c.json({ message: 'وضعیت مسئله معتبر نیست.' }, 422);
  const rows = await sqlFor(c).query(
    `select x.id::text as id,x.event_id::text as "eventId",x.title,x.details,x.severity,x.status,x.assigned_user_id::text as "assignedUserId",u.username as "assignedUsername",x.due_at as "dueAt",x.acknowledged_at as "acknowledgedAt",x.resolved_at as "resolvedAt",x.resolved_by::text as "resolvedBy",x.resolution_note as "resolutionNote",x.created_at as "createdAt",x.updated_at as "updatedAt" from public.medar_exception_cases x left join public.medar_users u on u.id=x.assigned_user_id where x.company_id=$1::uuid and ($2='' or x.status=$2) order by case x.severity when 'critical' then 0 else 1 end,x.due_at asc nulls last,x.created_at desc limit 100`,
    [companyId,status],
  );
  return c.json({ exceptions: rows });
});

app.post('/api/operational/exceptions', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'درخواست ایجاد مسئله معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership || !['owner','admin','staff'].includes(membership.role) || !(await userHasModulePermission(c, user.id, companyId, 'operational-tasks', 'can_create'))) return c.json({ message: 'برای ایجاد مسئله عملیاتی مجوز نداری.' }, 403);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const details = typeof body.details === 'string' ? body.details.trim() : '';
  const severity = typeof body.severity === 'string' ? body.severity : 'warning';
  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  const assignedUserId = typeof body.assignedUserId === 'string' ? body.assignedUserId : '';
  const dueAt = typeof body.dueAt === 'string' ? body.dueAt : '';
  const dedupeKey = typeof body.dedupeKey === 'string' ? body.dedupeKey.trim() : '';
  if (title.length < 2 || title.length > 180 || details.length > 4000) return c.json({ message: 'عنوان یا شرح مسئله معتبر نیست.' }, 422);
  if (!['warning','critical'].includes(severity)) return c.json({ message: 'شدت مسئله معتبر نیست.' }, 422);
  if (eventId && !COMPANY_ID_RE.test(eventId)) return c.json({ message: 'شناسه رویداد معتبر نیست.' }, 422);
  if (assignedUserId && !COMPANY_ID_RE.test(assignedUserId)) return c.json({ message: 'شناسه مسئول معتبر نیست.' }, 422);
  if (dueAt && !Number.isFinite(Date.parse(dueAt))) return c.json({ message: 'مهلت مسئله معتبر نیست.' }, 422);
  if (dedupeKey && (dedupeKey.length < 8 || dedupeKey.length > 240)) return c.json({ message: 'کلید جلوگیری از تکرار معتبر نیست.' }, 422);
  if (eventId) {
    const found = await sqlFor(c).query('select 1 from public.medar_operational_events where id=$1::uuid and company_id=$2::uuid limit 1', [eventId,companyId]);
    if (!found.length) return c.json({ message: 'رویداد مرتبط در این شرکت پیدا نشد.' }, 404);
  }
  if (assignedUserId) {
    const found = await sqlFor(c).query('select 1 from public.memberships where company_id=$1::uuid and user_id=$2::uuid and active=true limit 1', [companyId,assignedUserId]);
    if (!found.length) return c.json({ message: 'مسئول باید عضو فعال همین شرکت باشد.' }, 422);
  }
  const rows = await sqlFor(c).query(
    "insert into public.medar_exception_cases(company_id,event_id,title,details,severity,assigned_user_id,due_at,created_by,dedupe_key) values ($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7::timestamptz,$8::uuid,$9) on conflict (company_id,dedupe_key) where dedupe_key is not null and status not in ('resolved','closed') do update set updated_at=now() returning id::text as id,company_id::text as \"companyId\",event_id::text as \"eventId\",title,details,severity,status,assigned_user_id::text as \"assignedUserId\",due_at as \"dueAt\",created_at as \"createdAt\",updated_at as \"updatedAt\"",
    [companyId,eventId || null,title,details,severity,assignedUserId || null,dueAt || null,user.id,dedupeKey || null],
  );
  return c.json({ ok: true, exception: rows[0] }, 201);
});

app.post('/api/operational/exceptions/:id/acknowledge', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(id) || !COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مسئله یا مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership || !['owner','admin','staff'].includes(membership.role)) return c.json({ message: 'برای رسیدگی به این مسئله دسترسی نداری.' }, 403);
  if (!(await userHasModulePermission(c, user.id, companyId, 'operational-tasks', 'can_update'))) return c.json({ message: 'مجوز به‌روزرسانی مسئله را نداری.' }, 403);
  const rows = await sqlFor(c).query("update public.medar_exception_cases set status='acknowledged',acknowledged_at=coalesce(acknowledged_at,now()),updated_at=now() where id=$1::uuid and company_id=$2::uuid and status in ('open','acknowledged') returning id::text as id,status,acknowledged_at as \"acknowledgedAt\"",[id,companyId]);
  if (!rows.length) return c.json({ message: 'مسئله پیدا نشد یا وضعیت آن اجازه تأیید دریافت نمی‌دهد.' }, 409);
  return c.json({ ok: true, exception: rows[0] });
});

app.post('/api/operational/exceptions/:id/start', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(id) || !COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مسئله یا مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership || !['owner','admin','staff'].includes(membership.role)) return c.json({ message: 'برای رسیدگی به این مسئله دسترسی نداری.' }, 403);
  if (!(await userHasModulePermission(c, user.id, companyId, 'operational-tasks', 'can_update'))) return c.json({ message: 'مجوز به‌روزرسانی مسئله را نداری.' }, 403);
  const rows = await sqlFor(c).query(
    "update public.medar_exception_cases set status='in_progress',updated_at=now() where id=$1::uuid and company_id=$2::uuid and status='acknowledged' returning id::text as id,status,updated_at as \"updatedAt\"",
    [id,companyId],
  );
  if (!rows.length) return c.json({ message: 'ابتدا دریافت مسئله را ثبت کن یا وضعیت فعلی اجازه شروع رسیدگی نمی‌دهد.' }, 409);
  return c.json({ ok: true, exception: rows[0] });
});

app.post('/api/operational/exceptions/:id/resolve', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const resolutionNote = typeof body?.resolutionNote === 'string' ? body.resolutionNote.trim() : '';
  if (!COMPANY_ID_RE.test(id) || !COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مسئله یا مجموعه معتبر نیست.' }, 422);
  if (resolutionNote.length < 3 || resolutionNote.length > 2000) return c.json({ message: 'برای بستن مسئله، شرح نتیجهٔ حداقل ۳ نویسه‌ای لازم است.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership || !['owner','admin','staff'].includes(membership.role)) return c.json({ message: 'برای رسیدگی به این مسئله دسترسی نداری.' }, 403);
  if (!(await userHasModulePermission(c, user.id, companyId, 'operational-tasks', 'can_update'))) return c.json({ message: 'مجوز به‌روزرسانی مسئله را نداری.' }, 403);
  const rows = await sqlFor(c).query("update public.medar_exception_cases set status='resolved',resolved_at=now(),resolved_by=$3::uuid,resolution_note=$4,updated_at=now() where id=$1::uuid and company_id=$2::uuid and status not in ('resolved','closed') returning id::text as id,status,resolved_at as \"resolvedAt\",resolved_by::text as \"resolvedBy\",resolution_note as \"resolutionNote\"",[id,companyId,user.id,resolutionNote]);
  if (!rows.length) return c.json({ message: 'مسئله پیدا نشد یا قبلاً بسته شده است.' }, 409);
  return c.json({ ok: true, exception: rows[0] });
});



app.get('/api/connect/people', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c,companyId,user.id);
  if (!membership || !['owner','admin','staff'].includes(membership.role)) return c.json({ message: 'فهرست همکاران فقط برای اعضای داخلی مجاز است.' }, 403);
  if (!(await userHasModulePermission(c,user.id,companyId,'operational-tasks','can_create'))) return c.json({ message: 'برای ایجاد ارتباط مجوز نداری.' }, 403);
  const rows = await sqlFor(c).query(
    "select distinct u.id::text as id,u.username,u.display_name as \"displayName\",m.role::text as role from public.memberships m join public.medar_users u on u.id=m.user_id where m.company_id=$1::uuid and m.active=true and u.account_status='active' order by m.role::text,u.display_name,u.username limit 300",
    [companyId],
  );
  return c.json({ people: rows });
});

app.get('/api/connect/conversations', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  if (!(await aiCompanyMembership(c, companyId, user.id))) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  const rows = await sqlFor(c).query(
    'select v.id::text as id,v.title,v.related_entity_type as "relatedEntityType",v.related_entity_id::text as "relatedEntityId",v.created_at as "createdAt",v.updated_at as "updatedAt",p.last_read_at as "lastReadAt",(select count(*)::int from public.medar_messages msg where msg.company_id=v.company_id and msg.conversation_id=v.id and msg.deleted_at is null and msg.sender_user_id<>$2::uuid and (p.last_read_at is null or msg.created_at>p.last_read_at)) as "unreadCount",(select left(msg.body,180) from public.medar_messages msg where msg.company_id=v.company_id and msg.conversation_id=v.id and msg.deleted_at is null order by msg.created_at desc limit 1) as "lastMessage" from public.medar_conversation_participants p join public.medar_conversations v on v.company_id=p.company_id and v.id=p.conversation_id where p.company_id=$1::uuid and p.user_id=$2::uuid and v.archived_at is null order by v.updated_at desc limit 100',
    [companyId,user.id],
  );
  return c.json({ conversations: rows });
});

app.post('/api/connect/conversations', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'درخواست گفت‌وگو معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await aiCompanyMembership(c, companyId, user.id);
  if (!membership || !['owner','admin','staff'].includes(membership.role) || !(await userHasModulePermission(c,user.id,companyId,'operational-tasks','can_create'))) return c.json({ message: 'ایجاد گفت‌وگوی جدید فقط برای اعضای داخلی دارای مجوز مجاز است.' }, 403);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const relatedEntityType = typeof body.relatedEntityType === 'string' ? body.relatedEntityType : '';
  const relatedEntityId = typeof body.relatedEntityId === 'string' ? body.relatedEntityId : '';
  const inputIds = Array.isArray(body.participantUserIds) ? body.participantUserIds.filter((id): id is string => typeof id === 'string') : [];
  if (title.length > 180 || inputIds.length > 29 || inputIds.some(id => !COMPANY_ID_RE.test(id))) return c.json({ message: 'عنوان یا فهرست اعضای گفت‌وگو معتبر نیست.' }, 422);
  if (relatedEntityType && !['order','purchase_order','task','shipment','invoice','exception','other'].includes(relatedEntityType)) return c.json({ message: 'نوع رکورد مرتبط معتبر نیست.' }, 422);
  if (relatedEntityId && (!COMPANY_ID_RE.test(relatedEntityId) || !relatedEntityType)) return c.json({ message: 'شناسه یا نوع رکورد مرتبط معتبر نیست.' }, 422);
  const participantIds = [...new Set([user.id,...inputIds])];
  const allowed = await sqlFor(c).query('select user_id::text as id from public.memberships where company_id=$1::uuid and active=true and user_id=any($2::uuid[])',[companyId,participantIds]);
  if (allowed.length !== participantIds.length) return c.json({ message: 'تمام شرکت‌کنندگان باید عضو فعال همین شرکت باشند.' }, 422);
  if (relatedEntityId) {
    const sourceTable = ({order:'orders',purchase_order:'purchase_orders',task:'operational_tasks',shipment:'shipments',invoice:'invoices',exception:'medar_exception_cases',other:''} as Record<string,string>)[relatedEntityType] ?? '';
    if (!sourceTable) return c.json({ message: 'این نوع رکورد برای اتصال گفت‌وگو پشتیبانی نمی‌شود.' }, 422);
    const found = await sqlFor(c).query('select 1 from public.'+sourceTable+' where id=$1::uuid and company_id=$2::uuid limit 1',[relatedEntityId,companyId]);
    if (!found.length) return c.json({ message: 'رکورد مرتبط در این شرکت پیدا نشد.' }, 404);
  }
  const rows = await sqlFor(c).query(
    "with created as (insert into public.medar_conversations(company_id,title,related_entity_type,related_entity_id,created_by) values ($1::uuid,$2,$3,$4::uuid,$5::uuid) returning id,company_id), participants as (insert into public.medar_conversation_participants(company_id,conversation_id,user_id,participant_role) select created.company_id,created.id,ids.user_id,case when ids.user_id=$5::uuid then 'owner' else 'member' end from created cross join unnest($6::uuid[]) as ids(user_id) returning user_id) select created.id::text as id,created.company_id::text as \"companyId\" from created",
    [companyId,title,relatedEntityType || null,relatedEntityId || null,user.id,participantIds],
  );
  return c.json({ ok: true, conversation: rows[0] }, 201);
});

app.get('/api/connect/conversations/:id/messages', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  const conversationId = c.req.param('id');
  if (!COMPANY_ID_RE.test(companyId) || !COMPANY_ID_RE.test(conversationId)) return c.json({ message: 'شناسه گفت‌وگو یا مجموعه معتبر نیست.' }, 422);
  if (!(await aiCompanyMembership(c,companyId,user.id))) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  const participant = await sqlFor(c).query('select 1 from public.medar_conversation_participants where company_id=$1::uuid and conversation_id=$2::uuid and user_id=$3::uuid limit 1',[companyId,conversationId,user.id]);
  if (!participant.length) return c.json({ message: 'این گفت‌وگو در دسترس حساب فعلی نیست.' }, 403);
  const rows = await sqlFor(c).query(
    'select msg.id::text as id,msg.sender_user_id::text as "senderUserId",u.username as "senderUsername",msg.body,msg.created_at as "createdAt",msg.edited_at as "editedAt" from (select * from public.medar_messages where company_id=$1::uuid and conversation_id=$2::uuid and deleted_at is null order by created_at desc limit 100) msg join public.medar_users u on u.id=msg.sender_user_id order by msg.created_at asc',
    [companyId,conversationId],
  );
  await sqlFor(c).query('update public.medar_conversation_participants set last_read_at=now() where company_id=$1::uuid and conversation_id=$2::uuid and user_id=$3::uuid',[companyId,conversationId,user.id]);
  return c.json({ messages: rows });
});

app.post('/api/connect/conversations/:id/messages', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const conversationId = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const messageBody = typeof body?.body === 'string' ? body.body.trim() : '';
  const clientMessageId = typeof body?.clientMessageId === 'string' ? body.clientMessageId.trim() : '';
  if (!COMPANY_ID_RE.test(companyId) || !COMPANY_ID_RE.test(conversationId)) return c.json({ message: 'شناسه گفت‌وگو یا مجموعه معتبر نیست.' }, 422);
  if (messageBody.length < 1 || messageBody.length > 8000) return c.json({ message: 'متن پیام باید بین ۱ تا ۸۰۰۰ نویسه باشد.' }, 422);
  if (body?.clientMessageId !== undefined && (clientMessageId.length < 8 || clientMessageId.length > 120)) return c.json({ message: 'شناسه پیام معتبر نیست.' }, 422);
  if (!(await aiCompanyMembership(c,companyId,user.id))) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  const participant = await sqlFor(c).query('select 1 from public.medar_conversation_participants where company_id=$1::uuid and conversation_id=$2::uuid and user_id=$3::uuid limit 1',[companyId,conversationId,user.id]);
  if (!participant.length) return c.json({ message: 'ارسال پیام به این گفت‌وگو مجاز نیست.' }, 403);
  const rows = await sqlFor(c).query(
    'insert into public.medar_messages(company_id,conversation_id,sender_user_id,body,client_message_id) values ($1::uuid,$2::uuid,$3::uuid,$4,$5) on conflict (company_id,conversation_id,sender_user_id,client_message_id) where client_message_id is not null do update set body=medar_messages.body returning id::text as id,company_id::text as "companyId",conversation_id::text as "conversationId",sender_user_id::text as "senderUserId",body,created_at as "createdAt"',
    [companyId,conversationId,user.id,messageBody,clientMessageId || null],
  );
  const message = rows[0];
  await sqlFor(c).query('update public.medar_conversations set updated_at=now() where company_id=$1::uuid and id=$2::uuid',[companyId,conversationId]);
  return c.json({ ok: true, message }, 201);
});


app.get('/api/push/config', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  if (!(await aiCompanyMembership(c,companyId,user.id))) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  const enabled = Boolean(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY && c.env.VAPID_SUBJECT);
  return c.json({ enabled, publicKey: enabled ? c.env.VAPID_PUBLIC_KEY : null });
});

app.post('/api/push/subscriptions', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ message: 'درخواست ثبت اعلان گوشی معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
  const keys = body.keys && typeof body.keys === 'object' && !Array.isArray(body.keys) ? body.keys as Record<string, unknown> : {};
  const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
  const authSecret = typeof keys.auth === 'string' ? keys.auth : '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  if (!(await aiCompanyMembership(c,companyId,user.id))) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (!c.env.VAPID_PUBLIC_KEY || !c.env.VAPID_PRIVATE_KEY || !c.env.VAPID_SUBJECT) return c.json({ message: 'ارسال Push هنوز روی محیط عملیاتی پیکربندی نشده است.' }, 503);
  if (!allowedWebPushEndpoint(endpoint)) return c.json({ message: 'آدرس سرویس Push معتبر یا پشتیبانی‌شده نیست.' }, 422);
  try {
    if (base64UrlToBytes(p256dh).length !== 65 || base64UrlToBytes(authSecret).length < 16) throw new Error('invalid keys');
  } catch { return c.json({ message: 'کلیدهای رمزنگاری مرورگر معتبر نیستند.' }, 422); }
  const expiration = typeof body.expirationTime === 'number' && Number.isFinite(body.expirationTime) ? new Date(body.expirationTime) : null;
  const endpointHash = await sha256(endpoint);
  const encryptedAuthSecret = await encryptAiKey(c, authSecret);
  const userAgent = (c.req.header('user-agent') ?? '').slice(0,500);
  const rows = await sqlFor(c).query(
    'insert into public.medar_push_subscriptions(company_id,user_id,endpoint,endpoint_hash,p256dh_key,auth_secret,expiration_time,user_agent,active,updated_at) values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::timestamptz,$8,true,now()) on conflict(endpoint_hash) do update set company_id=excluded.company_id,user_id=excluded.user_id,endpoint=excluded.endpoint,p256dh_key=excluded.p256dh_key,auth_secret=excluded.auth_secret,expiration_time=excluded.expiration_time,user_agent=excluded.user_agent,active=true,last_error=null,updated_at=now() returning id::text as id,active',
    [companyId,user.id,endpoint,endpointHash,p256dh,encryptedAuthSecret,expiration && Number.isFinite(expiration.getTime()) ? expiration.toISOString() : null,userAgent],
  );
  return c.json({ ok: true, subscription: rows[0] }, 201);
});

app.post('/api/push/subscriptions/remove', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
  if (!COMPANY_ID_RE.test(companyId) || !endpoint) return c.json({ message: 'شناسه مجموعه یا آدرس اشتراک معتبر نیست.' }, 422);
  if (!(await aiCompanyMembership(c,companyId,user.id))) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  const endpointHash = await sha256(endpoint);
  const rows = await sqlFor(c).query(
    'update public.medar_push_subscriptions set active=false,updated_at=now() where company_id=$1::uuid and user_id=$2::uuid and endpoint_hash=$3 returning id::text as id',
    [companyId,user.id,endpointHash],
  );
  return c.json({ ok: true, removed: rows.length });
});

app.get('/api/notifications', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const companyId = c.req.query('companyId') ?? '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  if (!(await aiCompanyMembership(c, companyId, user.id))) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (!(await userHasModulePermission(c, user.id, companyId, 'home', 'can_read'))) return c.json({ message: 'برای مشاهده اعلان‌ها مجوز نداری.' }, 403);
  const sql = sqlFor(c);
  const [rows, counts] = await Promise.all([
    sql.query(
      'select id::text as id,title,body,href,read_at as "readAt",created_at as "createdAt" from public.notifications where company_id=$1::uuid and user_id=$2::uuid order by created_at desc limit 30',
      [companyId, user.id],
    ),
    sql.query(
      'select count(*)::int as total,count(*) filter(where read_at is null)::int as unread from public.notifications where company_id=$1::uuid and user_id=$2::uuid',
      [companyId, user.id],
    ),
  ]);
  return c.json({ notifications: rows, summary: counts[0] ?? { total: 0, unread: 0 } });
});

app.post('/api/notifications/read-all', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  if (!(await aiCompanyMembership(c, companyId, user.id))) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (!(await userHasModulePermission(c, user.id, companyId, 'home', 'can_update'))) return c.json({ message: 'مجوز ثبت وضعیت خوانده‌شدن اعلان را نداری.' }, 403);
  const rows = await sqlFor(c).query(
    'update public.notifications set read_at=now() where company_id=$1::uuid and user_id=$2::uuid and read_at is null returning id',
    [companyId, user.id],
  );
  return c.json({ ok: true, updated: rows.length });
});

app.post('/api/notifications/:id/read', async (c) => {
  const user = await requireUser(c);
  if (user instanceof Response) return user;
  const notificationId = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  if (!COMPANY_ID_RE.test(notificationId) || !COMPANY_ID_RE.test(companyId)) return c.json({ message: 'شناسه اعلان یا مجموعه معتبر نیست.' }, 422);
  if (!(await aiCompanyMembership(c, companyId, user.id))) return c.json({ message: 'به این فضای کاری دسترسی فعال نداری.' }, 403);
  if (!(await userHasModulePermission(c, user.id, companyId, 'home', 'can_update'))) return c.json({ message: 'مجوز ثبت وضعیت خوانده‌شدن اعلان را نداری.' }, 403);
  const rows = await sqlFor(c).query(
    'update public.notifications set read_at=coalesce(read_at,now()) where id=$1::uuid and company_id=$2::uuid and user_id=$3::uuid returning id::text as id,read_at as "readAt"',
    [notificationId, companyId, user.id],
  );
  if (!rows.length) return c.json({ message: 'اعلان در حساب فعلی پیدا نشد.' }, 404);
  return c.json({ ok: true, notification: rows[0] });
});


async function runWebPushOutbox(env: Bindings): Promise<void> {
  if (!env.DATABASE_URL || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return;
  const sql = neon(env.DATABASE_URL);
  await sql.query(
    "update public.medar_notification_outbox set status='failed',last_error='Retry limit reached',updated_at=now() where status='queued' and attempts>=8 and next_attempt_at<=now()",
    [],
  );
  const rows = await sql.query(
    "with candidates as (select o.id from public.medar_notification_outbox o where ((o.status='queued' and o.next_attempt_at<=now()) or (o.status='processing' and o.updated_at<now()-interval '10 minutes')) and o.attempts<8 and exists (select 1 from public.medar_push_subscriptions s where s.company_id=o.company_id and s.user_id=o.user_id and s.active=true and (s.expiration_time is null or s.expiration_time>now())) order by o.created_at asc limit 25 for update skip locked), claimed as (update public.medar_notification_outbox o set status='processing',attempts=o.attempts+1,updated_at=now() from candidates c where o.id=c.id returning o.id,o.company_id,o.user_id,o.payload,o.attempts) select c.id::text as \"outboxId\",c.company_id::text as \"companyId\",c.user_id::text as \"userId\",c.payload,c.attempts,s.id::text as \"subscriptionId\",s.endpoint,s.p256dh_key,s.auth_secret from claimed c join public.medar_push_subscriptions s on s.company_id=c.company_id and s.user_id=c.user_id and s.active=true and (s.expiration_time is null or s.expiration_time>now())",
    [],
  );
  const groups = new Map<string, { companyId: string; userId: string; payload: Record<string, unknown>; attempts: number; subscriptions: Array<{ id: string; endpoint: string; p256dh_key: string; auth_secret: string }> }>();
  for (const raw of rows as Array<Record<string, unknown>>) {
    const outboxId = String(raw.outboxId);
    let group = groups.get(outboxId);
    if (!group) {
      const payload = typeof raw.payload === 'string' ? JSON.parse(raw.payload) as Record<string, unknown> : raw.payload as Record<string, unknown>;
      group = { companyId: String(raw.companyId), userId: String(raw.userId), payload, attempts: Number(raw.attempts), subscriptions: [] };
      groups.set(outboxId, group);
    }
    group.subscriptions.push({ id: String(raw.subscriptionId), endpoint: String(raw.endpoint), p256dh_key: String(raw.p256dh_key), auth_secret: String(raw.auth_secret) });
  }
  for (const [outboxId, group] of groups) {
    let delivered = false;
    let retryable = false;
    const errors: string[] = [];
    for (const subscription of group.subscriptions) {
      try {
        const result = await sendWebPush(subscription, group.payload, env);
        if (result.ok) {
          delivered = true;
          await sql.query("update public.medar_push_subscriptions set last_success_at=now(),last_error=null,updated_at=now() where id=$1::uuid", [subscription.id]);
        } else if (result.gone) {
          await sql.query("update public.medar_push_subscriptions set active=false,last_failure_at=now(),last_error='Push endpoint expired or was removed',updated_at=now() where id=$1::uuid", [subscription.id]);
        } else {
          retryable = retryable || result.status >= 500 || result.status === 429;
          errors.push('Push service returned HTTP ' + result.status);
          await sql.query("update public.medar_push_subscriptions set last_failure_at=now(),last_error=$2,updated_at=now() where id=$1::uuid", [subscription.id,errors[errors.length-1]]);
        }
      } catch (error) {
        retryable = true;
        const message = (error instanceof Error ? error.message : 'Push delivery failed').slice(0,450);
        errors.push(message);
        await sql.query("update public.medar_push_subscriptions set last_failure_at=now(),last_error=$2,updated_at=now() where id=$1::uuid", [subscription.id,message]);
      }
    }
    const status = delivered ? 'sent' : group.attempts >= 8 || !retryable ? 'failed' : 'queued';
    const delay = Math.min(3600, 30 * (2 ** Math.min(group.attempts,7)));
    await sql.query(
      "update public.medar_notification_outbox set status=$2,next_attempt_at=now()+($3::int * interval '1 second'),last_error=$4,sent_at=case when $2='sent' then now() else null end,updated_at=now() where id=$1::uuid",
      [outboxId,status,delay,delivered ? null : (errors.join('; ').slice(0,490) || 'No active push subscription')],
    );
  }
}

async function runDailyBriefingNotifications(env: Bindings): Promise<void> {
  if (!env.DATABASE_URL) throw new Error('Database is not configured for scheduled daily briefings');
  const sql = neon(env.DATABASE_URL);
  await sql.query(
    "with active_members as (" +
    " select m.company_id,m.user_id,m.role::text as role,m.customer_id,m.supplier_id " +
    " from public.memberships m join public.medar_users u on u.id=m.user_id " +
    " where m.active=true and u.account_status='active' and m.role::text in ('owner','admin','staff','supplier','driver','customer')" +
    "), metrics as (" +
    " select m.company_id,m.user_id,m.role," +
    " case when m.role in ('owner','admin') then (select count(*)::int from public.operational_tasks t where t.company_id=m.company_id and t.status not in ('approved','cancelled')) " +
    " when m.role in ('staff','driver') then (select count(*)::int from public.operational_tasks t where t.company_id=m.company_id and t.assignee_user_id=m.user_id and t.status not in ('approved','cancelled')) " +
    " when m.role='supplier' and m.supplier_id is not null then (select count(*)::int from public.operational_tasks t where t.company_id=m.company_id and t.assignee_supplier_id=m.supplier_id and t.status not in ('approved','cancelled')) else 0 end as open_tasks," +
    " case when m.role in ('owner','admin') then (select count(*)::int from public.orders o where o.company_id=m.company_id and o.requested_delivery<timezone('Asia/Tehran',now())::date and o.status not in ('delivered','cancelled')) " +
    " when m.role='customer' and m.customer_id is not null then (select count(*)::int from public.orders o where o.company_id=m.company_id and o.customer_id=m.customer_id and o.requested_delivery<timezone('Asia/Tehran',now())::date and o.status not in ('delivered','cancelled')) else 0 end as late_orders," +
    " case when m.role in ('owner','admin') then (select count(*)::int from public.operational_incidents i where i.company_id=m.company_id and i.status not in ('resolved','closed','cancelled')) else 0 end as open_incidents," +
    " case when m.role in ('owner','admin') then (select count(*)::int from public.shipments s where s.company_id=m.company_id and s.stage not in ('delivered','returned','failed')) " +
    " when m.role='driver' then (select count(*)::int from public.shipments s where s.company_id=m.company_id and s.driver_user_id=m.user_id and s.stage not in ('delivered','returned','failed')) else 0 end as active_shipments," +
    " case when m.role in ('owner','admin') then (select count(*)::int from public.invoices i where i.company_id=m.company_id and i.status in ('issued','partially_paid','overdue')) " +
    " when m.role='customer' and m.customer_id is not null then (select count(*)::int from public.invoices i where i.company_id=m.company_id and i.customer_id=m.customer_id and i.status in ('issued','partially_paid','overdue')) else 0 end as open_invoices," +
    " case when m.role in ('owner','admin') then (select count(*)::int from public.capacity_commitments cc where cc.company_id=m.company_id and cc.status='declared') " +
    " when m.role='supplier' and m.supplier_id is not null then (select count(*)::int from public.capacity_commitments cc where cc.company_id=m.company_id and cc.supplier_id=m.supplier_id and cc.status='declared') else 0 end as pending_capacity" +
    " from active_members m" +
    "), candidates as (" +
    " select company_id,user_id," +
    " case when role='driver' then 'یادآوری مأموریت‌های امروز' when role='supplier' then 'برنامهٔ امروز تأمین‌کننده' when role='customer' then 'یادآوری سفارش و فاکتور' else 'خلاصهٔ روزانهٔ عملیات' end as title," +
    " concat_ws(' · '," +
    " case when open_tasks>0 then open_tasks::text||' وظیفهٔ باز' end," +
    " case when late_orders>0 then late_orders::text||' سفارش عقب‌افتاده' end," +
    " case when open_incidents>0 then open_incidents::text||' رخداد باز' end," +
    " case when active_shipments>0 then active_shipments::text||' محمولهٔ فعال' end," +
    " case when open_invoices>0 then open_invoices::text||' فاکتور باز' end," +
    " case when pending_capacity>0 then pending_capacity::text||' ظرفیت در انتظار بررسی' end) as body," +
    " '/app/home' as href," +
    " 'daily-briefing:'||to_char(timezone('Asia/Tehran',now())::date,'YYYY-MM-DD')||':'||role as dedupe_key," +
    " (open_tasks+late_orders+open_incidents+active_shipments+open_invoices+pending_capacity) as action_count" +
    " from metrics" +
    ")" +
    " insert into public.notifications(company_id,user_id,title,body,href,dedupe_key)" +
    " select company_id,user_id,title,body,href,dedupe_key from candidates where action_count>0" +
    " on conflict(company_id,user_id,dedupe_key) where dedupe_key is not null do nothing",
    [],
  );
}

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ message: 'مسیر API پیدا نشد.' }, 404);
  return c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ message: 'مسیر پیدا نشد.' }, 404);
});
app.onError((error, c) => {
  const requestId = crypto.randomUUID();
  const path = new URL(c.req.url).pathname;
  const detail = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : 'Unknown error';
  console.error(`[medar:${requestId}] ${c.req.method} ${path} ${detail}`);
  return c.json({ message: 'درخواست انجام نشد. دوباره تلاش کن.', requestId }, 500);
});
const medarWorker = {
  fetch: app.fetch,
  scheduled(controller: { scheduledTime: number; cron: string }, env: Bindings, context: { waitUntil(promise: Promise<unknown>): void }) {
    if (env.MEDAR_MODE !== 'operational') return;
    context.waitUntil((async () => {
      if (controller.cron === '30 1 * * *') await runDailyBriefingNotifications(env);
      await runWebPushOutbox(env);
    })().catch(error => {
      console.error('[medar:scheduled] notification processing failed', error);
      throw error;
    }));
  },
};
export default medarWorker;
