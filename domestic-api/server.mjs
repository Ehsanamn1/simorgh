import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import mysql from 'mysql2/promise';
import { createHash, pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);
const PORT = Number(process.env.PORT || 8788);
const SESSION_COOKIE = 'medar_session';
const SESSION_DAYS = 14;
const PASSWORD_ITERATIONS = 100_000;
const DUMMY_PASSWORD_HASH = 'pbkdf2_sha256$100000$bWVkYXItZHVtbXktc2FsdCE=$PsVhwLctTRvjK7QQMEDf0T5vDyI7Gvwrf99dNxBRF+c=';
const app = new Hono();
const pool = process.env.MYSQL_URL
  ? mysql.createPool(process.env.MYSQL_URL + (process.env.MYSQL_URL.includes('?') ? '&' : '?') + 'connectionLimit=8')
  : null;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeUsername(input) {
  if (typeof input !== 'string') return null;
  const value = input.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (value.length < 3 || value.length > 32 || !/^[\p{L}\p{N}._-]+$/u.test(value)) return null;
  if (/^[._-]|[._-]$|[._-]{2}/.test(value)) return null;
  return value;
}

function cookieOptions(maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}

function readCookie(c, name) {
  const header = c.req.header('cookie') || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index >= 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || null;
  }
  return null;
}

function setSessionCookie(c, token, maxAge = SESSION_DAYS * 24 * 60 * 60) {
  c.header('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieOptions(maxAge)}`);
}

function clearSessionCookie(c) {
  c.header('Set-Cookie', `${SESSION_COOKIE}=; ${cookieOptions(0)}`);
}

async function verifyPassword(password, encoded) {
  const [algorithm, rawIterations, saltText, expectedText] = String(encoded || '').split('$');
  if (algorithm !== 'pbkdf2_sha256' || !rawIterations || !saltText || !expectedText) return false;
  const iterations = Number(rawIterations);
  if (iterations !== PASSWORD_ITERATIONS) return false;
  try {
    const salt = Buffer.from(saltText, 'base64');
    const expected = Buffer.from(expectedText, 'base64');
    if (salt.length < 8 || expected.length !== 32) return false;
    const actual = await pbkdf2(password, salt, iterations, expected.length, 'sha256');
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await pbkdf2(password, salt, PASSWORD_ITERATIONS, 32, 'sha256');
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function clientAddress(c) {
  if (process.env.TRUST_PROXY_HEADERS !== 'true') return 'unknown';
  return c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'unknown';
}

async function rateLimitKeys(c, username) {
  const ip = clientAddress(c);
  return [sha256('username:' + username), ...(ip === 'unknown' ? [] : [sha256('ip:' + ip)])];
}

async function isRateLimited(keys) {
  if (!pool) throw new Error('Database is not configured');
  const [rows] = await pool.query(
    'SELECT attempts, window_started_at FROM medar_rate_limits WHERE key_hash IN (' + keys.map(() => '?').join(',') + ')',
    keys,
  );
  const now = Date.now();
  return rows.some((row) => Number(row.attempts) >= 8 && now - new Date(row.window_started_at).getTime() < 15 * 60 * 1000);
}

async function recordFailedLogin(keys, username, ipHash) {
  if (!pool) throw new Error('Database is not configured');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const key of keys) {
      await connection.execute(
        'INSERT INTO medar_rate_limits (key_hash, window_started_at, attempts) VALUES (?, NOW(3), 1) ' +
        'ON DUPLICATE KEY UPDATE attempts = IF(window_started_at < NOW(3) - INTERVAL 15 MINUTE, 1, attempts + 1), ' +
        'window_started_at = IF(window_started_at < NOW(3) - INTERVAL 15 MINUTE, NOW(3), window_started_at), updated_at = NOW(3)',
        [key],
      );
    }
    await connection.execute(
      'INSERT INTO medar_login_attempts (username_normalized, attempted_at, succeeded, ip_hash) VALUES (?, NOW(3), FALSE, ?)',
      [username, ipHash],
    );
    await connection.execute('DELETE FROM medar_rate_limits WHERE updated_at < NOW(3) - INTERVAL 1 DAY');
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function currentSession(c) {
  if (!pool) return null;
  const token = readCookie(c, SESSION_COOKIE);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = sha256(token);
  const [rows] = await pool.execute(
    'SELECT s.id AS sessionId, s.token_hash AS tokenHash, u.id, COALESCE(u.username_normalized,u.username) AS username, ' +
    'u.phone_e164 AS phone, u.display_name AS full_name ' +
    'FROM medar_sessions s JOIN medar_users u ON u.id=s.user_id ' +
    'WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>NOW(3) AND u.account_status=\'active\' LIMIT 1',
    [tokenHash],
  );
  if (!rows.length) return null;
  await pool.execute('UPDATE medar_sessions SET last_seen_at=NOW(3) WHERE id=?', [rows[0].sessionId]);
  return { user: rows[0], sessionId: rows[0].sessionId, tokenHash };
}

async function membershipsFor(userId) {
  const [rows] = await pool.execute(
    'SELECT m.id, m.company_id, m.user_id, m.role, m.active, m.customer_id, m.supplier_id, ' +
    'JSON_OBJECT(\'name\', COALESCE(c.name, \'مجموعه مدار\')) AS company ' +
    'FROM memberships m JOIN companies c ON c.id=m.company_id ' +
    'WHERE m.user_id=? AND m.active=TRUE ORDER BY m.created_at',
    [userId],
  );
  return rows.map((row) => ({ ...row, company: typeof row.company === 'string' ? JSON.parse(row.company) : row.company }));
}

app.use('/api/*', bodyLimit({ maxSize: 1 * 1024 * 1024 }));
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('Cache-Control', 'no-store');
  const origin = c.req.header('origin');
  const allowedOrigin = process.env.APP_ORIGIN;
  if (origin && allowedOrigin && origin !== allowedOrigin) return c.json({ message: 'مبدأ درخواست مجاز نیست.' }, 403);
  await next();
});

app.get('/api/health', async (c) => {
  if (!pool) return c.json({ ok: false, service: 'medar-domestic-api', database: false }, 503);
  try {
    await pool.query('SELECT 1 AS ready');
    return c.json({ ok: true, service: 'medar-domestic-api', database: true, auth: 'mysql' });
  } catch {
    return c.json({ ok: false, service: 'medar-domestic-api', database: false }, 503);
  }
});

app.get('/api/auth/me', async (c) => {
  if (!pool) return c.json({ user: null, memberships: [] }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ user: null, memberships: [] });
  return c.json({
    user: { id: session.user.id, username: session.user.username, phone: session.user.phone, full_name: session.user.full_name },
    memberships: await membershipsFor(session.user.id),
  });
});

app.post('/api/auth/signup', (c) => c.json({ message: 'ثبت‌نام عمومی غیرفعال است؛ حساب باید توسط مالک مجموعه ساخته شود.' }, 403));
app.post('/api/auth/signup-with-invite', (c) => c.json({ message: 'ثبت‌نام با کد دعوت در این نسخه غیرفعال است.' }, 410));

app.post('/api/auth/login', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ message: 'اطلاعات ورود معتبر نیست.' }, 400);
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password || password.length > 128) return c.json({ message: 'نام کاربری یا رمز عبور نادرست است.' }, 401);
  const keys = await rateLimitKeys(c, username);
  if (await isRateLimited(keys)) return c.json({ message: 'تلاش‌های ورود بیش از حد است. ۱۵ دقیقه دیگر دوباره امتحان کن.' }, 429);
  const [rows] = await pool.execute(
    'SELECT id, username, username_normalized, phone_e164, display_name, password_hash, account_status ' +
    'FROM medar_users WHERE COALESCE(username_normalized, LOWER(username))=? LIMIT 1',
    [username],
  );
  const account = rows[0];
  const passwordMatches = await verifyPassword(password, account?.password_hash || DUMMY_PASSWORD_HASH);
  const address = clientAddress(c);
  const ipHash = address === 'unknown' ? null : sha256('ip:' + address);
  if (!account || !passwordMatches || account.account_status !== 'active') {
    await recordFailedLogin(keys, username, ipHash);
    return c.json({ message: 'نام کاربری یا رمز عبور نادرست است.' }, 401);
  }
  const token = randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  const userAgent = (c.req.header('user-agent') || '').slice(0, 500) || null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('UPDATE medar_users SET last_login_at=NOW(3), updated_at=NOW(3) WHERE id=?', [account.id]);
    await connection.execute(
      'INSERT INTO medar_sessions (user_id, token_hash, expires_at, last_seen_at, user_agent, ip_hash) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL 14 DAY), NOW(3), ?, ?)',
      [account.id, tokenHash, userAgent, ipHash],
    );
    await connection.execute(
      'INSERT INTO medar_login_attempts (username_normalized, attempted_at, succeeded, ip_hash) VALUES (?, NOW(3), TRUE, ?)',
      [username, ipHash],
    );
    for (const key of keys) await connection.execute('DELETE FROM medar_rate_limits WHERE key_hash=?', [key]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  setSessionCookie(c, token);
  return c.json({
    user: { id: account.id, username: account.username_normalized || account.username, phone: account.phone_e164, full_name: account.display_name },
    memberships: await membershipsFor(account.id),
  });
});

app.post('/api/auth/logout', async (c) => {
  if (pool) {
    const token = readCookie(c, SESSION_COOKIE);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      await pool.execute('UPDATE medar_sessions SET revoked_at=NOW(3) WHERE token_hash=? AND revoked_at IS NULL', [sha256(token)]);
    }
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.post('/api/auth/password/change', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const body = await c.req.json().catch(() => null);
  const oldPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  if (newPassword.length < 8 || newPassword.length > 128) return c.json({ message: 'گذرواژه جدید باید بین ۸ تا ۱۲۸ نویسه باشد.' }, 422);
  const [rows] = await pool.execute('SELECT password_hash FROM medar_users WHERE id=? LIMIT 1', [session.user.id]);
  if (!rows.length || !await verifyPassword(oldPassword, rows[0].password_hash)) return c.json({ message: 'رمز فعلی نادرست است.' }, 401);
  const encoded = await hashPassword(newPassword);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('UPDATE medar_users SET password_hash=?, updated_at=NOW(3) WHERE id=?', [encoded, session.user.id]);
    await connection.execute('UPDATE medar_sessions SET revoked_at=NOW(3) WHERE user_id=? AND id<>? AND revoked_at IS NULL', [session.user.id, session.sessionId]);
    await connection.execute('INSERT INTO medar_audit_log (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, JSON_OBJECT(\'source\', \'domestic-api\'))', [session.user.id, 'auth.password.change', 'user', session.user.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return c.json({ ok: true, message: 'رمز عبور تغییر کرد. نشست‌های دیگر بسته شدند.' });
});

app.get('/api/workspace/memberships', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  return c.json({ memberships: await membershipsFor(session.user.id) });
});

app.notFound((c) => c.json({ message: 'مسیر API در نسخه داخلی پیدا نشد.' }, 404));
app.onError((error, c) => {
  const requestId = randomBytes(8).toString('hex');
  console.error('[medar-domestic:' + requestId + '] ' + c.req.method + ' ' + new URL(c.req.url).pathname + ' ' + (error instanceof Error ? error.name + ': ' + error.message : 'unknown error'));
  return c.json({ message: 'مدار نتوانست درخواست را تکمیل کند؛ چند لحظه بعد دوباره تلاش کن.', requestId }, 500);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.MYSQL_URL) {
    console.error('MYSQL_URL is required. Do not start the domestic API without a database.');
    process.exitCode = 1;
  } else {
    serve({ fetch: app.fetch, port: PORT, hostname: process.env.HOST || '127.0.0.1' }, (info) => {
      console.log('Medar domestic API listening on ' + info.address + ':' + info.port);
    });
  }
}

export async function closePool() {
  if (pool) await pool.end();
}

export { app, normalizeUsername, verifyPassword, hashPassword };
