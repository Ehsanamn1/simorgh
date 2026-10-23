import process from 'node:process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import mysql from 'mysql2/promise';
import { createHash, pbkdf2 as pbkdf2Callback, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
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
  const allowedOrigin = process.env.APP_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : new URL(c.req.url).origin);
  const unsafeMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method.toUpperCase());
  if (origin && (!allowedOrigin || origin !== allowedOrigin)) return c.json({ message: 'مبدأ درخواست مجاز نیست.' }, 403);
  if (process.env.NODE_ENV === 'production' && unsafeMethod && !origin) return c.json({ message: 'مبدأ درخواست مشخص نیست.' }, 403);
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

app.post('/api/workspace/members/create', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ message: 'اطلاعات حساب معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId.trim() : '';
  const username = normalizeUsername(body.username);
  const requestedName = typeof body.fullName === 'string' ? body.fullName.normalize('NFKC').trim() : '';
  const fullName = requestedName || username || '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = typeof body.role === 'string' ? body.role : '';
  const supplierIdInput = typeof body.supplierId === 'string' && body.supplierId.trim() ? body.supplierId.trim() : null;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const allowedRoles = new Set(['admin', 'staff', 'supplier', 'driver']);
  if (!uuidPattern.test(companyId) || !username || !allowedRoles.has(role)) return c.json({ message: 'شناسه مجموعه، نام کاربری یا نقش معتبر نیست.' }, 422);
  if (Array.from(requestedName).length > 100 || Array.from(requestedName).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    return c.json({ message: 'نام و نام خانوادگی نباید بیشتر از ۱۰۰ نویسه باشد یا شامل نویسه کنترلی باشد.' }, 422);
  }
  if (password.length < 12 || password.length > 128) return c.json({ message: 'رمز عبور اولیه باید بین ۱۲ تا ۱۲۸ نویسه باشد.' }, 422);
  if ((role !== 'supplier' && supplierIdInput) || (supplierIdInput && !uuidPattern.test(supplierIdInput)) || body.customerId) {
    return c.json({ message: 'پیوند پرونده فقط برای تأمین‌کننده و در قالب شناسه معتبر مجاز است.' }, 422);
  }
  const userId = randomUUID();
  const membershipId = randomUUID();
  const passwordHash = await hashPassword(password);
  const connection = await pool.getConnection();
  let supplierId = null;
  try {
    await connection.beginTransaction();
    const [actorRows] = await connection.execute(
      'SELECT role FROM memberships WHERE user_id=? AND company_id=? AND active=TRUE LIMIT 1 FOR UPDATE',
      [session.user.id, companyId],
    );
    const actorRole = actorRows[0]?.role;
    if (!actorRole || !['owner', 'admin'].includes(String(actorRole))) {
      await connection.rollback();
      return c.json({ message: 'فقط مالک یا مدیر می‌تواند حساب بسازد.' }, 403);
    }
    if (role === 'admin' && actorRole !== 'owner') {
      await connection.rollback();
      return c.json({ message: 'فقط مالک می‌تواند حساب مدیر بسازد.' }, 403);
    }
    if (role === 'supplier') {
      if (supplierIdInput) {
        const [supplierRows] = await connection.execute('SELECT id FROM suppliers WHERE id=? AND company_id=? LIMIT 1 FOR UPDATE', [supplierIdInput, companyId]);
        if (!supplierRows.length) {
          await connection.rollback();
          return c.json({ message: 'پرونده تأمین‌کننده به این مجموعه تعلق ندارد.' }, 422);
        }
        supplierId = supplierIdInput;
      } else {
        supplierId = randomUUID();
        const [sameName] = await connection.execute('SELECT id FROM suppliers WHERE company_id=? AND LOWER(name)=LOWER(?) LIMIT 1', [companyId, fullName]);
        const supplierName = sameName.length ? fullName.slice(0, 108) + ' (' + supplierId.slice(0, 8) + ')' : fullName;
        await connection.execute('INSERT INTO suppliers (id, company_id, name, active) VALUES (?, ?, ?, TRUE)', [supplierId, companyId, supplierName]);
      }
    }
    await connection.execute(
      'INSERT INTO medar_users (id, username, username_normalized, phone_e164, display_name, password_hash, requested_role, account_status) VALUES (?, ?, ?, NULL, ?, ?, ?, \'active\')',
      [userId, username, username, fullName, passwordHash, role],
    );
    await connection.execute('INSERT INTO profiles (id, full_name, phone) VALUES (?, ?, NULL)', [userId, fullName]);
    await connection.execute(
      'INSERT INTO memberships (id, company_id, user_id, supplier_id, role, active, created_by) VALUES (?, ?, ?, ?, ?, TRUE, ?)',
      [membershipId, companyId, userId, supplierId, role, session.user.id],
    );
    await connection.execute(
      'INSERT INTO medar_audit_log (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, JSON_OBJECT(\'company_id\', ?, \'role\', ?, \'username\', ?))',
      [session.user.id, 'membership.account_created', 'membership', membershipId, companyId, role, username],
    );
    await connection.commit();
    return c.json({ member: { id: userId, username, full_name: fullName, membership_id: membershipId, company_id: companyId, role, supplier_id: supplierId, customer_id: null } }, 201);
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    const code = error && typeof error === 'object' ? error.code : undefined;
    console.error('Domestic member provisioning failed', { code: typeof code === 'string' ? code : 'unknown' });
    if (code === 'ER_DUP_ENTRY') return c.json({ message: 'این نام کاربری یا عضویت قبلاً ثبت شده است.' }, 409);
    if (['ER_NO_REFERENCED_ROW_2', 'ER_NO_REFERENCED_ROW', 'ER_CHECK_CONSTRAINT_VIOLATED', 'ER_BAD_NULL_ERROR'].includes(String(code))) {
      return c.json({ message: 'اطلاعات حساب یا پرونده مرتبط معتبر نیست؛ فهرست را تازه‌سازی کن و دوباره تلاش کن.' }, 422);
    }
    return c.json({ message: 'ساخت حساب کامل نشد؛ هیچ حساب ناقصی ثبت نشده است. چند لحظه بعد دوباره تلاش کن.' }, 500);
  } finally {
    connection.release();
  }
});

const MEMBER_PERMISSION_CATALOG = [
  { key: 'home', label: 'صفحه اصلی و کارهای روزانه' },
  { key: 'command', label: 'مرکز فرمان و گزارش‌ها' },
  { key: 'suppliers', label: 'تأمین‌کنندگان و ظرفیت' },
  { key: 'capacity', label: 'ظرفیت و تعهد تأمین' },
  { key: 'quality', label: 'کیفیت و کنترل محموله' },
  { key: 'shipments', label: 'حمل‌ونقل، رانندگان و مدارک' },
  { key: 'farm-sites', label: 'سایت‌ها و نقشه' },
  { key: 'flock-cycles', label: 'چرخه‌های کشت و پرورش' },
  { key: 'production-batches', label: 'دوره‌های تولید' },
  { key: 'daily-production', label: 'ثبت روزانهٔ تولید' },
  { key: 'operational-tasks', label: 'وظایف و شواهد کار' },
  { key: 'incidents', label: 'رخدادها و مغایرت‌ها' },
  { key: 'partner-finance', label: 'دفتر مالی شریک' },
  { key: 'partner-settlements', label: 'دوره‌ها و تسویهٔ شریک' },
  { key: 'members', label: 'اعضا و دسترسی‌ها' },
];
const MEMBER_PERMISSION_KEYS = new Set(MEMBER_PERMISSION_CATALOG.map((module) => module.key));

app.get('/api/workspace/members', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const companyId = c.req.query('companyId') ?? '';
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const [actorRows] = await pool.execute('SELECT role FROM memberships WHERE user_id=? AND company_id=? AND active=TRUE LIMIT 1', [session.user.id, companyId]);
  const actorRole = actorRows[0]?.role;
  if (!actorRole || !['owner', 'admin'].includes(String(actorRole))) return c.json({ message: 'برای مدیریت اعضا دسترسی مالک یا مدیر لازم است.' }, 403);
  const [rows] = await pool.execute(
    'SELECT m.id AS membership_id, m.company_id, m.user_id, m.role, m.active, m.created_at, m.supplier_id, m.customer_id, ' +
    'u.username, u.phone_e164 AS phone, u.display_name AS full_name, u.last_login_at, u.account_status, s.name AS supplier_name ' +
    'FROM memberships m JOIN medar_users u ON u.id=m.user_id ' +
    'LEFT JOIN suppliers s ON s.id=m.supplier_id AND s.company_id=m.company_id ' +
    'WHERE m.company_id=? ORDER BY CASE m.role WHEN \'owner\' THEN 0 WHEN \'admin\' THEN 1 ELSE 2 END, m.created_at',
    [companyId],
  );
  return c.json({ members: rows.map((row) => ({ ...row, active: Boolean(row.active) })) });
});

app.post('/api/workspace/members/deactivate', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const body = await c.req.json().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const membershipId = typeof body?.membershipId === 'string' ? body.membershipId : '';
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(companyId) || !uuidPattern.test(membershipId)) return c.json({ message: 'شناسه مجموعه یا عضویت معتبر نیست.' }, 422);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [actorRows] = await connection.execute('SELECT role FROM memberships WHERE user_id=? AND company_id=? AND active=TRUE LIMIT 1 FOR UPDATE', [session.user.id, companyId]);
    const actorRole = actorRows[0]?.role;
    if (!actorRole || !['owner', 'admin'].includes(String(actorRole))) { await connection.rollback(); return c.json({ message: 'برای مدیریت اعضا دسترسی مالک یا مدیر لازم است.' }, 403); }
    const [targetRows] = await connection.execute('SELECT id, role, active FROM memberships WHERE id=? AND company_id=? LIMIT 1 FOR UPDATE', [membershipId, companyId]);
    const target = targetRows[0];
    if (!target || !target.active) { await connection.rollback(); return c.json({ message: 'عضویت فعال در این مجموعه پیدا نشد.' }, 404); }
    if (String(target.role) === 'owner') { await connection.rollback(); return c.json({ message: 'دسترسی مالک را نمی‌توان از این صفحه غیرفعال کرد.' }, 403); }
    if (String(target.role) === 'admin' && actorRole !== 'owner') { await connection.rollback(); return c.json({ message: 'فقط مالک می‌تواند دسترسی مدیر را غیرفعال کند.' }, 403); }
    await connection.execute('UPDATE memberships SET active=FALSE WHERE id=? AND company_id=?', [membershipId, companyId]);
    await connection.execute('INSERT INTO medar_audit_log (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, JSON_OBJECT(\'company_id\', ?))', [session.user.id, 'membership.deactivated', 'membership', membershipId, companyId]);
    await connection.commit();
    return c.json({ ok: true });
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    const code = error && typeof error === 'object' ? error.code : undefined;
    console.error('Domestic member deactivation failed', { code: typeof code === 'string' ? code : 'unknown' });
    return c.json({ message: 'غیرفعال‌سازی عضویت کامل نشد. دوباره تلاش کن.' }, 500);
  } finally { connection.release(); }
});

app.post('/api/workspace/members/reset-password', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const body = await c.req.json().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const membershipId = typeof body?.membershipId === 'string' ? body.membershipId : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(companyId) || !uuidPattern.test(membershipId)) return c.json({ message: 'شناسه مجموعه یا عضویت معتبر نیست.' }, 422);
  if (newPassword.length < 12 || newPassword.length > 128) return c.json({ message: 'گذرواژه موقت باید بین ۱۲ تا ۱۲۸ نویسه باشد.' }, 422);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [actorRows] = await connection.execute('SELECT role FROM memberships WHERE user_id=? AND company_id=? AND active=TRUE LIMIT 1 FOR UPDATE', [session.user.id, companyId]);
    const actorRole = actorRows[0]?.role;
    if (!actorRole || !['owner', 'admin'].includes(String(actorRole))) { await connection.rollback(); return c.json({ message: 'فقط مالک یا مدیر می‌تواند گذرواژه عضو را بازنشانی کند.' }, 403); }
    const [targetRows] = await connection.execute('SELECT user_id, role, active FROM memberships WHERE id=? AND company_id=? LIMIT 1 FOR UPDATE', [membershipId, companyId]);
    const target = targetRows[0];
    if (!target || !target.active) { await connection.rollback(); return c.json({ message: 'عضویت فعال در این مجموعه پیدا نشد.' }, 404); }
    if (String(target.role) === 'owner') { await connection.rollback(); return c.json({ message: 'گذرواژه مالک از این مسیر بازنشانی نمی‌شود.' }, 403); }
    if (String(target.role) === 'admin' && actorRole !== 'owner') { await connection.rollback(); return c.json({ message: 'فقط مالک می‌تواند گذرواژه مدیر دیگری را بازنشانی کند.' }, 403); }
    const encoded = await hashPassword(newPassword);
    await connection.execute('UPDATE medar_users SET password_hash=?, updated_at=NOW(3) WHERE id=?', [encoded, target.user_id]);
    await connection.execute('UPDATE medar_sessions SET revoked_at=NOW(3) WHERE user_id=? AND revoked_at IS NULL', [target.user_id]);
    await connection.execute('INSERT INTO medar_audit_log (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, JSON_OBJECT(\'company_id\', ?, \'target_user_id\', ?))', [session.user.id, 'member.password_reset', 'membership', membershipId, companyId, target.user_id]);
    await connection.commit();
    return c.json({ ok: true, message: 'گذرواژه بازنشانی شد و نشست‌های قبلی عضو بسته شدند.' });
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    const code = error && typeof error === 'object' ? error.code : undefined;
    console.error('Domestic member password reset failed', { code: typeof code === 'string' ? code : 'unknown' });
    return c.json({ message: 'بازنشانی گذرواژه کامل نشد. دوباره تلاش کن.' }, 500);
  } finally { connection.release(); }
});

app.get('/api/workspace/members/:membershipId/permissions', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const companyId = c.req.query('companyId') ?? '';
  const membershipId = c.req.param('membershipId');
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(companyId) || !uuidPattern.test(membershipId)) return c.json({ message: 'شناسه مجموعه یا عضویت معتبر نیست.' }, 422);
  const [actorRows] = await pool.execute('SELECT role FROM memberships WHERE user_id=? AND company_id=? AND active=TRUE LIMIT 1', [session.user.id, companyId]);
  const actorRole = actorRows[0]?.role;
  if (!actorRole || !['owner', 'admin'].includes(String(actorRole))) return c.json({ message: 'فقط مالک یا مدیر می‌تواند مجوزهای اعضا را مدیریت کند.' }, 403);
  const [targetRows] = await pool.execute('SELECT id AS membership_id, role, active FROM memberships WHERE id=? AND company_id=? LIMIT 1', [membershipId, companyId]);
  const target = targetRows[0];
  if (!target || !target.active) return c.json({ message: 'عضویت فعال در این مجموعه پیدا نشد.' }, 404);
  if (['owner', 'admin'].includes(String(target.role))) return c.json({ message: 'مجوزهای مالک و مدیر از این صفحه قابل محدودکردن نیستند.' }, 403);
  const [savedRows] = await pool.execute('SELECT module_key, inherit_role_defaults, can_read, can_create, can_update, can_delete, can_approve FROM medar_membership_module_permissions WHERE company_id=? AND membership_id=?', [companyId, membershipId]);
  const saved = new Map(savedRows.map((row) => [String(row.module_key), row]));
  const modules = MEMBER_PERMISSION_CATALOG.map((module) => {
    const row = saved.get(module.key);
    const configured = Boolean(row && !row.inherit_role_defaults);
    return { key: module.key, label: module.label, configured,
      can_read: configured ? Boolean(row.can_read) : true, can_create: configured ? Boolean(row.can_create) : true,
      can_update: configured ? Boolean(row.can_update) : true, can_delete: configured ? Boolean(row.can_delete) : false,
      can_approve: configured ? Boolean(row.can_approve) : false };
  });
  return c.json({ companyId, membership: { id: target.membership_id, role: target.role }, modules });
});

app.post('/api/workspace/members/:membershipId/permissions', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ message: 'درخواست مجوزها معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  const membershipId = c.req.param('membershipId');
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(companyId) || !uuidPattern.test(membershipId)) return c.json({ message: 'شناسه مجموعه یا عضویت معتبر نیست.' }, 422);
  if (!Array.isArray(body.modules) || body.modules.length !== MEMBER_PERMISSION_CATALOG.length) return c.json({ message: 'همه ماژول‌ها باید در درخواست مجوز حضور داشته باشند.' }, 422);
  const seen = new Set();
  const modules = [];
  for (const item of body.modules) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return c.json({ message: 'ساختار یک مجوز معتبر نیست.' }, 422);
    const key = typeof item.key === 'string' ? item.key : '';
    if (!MEMBER_PERMISSION_KEYS.has(key) || seen.has(key)) return c.json({ message: 'کلید ماژول ناشناخته یا تکراری است.' }, 422);
    if (['configured','can_read','can_create','can_update','can_delete','can_approve'].some((field) => typeof item[field] !== 'boolean')) return c.json({ message: 'تمام مجوزها باید مقدار روشن یا خاموش داشته باشند.' }, 422);
    seen.add(key);
    modules.push({ key, configured: item.configured, can_read: item.can_read, can_create: item.can_create, can_update: item.can_update, can_delete: item.can_delete, can_approve: item.can_approve });
  }
  if (seen.size !== MEMBER_PERMISSION_CATALOG.length) return c.json({ message: 'همه ماژول‌ها باید دقیقاً یک بار ارسال شوند.' }, 422);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [actorRows] = await connection.execute('SELECT role FROM memberships WHERE user_id=? AND company_id=? AND active=TRUE LIMIT 1 FOR UPDATE', [session.user.id, companyId]);
    const actorRole = actorRows[0]?.role;
    if (!actorRole || !['owner', 'admin'].includes(String(actorRole))) { await connection.rollback(); return c.json({ message: 'فقط مالک یا مدیر می‌تواند مجوزهای اعضا را مدیریت کند.' }, 403); }
    const [targetRows] = await connection.execute('SELECT role, active FROM memberships WHERE id=? AND company_id=? LIMIT 1 FOR UPDATE', [membershipId, companyId]);
    const target = targetRows[0];
    if (!target || !target.active) { await connection.rollback(); return c.json({ message: 'عضویت فعال در این مجموعه پیدا نشد.' }, 404); }
    if (['owner', 'admin'].includes(String(target.role))) { await connection.rollback(); return c.json({ message: 'مجوزهای مالک و مدیر از این صفحه قابل محدودکردن نیستند.' }, 403); }
    for (const module of modules) {
      await connection.execute(
        'INSERT INTO medar_membership_module_permissions (company_id, membership_id, module_key, inherit_role_defaults, can_read, can_create, can_update, can_delete, can_approve, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3)) ' +
        'ON DUPLICATE KEY UPDATE inherit_role_defaults=VALUES(inherit_role_defaults), can_read=VALUES(can_read), can_create=VALUES(can_create), can_update=VALUES(can_update), can_delete=VALUES(can_delete), can_approve=VALUES(can_approve), updated_by=VALUES(updated_by), updated_at=NOW(3)',
        [companyId, membershipId, module.key, !module.configured, module.can_read, module.can_create, module.can_update, module.can_delete, module.can_approve, session.user.id],
      );
    }
    await connection.execute('INSERT INTO medar_audit_log (actor_user_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, JSON_OBJECT(\'company_id\', ?, \'configured_modules\', ?))', [session.user.id, 'membership.permissions_updated', 'membership', membershipId, companyId, modules.filter((module) => module.configured).length]);
    await connection.commit();
    return c.json({ ok: true, configuredModules: modules.filter((module) => module.configured).length });
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    const code = error && typeof error === 'object' ? error.code : undefined;
    console.error('Domestic member permission update failed', { code: typeof code === 'string' ? code : 'unknown' });
    return c.json({ message: 'ذخیره مجوزهای عضو کامل نشد. دوباره تلاش کن.' }, 500);
  } finally { connection.release(); }
});

const DATA_TABLES = new Set([
  'customers','suppliers','products','price_agreements','orders','order_items','capacity_commitments','lots',
  'shipments','delivery_evidence','invoices','settlements','notifications','farm_sites','partnership_agreements',
  'flock_cycles','production_batches','daily_production_records','task_templates','operational_tasks','task_evidence',
  'operational_incidents','partner_financial_entries','shipment_locations','company_goals',
]);
const READ_ONLY_TABLES = new Set(['notifications','delivery_evidence','task_evidence']);
const TABLE_PROTECTED_FIELDS = {
  orders: new Set(['status']),
  order_items: new Set(['allocated_quantity','fulfilled_quantity']),
  capacity_commitments: new Set(['status','confirmed_qty','committed_qty','evidence_review_status','evidence_reviewed_by','evidence_reviewed_at','evidence_review_note']),
  shipments: new Set(['stage','departed_at','delivered_at','failure_reason']),
  invoices: new Set(['status','paid_amount','paid_at']),
  settlements: new Set(['status','paid_at','posted_at']),
  production_batches: new Set(['status','quality_status','produced_quantity','rejected_quantity','completed_on']),
  operational_tasks: new Set(['status','started_at','submitted_at','reviewed_at','reviewed_by','review_note']),
  partner_financial_entries: new Set(['status','submitted_by','submitted_at','approved_by','approved_at','posted_by','posted_at','paid_amount','paid_at']),
};
const INTERNAL_ROLES = new Set(['owner','admin','staff']);
const PROTECTED_FIELDS = new Set([
  'id','company_id','user_id','password_hash','token_hash','created_by','updated_by','recorded_by',
  'captured_by','uploaded_by','reported_by','submitted_by','reviewed_by','approved_by','posted_by',
  'paid_by','resolved_by','actor_id','assigned_by','read_at','approved_at','posted_at','paid_at',
]);
const COLUMN_CACHE = new Map();

function sqlIdentifier(value) {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error('Invalid SQL identifier');
  return '`' + value + '`';
}

async function tableColumns(table) {
  if (COLUMN_CACHE.has(table)) return COLUMN_CACHE.get(table);
  const [rows] = await pool.execute(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
    [table],
  );
  const columns = new Set(rows.map((row) => String(row.COLUMN_NAME)));
  if (!columns.size) throw new Error('Unknown database table');
  COLUMN_CACHE.set(table, columns);
  return columns;
}

function buildFilterSql(filters, columns, values, join = 'AND') {
  if (!Array.isArray(filters) || filters.length > 40) throw new Error('Invalid filters');
  const parts = [];
  for (const filter of filters) {
    if (!filter || typeof filter.column !== 'string' || !columns.has(filter.column)) throw new Error('Invalid filter column');
    const column = sqlIdentifier(filter.column);
    const op = String(filter.op || 'eq').toLowerCase();
    const value = filter.value;
    if (op === 'is' || op === 'not_is' || (value === null && ['eq','neq'].includes(op))) {
      if (value !== null && value !== 'null') throw new Error('Only null checks are supported with is/not_is');
      parts.push(column + ((op === 'not_is' || op === 'neq') ? ' IS NOT NULL' : ' IS NULL'));
      continue;
    }
    if (op === 'in' || op === 'not_in') {
      let list = value;
      if (typeof value === 'string' && value.startsWith('(') && value.endsWith(')')) {
        const raw = value.slice(1, -1);
        list = raw ? raw.split(',').map((item) => {
          const trimmed = item.trim();
          return trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")
            ? trimmed.slice(1, -1).replace(/''/g, "'")
            : trimmed;
        }) : [];
      }
      if (!Array.isArray(list) || list.length > 200) throw new Error('Invalid IN filter');
      if (!list.length) { parts.push(op === 'in' ? '0=1' : '1=1'); continue; }
      parts.push(column + (op === 'not_in' ? ' NOT IN (' : ' IN (') + list.map(() => '?').join(',') + ')');
      values.push(...list);
      continue;
    }
    const operators = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'LIKE' };
    if (!Object.hasOwn(operators, op)) throw new Error('Unsupported filter operator');
    if (op === 'ilike') parts.push('LOWER(CAST(' + column + ' AS CHAR)) LIKE LOWER(?)');
    else parts.push(column + ' ' + operators[op] + ' ?');
    values.push(value);
  }
  return parts.length ? '(' + parts.join(' ' + join + ' ') + ')' : '';
}

async function scopedMemberships(session, table, columns) {
  const memberships = await membershipsFor(session.user.id);
  return memberships.filter((membership) => columns.has('company_id') && DATA_TABLES.has(table) &&
    membership.active && typeof membership.company_id === 'string');
}

function membershipScope(table, columns, memberships, userId, values) {
  const branches = [];
  for (const membership of memberships) {
    const role = String(membership.role);
    const companyId = membership.company_id;
    if (INTERNAL_ROLES.has(role)) {
      branches.push('(' + sqlIdentifier('company_id') + ' = ?)');
      values.push(companyId);
    } else if (role === 'supplier' && membership.supplier_id) {
      if (columns.has('supplier_id')) {
        branches.push('(' + sqlIdentifier('company_id') + ' = ? AND ' + sqlIdentifier('supplier_id') + ' = ?)');
        values.push(companyId, membership.supplier_id);
      } else if (table === 'suppliers' && columns.has('id')) {
        branches.push('(' + sqlIdentifier('company_id') + ' = ? AND ' + sqlIdentifier('id') + ' = ?)');
        values.push(companyId, membership.supplier_id);
      }
    } else if (role === 'customer' && membership.customer_id) {
      if (columns.has('customer_id')) {
        branches.push('(' + sqlIdentifier('company_id') + ' = ? AND ' + sqlIdentifier('customer_id') + ' = ?)');
        values.push(companyId, membership.customer_id);
      } else if (table === 'customers' && columns.has('id')) {
        branches.push('(' + sqlIdentifier('company_id') + ' = ? AND ' + sqlIdentifier('id') + ' = ?)');
        values.push(companyId, membership.customer_id);
      } else if (table === 'notifications' && columns.has('user_id')) {
        branches.push('(' + sqlIdentifier('company_id') + ' = ? AND ' + sqlIdentifier('user_id') + ' = ?)');
        values.push(companyId, userId);
      }
    } else if (role === 'driver' && table === 'shipments' && columns.has('driver_user_id')) {
      branches.push('(' + sqlIdentifier('company_id') + ' = ? AND ' + sqlIdentifier('driver_user_id') + ' = ?)');
      values.push(companyId, userId);
    }
  }
  return branches.length ? '(' + branches.join(' OR ') + ')' : '0=1';
}

app.post('/api/data/:table', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const table = c.req.param('table');
  if (!DATA_TABLES.has(table)) return c.json({ message: 'جدول در API مجاز نیست.' }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ message: 'درخواست داده معتبر نیست.' }, 400);
  const action = typeof body.action === 'string' ? body.action : 'select';
  if (!['select','insert','update','delete'].includes(action)) return c.json({ message: 'عملیات داده مجاز نیست.' }, 422);
  try {
    const columns = await tableColumns(table);
    if (!columns.has('company_id')) return c.json({ message: 'جدول فاقد محدوده شرکت است.' }, 403);
    const memberships = await scopedMemberships(session, table, columns);
    if (!memberships.length) return c.json({ message: 'این حساب به فضای کاری فعالی دسترسی ندارد.' }, 403);
    const scopeValues = [];
    const scope = membershipScope(table, columns, memberships, session.user.id, scopeValues);
    const filterValues = [];
    const filters = buildFilterSql(body.filters || [], columns, filterValues);
    const orValues = [];
    const orFilters = buildFilterSql(body.orFilters || [], columns, orValues, 'OR');
    const clauses = [scope, filters, orFilters].filter(Boolean);
    const where = clauses.length ? ' WHERE ' + clauses.map((part) => '(' + part + ')').join(' AND ') : '';
    if (action === 'select') {
      const countValues = [...scopeValues, ...filterValues, ...orValues];
      let count = null;
      if (body.count === true || body.head === true) {
        const [countRows] = await pool.execute('SELECT COUNT(*) AS count FROM ' + sqlIdentifier(table) + where, countValues);
        count = Number(countRows[0]?.count ?? 0);
      }
      if (body.head === true) return c.json({ data: [], count, error: null });
      const params = [...scopeValues, ...filterValues, ...orValues];
      const requested = typeof body.selection === 'string' ? body.selection.split(',').map((part) => part.trim()) : ['*'];
      const projection = requested.includes('*') ? '*' : requested.length && requested.every((field) => /^[a-z_][a-z0-9_]*$/i.test(field) && columns.has(field))
        ? [...new Set(requested)].map(sqlIdentifier).join(', ')
        : '*';
      let query = 'SELECT ' + projection + ' FROM ' + sqlIdentifier(table) + where;
      if (body.order && typeof body.order === 'object' && body.order.column) {
        if (!columns.has(body.order.column)) throw new Error('Invalid order column');
        query += ' ORDER BY ' + sqlIdentifier(body.order.column) + (body.order.ascending === true ? ' ASC' : ' DESC');
      }
      const limit = Math.max(1, Math.min(500, Number.isFinite(Number(body.limit)) ? Math.trunc(Number(body.limit)) : 200));
      query += ' LIMIT ?';
      params.push(limit);
      const [rows] = await pool.execute(query, params);
      return c.json({ data: rows, count: count ?? rows.length, error: null });
    }
    if (READ_ONLY_TABLES.has(table) || !memberships.every((m) => INTERNAL_ROLES.has(String(m.role)))) {
      return c.json({ message: 'این عملیات برای نقش فعلی مجاز نیست یا باید از مسیر عملیاتی انجام شود.' }, 403);
    }
    if (action !== 'insert' && !(Array.isArray(body.filters) && body.filters.length)) {
      return c.json({ message: 'برای ویرایش یا حذف باید فیلتر رکورد مشخص شود.' }, 422);
    }
    if (action === 'insert') {
      const input = Array.isArray(body.values) ? body.values : [body.values];
      if (!input.length || input.length > 100 || input.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
        return c.json({ message: 'رکورد ورودی معتبر نیست.' }, 422);
      }
      if (input.some((original) => !memberships.some((m) => m.company_id === String(original.company_id || '') && INTERNAL_ROLES.has(String(m.role))))) {
        return c.json({ message: 'این شرکت به حساب فعلی تعلق ندارد.' }, 403);
      }
      const inserted = [];
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        for (const original of input) {
        const companyId = typeof original.company_id === 'string' ? original.company_id : '';
        if (!memberships.some((m) => m.company_id === companyId && INTERNAL_ROLES.has(String(m.role)))) {
          throw new Error('Cross-company write');
        }
        const row = {};
        for (const [key, value] of Object.entries(original)) {
          if (!columns.has(key)) throw new Error('Unknown insert field');
          if (key === 'company_id') continue;
          if (PROTECTED_FIELDS.has(key)) continue;
          row[key] = value;
        }
        row.company_id = companyId;
        if (columns.has('id') && !row.id) row.id = randomUUID();
        if (columns.has('created_by')) row.created_by = session.user.id;
        const serverDefaults = {
          orders: { status: 'draft' },
          shipments: { stage: 'planned' },
          operational_tasks: { status: 'pending' },
          production_batches: { status: 'planned', quality_status: 'not_inspected', produced_quantity: 0, rejected_quantity: 0 },
          invoices: { status: 'draft', paid_amount: 0 },
          partner_financial_entries: { status: 'draft', submitted_by: null, submitted_at: null, approved_by: null, approved_at: null, posted_by: null, posted_at: null, paid_amount: 0 },
          capacity_commitments: { status: 'declared', confirmed_qty: null, committed_qty: null, evidence_review_status: 'pending_review', evidence_reviewed_by: null, evidence_reviewed_at: null, evidence_review_note: null },
        };
        for (const [key, value] of Object.entries(serverDefaults[table] || {})) if (columns.has(key)) row[key] = value;
        if (!Object.keys(row).length) throw new Error('Empty insert');
        const keys = Object.keys(row);
        await connection.execute(
          'INSERT INTO ' + sqlIdentifier(table) + ' (' + keys.map(sqlIdentifier).join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')',
          keys.map((key) => row[key]),
        );
        inserted.push({ id: row.id ?? null, ...row });
        }
        await connection.commit();
      } catch (insertError) {
        await connection.rollback().catch(() => undefined);
        throw insertError;
      } finally {
        connection.release();
      }
      return c.json({ data: inserted, count: inserted.length, error: null });
    }
    const values = [...scopeValues, ...filterValues, ...orValues];
    if (action === 'delete') {
      if (!memberships.every((m) => ['owner','admin'].includes(String(m.role)))) return c.json({ message: 'حذف رکورد فقط برای مالک یا مدیر مجاز است.' }, 403);
      const [result] = await pool.execute('DELETE FROM ' + sqlIdentifier(table) + where, values);
      return c.json({ data: [], count: result.affectedRows, error: null });
    }
    const original = body.values;
    if (!original || typeof original !== 'object' || Array.isArray(original)) return c.json({ message: 'مقادیر ویرایش معتبر نیست.' }, 422);
    const row = {};
    for (const [key, value] of Object.entries(original)) {
      if (!columns.has(key)) throw new Error('Unknown update field');
      if (PROTECTED_FIELDS.has(key) || TABLE_PROTECTED_FIELDS[table]?.has(key)) continue;
      row[key] = value;
    }
    const keys = Object.keys(row);
    if (!keys.length) return c.json({ message: 'هیچ فیلد قابل ویرایشی ارسال نشده است.' }, 422);
    const updateValues = [...keys.map((key) => row[key]), ...values];
    const [result] = await pool.execute(
      'UPDATE ' + sqlIdentifier(table) + ' SET ' + keys.map((key) => sqlIdentifier(key) + '=?').join(',') + where,
      updateValues,
    );
    return c.json({ data: [], count: result.affectedRows, error: null });
  } catch (error) {
    const message = error instanceof Error && /Invalid|Unsupported|Unknown|Empty/.test(error.message)
      ? 'فیلتر یا فیلد درخواست معتبر نیست.'
      : 'ذخیره‌سازی داده ناموفق بود؛ ورودی‌ها و دسترسی شرکت را بررسی کن.';
    return c.json({ message }, 422);
  }
});


const RPC_NAMES = new Set([
  'start_operational_task','submit_operational_task','review_operational_task',
  'create_partner_settlement_period','refresh_partner_settlement_period',
  'approve_partner_settlement_period','record_partner_settlement_payment',
]);
const RPC_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RPC_MONEY_FIELDS = [
  'invoiced_revenue','collected_revenue','recognized_revenue','approved_shared_expenses',
  'unpaid_approved_expenses','company_paid_shared_expenses','partner_paid_shared_expenses',
  'net_result','company_share_amount','partner_share_amount','balance_due_to_partner',
  'balance_due_to_company','recorded_cash_available',
];

function tehranDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateText(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function moneyInteger(value) {
  const text = String(value ?? '0');
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new Error('مبلغ مالی معتبر نیست.');
  return BigInt(text.split('.')[0]);
}

function percentBasisPoints(value) {
  const text = String(value ?? '0');
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('درصد مشارکت معتبر نیست.');
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0') || '0');
}

function roundedShare(amount, basisPoints) {
  const numerator = amount * basisPoints;
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((absolute + 5000n) / 10000n);
}

function serializeMoney(value) { return value.toString(); }

async function rpcManager(connection, companyId, userId, ownersOnly = false) {
  const roles = ownersOnly ? ['owner','admin'] : ['owner','admin','staff'];
  const [rows] = await connection.execute(
    'SELECT id FROM memberships WHERE company_id=? AND user_id=? AND active=TRUE AND role IN (' + roles.map(() => '?').join(',') + ') LIMIT 1',
    [companyId, userId, ...roles],
  );
  return rows.length > 0;
}

async function taskRpc(connection, name, args, userId) {
  const taskId = String(args._task || '');
  if (!RPC_UUID.test(taskId)) throw new Error('شناسه وظیفه معتبر نیست.');
  const [rows] = await connection.execute('SELECT * FROM operational_tasks WHERE id=? FOR UPDATE', [taskId]);
  const task = rows[0];
  if (!task) throw new Error('وظیفه پیدا نشد.');
  const manager = await rpcManager(connection, task.company_id, userId, false);
  let supplierAssigned = false;
  if (task.assignee_supplier_id) {
    const [supplierRows] = await connection.execute(
      "SELECT id FROM memberships WHERE company_id=? AND user_id=? AND active=TRUE AND role='supplier' AND supplier_id=? LIMIT 1",
      [task.company_id, userId, task.assignee_supplier_id],
    );
    supplierAssigned = supplierRows.length > 0;
  }
  const canExecute = manager || String(task.assignee_user_id || '') === userId || supplierAssigned;
  if (name === 'review_operational_task') {
    if (!manager) throw new Error('دسترسی مالک، مدیر یا کارمند مجاز لازم است.');
    if (task.status !== 'submitted') throw new Error('فقط وظیفه ارسال‌شده قابل بازبینی است.');
    const decision = String(args._decision || '');
    if (!['approved','rejected'].includes(decision)) throw new Error('تصمیم بازبینی نامعتبر است.');
    const note = String(args._review_note || '').trim();
    if (decision === 'rejected' && !note) throw new Error('برای رد وظیفه، دلیل و اقدام اصلاحی لازم است.');
    await connection.execute(
      'UPDATE operational_tasks SET status=?,reviewed_at=NOW(3),reviewed_by=?,review_note=?,updated_at=NOW(3) WHERE id=? AND company_id=?',
      [decision, userId, note || null, taskId, task.company_id],
    );
    return { ok: true };
  }
  if (!canExecute) throw new Error('این وظیفه به شما یا تأمین‌کننده شما واگذار نشده است.');
  if (name === 'start_operational_task') {
    if (!['pending','rejected','blocked'].includes(task.status)) throw new Error('فقط وظیفه در انتظار، ردشده یا رفع‌مسدودی‌شده قابل شروع است.');
    await connection.execute(
      "UPDATE operational_tasks SET status='in_progress',started_at=COALESCE(started_at,NOW(3)),updated_at=NOW(3) WHERE id=? AND company_id=?",
      [taskId, task.company_id],
    );
    return { ok: true };
  }
  if (!['pending','in_progress','rejected'].includes(task.status)) throw new Error('وضعیت فعلی اجازه ارسال پایان کار نمی‌دهد.');
  if (task.evidence_required) {
    const [evidence] = await connection.execute(
      "SELECT e.id FROM task_evidence e WHERE e.company_id=? AND e.task_id=? AND (" +
      "(e.evidence_type='note' AND CHAR_LENGTH(TRIM(COALESCE(e.note,'')))>0) OR " +
      "(e.evidence_type='measurement' AND e.measurement_value IS NOT NULL) OR " +
      "(e.evidence_type IN ('photo','document') AND e.storage_path LIKE CONCAT(?, '/', ?, '/%') AND EXISTS " +
      "(SELECT 1 FROM medar_files f WHERE f.bucket_id='operational-evidence' AND f.company_id=e.company_id AND f.name=e.storage_path))" +
      ') LIMIT 1',
      [task.company_id, taskId, task.company_id, taskId],
    );
    if (!evidence.length) throw new Error('برای تکمیل این وظیفه مدرک واقعی لازم است.');
  }
  const note = String(args._completion_note || '').trim().slice(0, 3000);
  await connection.execute(
    "UPDATE operational_tasks SET status='submitted',submitted_at=NOW(3),completion_note=?,updated_at=NOW(3) WHERE id=? AND company_id=?",
    [note || null, taskId, task.company_id],
  );
  return { ok: true };
}

async function settlementSnapshot(connection, agreementId, periodStart, periodEnd) {
  const [agreementRows] = await connection.execute('SELECT * FROM partnership_agreements WHERE id=? FOR UPDATE', [agreementId]);
  const agreement = agreementRows[0];
  if (!agreement) throw new Error('قرارداد مشارکت پیدا نشد.');
  if (periodStart < dateText(agreement.effective_from) ||
      (agreement.effective_to && periodEnd > dateText(agreement.effective_to))) {
    throw new Error('دوره باید در بازه اعتبار قرارداد باشد.');
  }
  const [entries] = await connection.execute(
    'SELECT e.*, target.entry_type AS target_entry_type, target.is_shared_cost AS target_is_shared_cost ' +
    'FROM partner_financial_entries e LEFT JOIN partner_financial_entries target ' +
    'ON target.company_id=e.company_id AND target.id=e.linked_entry_id AND target.supplier_id=e.supplier_id AND target.agreement_id=e.agreement_id ' +
    'WHERE e.company_id=? AND e.supplier_id=? AND e.agreement_id=? AND e.recognized_on BETWEEN ? AND ? ' +
    'ORDER BY e.recognized_on,e.created_at,e.id',
    [agreement.company_id, agreement.supplier_id, agreement.id, periodStart, periodEnd],
  );
  let invoiceTotal=0n, collectionTotal=0n, expenseTotal=0n, unpaidExpenseTotal=0n;
  let companyPaidTotal=0n, partnerPaidTotal=0n, companyAdvanceTotal=0n, partnerAdvanceTotal=0n, paidToPartnerTotal=0n, paidToCompanyTotal=0n;
  for (const entry of entries) {
    const amount=moneyInteger(entry.amount), paid=moneyInteger(entry.paid_amount);
    const posted=entry.status==='posted';
    const adjustmentSign=entry.adjustment_effect==='decrease'?-1n:1n;
    if (posted && entry.entry_type==='sale_invoice') invoiceTotal+=amount;
    if (posted && entry.entry_type==='adjustment' && entry.target_entry_type==='sale_invoice') invoiceTotal+=amount*adjustmentSign;
    if (posted && entry.entry_type==='sale_collection') collectionTotal+=amount;
    if (posted && entry.entry_type==='adjustment' && entry.target_entry_type==='sale_collection') collectionTotal+=amount*adjustmentSign;
    if (entry.entry_type==='expense' && entry.is_shared_cost && ['approved','posted'].includes(entry.status)) {
      expenseTotal+=amount;
      unpaidExpenseTotal+=amount-paid;
      if (entry.paid_by==='company') companyPaidTotal+=paid;
      if (entry.paid_by==='partner') partnerPaidTotal+=paid;
    }
    if (posted && entry.entry_type==='adjustment' && entry.target_entry_type==='expense' && entry.target_is_shared_cost) {
      expenseTotal+=amount*adjustmentSign;
      unpaidExpenseTotal+=amount*adjustmentSign;
    }
    if (posted && entry.entry_type==='partner_advance' && entry.direction==='company_to_partner') companyAdvanceTotal+=amount;
    if (posted && entry.entry_type==='partner_advance' && entry.direction==='partner_to_company') partnerAdvanceTotal+=amount;
    if (posted && entry.entry_type==='settlement_payment' && entry.direction==='company_to_partner') paidToPartnerTotal+=amount;
    if (posted && entry.entry_type==='settlement_payment' && entry.direction==='partner_to_company') paidToCompanyTotal+=amount;
  }
  if (expenseTotal<0n) expenseTotal=0n;
  if (unpaidExpenseTotal<0n) unpaidExpenseTotal=0n;
  const revenueUsed=String(agreement.settlement_basis)==='accrual'?invoiceTotal:collectionTotal;
  const netResult=revenueUsed-expenseTotal;
  const companyPct=percentBasisPoints(agreement.company_profit_share_pct);
  const partnerPct=percentBasisPoints(agreement.partner_profit_share_pct);
  const companyShare=roundedShare(netResult,companyPct);
  const partnerShare=roundedShare(netResult,partnerPct);
  let partnerBalance=partnerShare+partnerPaidTotal-roundedShare(expenseTotal,partnerPct)+partnerAdvanceTotal+paidToCompanyTotal-companyAdvanceTotal-paidToPartnerTotal;
  const companyBalance=partnerBalance<0n?-partnerBalance:0n;
  if(partnerBalance<0n)partnerBalance=0n;
  const cashAvailable=collectionTotal-companyPaidTotal-companyAdvanceTotal-paidToPartnerTotal+partnerAdvanceTotal+paidToCompanyTotal;
  const lines=entries.filter((entry)=>['approved','posted'].includes(entry.status)).map((entry)=>({
    id:entry.id,type:entry.entry_type,status:entry.status,amount:String(entry.amount),paid_amount:String(entry.paid_amount),
    currency:entry.currency,category:entry.expense_category,shared_cost:Boolean(entry.is_shared_cost),paid_by:entry.paid_by,
    date:dateText(entry.recognized_on),reference:entry.external_reference,source_table:entry.source_table,
    source_record_id:entry.source_record_id,linked_entry_id:entry.linked_entry_id,adjustment_effect:entry.adjustment_effect,notes:entry.notes,
  }));
  const snapshot={
    agreement_id:agreement.id,agreement_code:agreement.agreement_code,agreement_version:agreement.version,
    supplier_id:agreement.supplier_id,period_start:periodStart,period_end:periodEnd,settlement_basis:agreement.settlement_basis,
    currency:'TOMAN',company_profit_share_pct:String(agreement.company_profit_share_pct),partner_profit_share_pct:String(agreement.partner_profit_share_pct),
    invoiced_revenue:serializeMoney(invoiceTotal),collected_revenue:serializeMoney(collectionTotal),recognized_revenue:serializeMoney(revenueUsed),
    approved_shared_expenses:serializeMoney(expenseTotal),unpaid_approved_expenses:serializeMoney(unpaidExpenseTotal),
    company_paid_shared_expenses:serializeMoney(companyPaidTotal),partner_paid_shared_expenses:serializeMoney(partnerPaidTotal),
    net_result:serializeMoney(netResult),company_share_amount:serializeMoney(companyShare),partner_share_amount:serializeMoney(partnerShare),
    balance_due_to_partner:serializeMoney(partnerBalance),balance_due_to_company:serializeMoney(companyBalance),
    recorded_cash_available:serializeMoney(cashAvailable),
    cash_note:'این عدد فقط از اسناد ثبت‌شده محاسبه می‌شود و موجودی بانکی را تأیید نمی‌کند.',
    entries:lines,calculated_at:new Date().toISOString(),
  };
  return { agreement, snapshot };
}

async function saveSettlementSnapshot(connection, periodId, snapshot) {
  const values = RPC_MONEY_FIELDS.map((field)=>snapshot[field]);
  await connection.execute(
    'UPDATE partner_settlement_periods SET invoiced_revenue=?,collected_revenue=?,recognized_revenue=?,approved_shared_expenses=?,unpaid_approved_expenses=?,company_paid_shared_expenses=?,partner_paid_shared_expenses=?,net_result=?,company_share_amount=?,partner_share_amount=?,balance_due_to_partner=?,balance_due_to_company=?,recorded_cash_available=?,calculation_snapshot=?,calculated_at=NOW(3),updated_at=NOW(3) WHERE id=?',
    [...values,JSON.stringify(snapshot),periodId],
  );
}

async function settlementRpc(connection, name, args, userId) {
  if (name==='create_partner_settlement_period') {
    const agreementId=String(args._agreement||''), start=String(args._period_start||''), end=String(args._period_end||'');
    if(!RPC_UUID.test(agreementId)||!validIsoDate(start)||!validIsoDate(end)||end<start) throw new Error('قرارداد و بازه تاریخ معتبر لازم است.');
    if(end>tehranDate()) throw new Error('دوره تسویه آینده قابل ایجاد نیست.');
    const [agreements]=await connection.execute('SELECT * FROM partnership_agreements WHERE id=? FOR UPDATE',[agreementId]);
    const agreement=agreements[0];
    if(!agreement) throw new Error('قرارداد مشارکت پیدا نشد.');
    if(!await rpcManager(connection,agreement.company_id,userId,true)) throw new Error('ایجاد دوره فقط برای مالک یا مدیر مجاز است.');
    if(!['active','suspended','expired','terminated'].includes(agreement.status)) throw new Error('قرارداد باید امضا و تأیید شده باشد.');
    const [overlaps]=await connection.execute(
      "SELECT id FROM partner_settlement_periods WHERE company_id=? AND agreement_id=? AND status<>'cancelled' AND period_start<=? AND period_end>=? LIMIT 1",
      [agreement.company_id,agreement.id,end,start],
    );
    if(overlaps.length) throw new Error('این بازه با یک دوره تسویه موجود هم‌پوشانی دارد.');
    const {snapshot}=await settlementSnapshot(connection,agreementId,start,end);
    const id=randomUUID();
    const values=RPC_MONEY_FIELDS.map((field)=>snapshot[field]);
    await connection.execute(
      'INSERT INTO partner_settlement_periods (id,company_id,supplier_id,agreement_id,period_start,period_end,status,currency,'+
      RPC_MONEY_FIELDS.join(',')+',calculation_snapshot,calculated_at,created_by) VALUES (?,?,?,?,?,?,\'draft\',\'TOMAN\','+
      values.map(()=>'?').join(',')+',?,NOW(3),?)',
      [id,agreement.company_id,agreement.supplier_id,agreement.id,start,end,...values,JSON.stringify(snapshot),userId],
    );
    return { id };
  }
  const periodId=String(args._period||'');
  if(!RPC_UUID.test(periodId)) throw new Error('شناسه دوره تسویه معتبر نیست.');
  const [periodRows]=await connection.execute('SELECT * FROM partner_settlement_periods WHERE id=? FOR UPDATE',[periodId]);
  const period=periodRows[0];
  if(!period) throw new Error('دوره تسویه پیدا نشد.');
  if(!await rpcManager(connection,period.company_id,userId,true)) throw new Error('این عملیات فقط برای مالک یا مدیر مجاز است.');
  if(name==='refresh_partner_settlement_period'||name==='approve_partner_settlement_period') {
    if(period.status!=='draft') throw new Error('فقط دوره پیش‌نویس قابل بازمحاسبه یا تأیید است.');
    const {snapshot}=await settlementSnapshot(connection,period.agreement_id,dateText(period.period_start),dateText(period.period_end));
    await saveSettlementSnapshot(connection,period.id,snapshot);
    if(name==='approve_partner_settlement_period') {
      await connection.execute("UPDATE partner_settlement_periods SET status='approved',approved_by=?,approved_at=NOW(3),updated_at=NOW(3) WHERE id=?",[userId,period.id]);
    }
    return { ok:true };
  }
  if(name==='record_partner_settlement_payment') {
    if(!['approved','settled'].includes(period.status)) throw new Error('دوره باید قبل از ثبت پرداخت تأیید شده باشد.');
    const amountText=String(args._amount??'');
    if(!/^\d+$/.test(amountText)||BigInt(amountText)<=0n||BigInt(amountText)>9999999999999999n) throw new Error('مبلغ پرداخت باید یک عدد صحیح مثبت به تومان باشد.');
    const amount=BigInt(amountText), due=moneyInteger(period.balance_due_to_partner), settled=moneyInteger(period.settled_amount), cash=moneyInteger(period.recorded_cash_available);
    if(due<=0n) throw new Error('این دوره مبلغی برای پرداخت به شریک ندارد.');
    if(amount>due-settled) throw new Error('مبلغ پرداخت بیشتر از مانده دوره است.');
    if(amount>cash-settled) throw new Error('مبلغ پرداخت از وجه نقد محاسبه‌شده در اسناد دوره بیشتر است.');
    const reference=String(args._payment_reference||'').trim().slice(0,160);
    if(!reference) throw new Error('مرجع پرداخت واقعی لازم است.');
    const id=randomUUID();
    await connection.execute(
      "INSERT INTO partner_financial_entries (id,company_id,supplier_id,agreement_id,entry_type,status,direction,amount,paid_amount,currency,paid_by,payment_status,recognized_on,external_reference,source_table,source_record_id,notes,created_by,submitted_by,submitted_at,approved_by,approved_at,posted_by,posted_at) VALUES (?,?,?,?,'settlement_payment','posted','company_to_partner',?,?,?,'company','paid',?,?, 'partner_settlement_periods',?,'پرداخت توسط مدیر ثبت و تأیید شده؛ انتقال بانکی توسط سامانه اجرا نمی‌شود.',?, ?,NOW(3),?,NOW(3),?,NOW(3))",
      [id,period.company_id,period.supplier_id,period.agreement_id,amountText,amountText,period.currency,tehranDate(),reference,period.id,userId,userId,userId,userId],
    );
    const newSettled=settled+amount;
    const completed=newSettled>=due;
    await connection.execute(
      'UPDATE partner_settlement_periods SET settled_amount=?,status=?,settled_at=?,settled_by=?,updated_at=NOW(3) WHERE id=?',
      [newSettled.toString(),completed?'settled':'approved',completed?new Date():null,completed?userId:null,period.id],
    );
    return { ok:true };
  }
  throw new Error('عملیات تسویه شناخته نشد.');
}

app.post('/api/rpc/:name', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session=await currentSession(c);
  if(!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const name=c.req.param('name');
  if(!RPC_NAMES.has(name)) return c.json({ message: 'این عملیات در API داخلی هنوز پیاده‌سازی نشده است.' }, 501);
  const body=await c.req.json().catch(()=>null);
  const args=body&&typeof body==='object'&&!Array.isArray(body)&&body.args&&typeof body.args==='object'&&!Array.isArray(body.args)?body.args:{};
  const connection=await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result=name.endsWith('_operational_task')
      ? await taskRpc(connection,name,args,session.user.id)
      : await settlementRpc(connection,name,args,session.user.id);
    await connection.commit();
    return c.json({ data: result, error: null });
  } catch(error) {
    await connection.rollback().catch(()=>undefined);
    const message=error instanceof Error?error.message:'اجرای عملیات ناموفق بود.';
    return c.json({ message, error: { message } }, 422);
  } finally {
    connection.release();
  }
});


const STORAGE_ROOT = resolve(process.env.MEDAR_STORAGE_DIR || './storage/medar');
const STORAGE_BUCKETS = new Set(['delivery-evidence','operational-evidence','contract-documents','capacity-evidence']);
const STORAGE_MIME_TYPES = new Set(['image/jpeg','image/png','image/webp','application/pdf','video/mp4','video/webm']);
function matchesStorageMimeType(contentType, bytes) {
  if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (contentType === 'application/pdf') return bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-';
  if (contentType === 'video/mp4') return bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
  if (contentType === 'video/webm') return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}
function storagePath(bucket, name) {
  if (!STORAGE_BUCKETS.has(bucket) || typeof name !== 'string' || name.length < 40 || name.length > 1000 ||
      name.includes('\\\\') || name.includes('\\0') || name.startsWith('/') || name.endsWith('/')) {
    throw new Error('مسیر فایل معتبر نیست.');
  }
  const segments = name.split('/');
  if (segments.length < 2 || segments.some((part) => !part || part === '.' || part === '..' || !/^[a-zA-Z0-9._-]+$/.test(part))) {
    throw new Error('مسیر فایل معتبر نیست.');
  }
  if (!RPC_UUID.test(segments[0])) throw new Error('مسیر فایل باید با شناسه شرکت شروع شود.');
  const file = resolve(STORAGE_ROOT, bucket, ...segments);
  if (file !== STORAGE_ROOT && !file.startsWith(STORAGE_ROOT + sep)) throw new Error('مسیر فایل خارج از فضای مجاز است.');
  return { segments, companyId: segments[0], file };
}

async function storageAccess(connection, session, bucket, parsed) {
  const memberships = await membershipsFor(session.user.id);
  const membership = memberships.find((item) => String(item.company_id) === parsed.companyId && item.active);
  if (!membership) return { allowed: false, manager: false, membership: null };
  const role = String(membership.role);
  const manager = ['owner','admin','staff'].includes(role);
  if (manager) {
    if (bucket === 'delivery-evidence') {
      const [rows] = await connection.execute('SELECT id FROM shipments WHERE company_id=? AND id=? LIMIT 1', [parsed.companyId, parsed.segments[1]]);
      if (!rows.length) return { allowed: false, manager, membership };
    } else if (bucket === 'operational-evidence') {
      const [rows] = await connection.execute('SELECT id FROM operational_tasks WHERE company_id=? AND id=? LIMIT 1', [parsed.companyId, parsed.segments[1]]);
      if (!rows.length) return { allowed: false, manager, membership };
    } else if (bucket === 'capacity-evidence') {
      const [rows] = await connection.execute('SELECT id FROM suppliers WHERE company_id=? AND id=? LIMIT 1', [parsed.companyId, parsed.segments[1]]);
      if (!rows.length) return { allowed: false, manager, membership };
    }
    return { allowed: true, manager, membership };
  }
  if (bucket === 'capacity-evidence' && role === 'supplier' &&
      String(membership.supplier_id || '') === parsed.segments[1] &&
      parsed.segments[2]?.startsWith('capacity-')) {
    return { allowed: true, manager, membership };
  }
  if (bucket === 'operational-evidence') {
    const [rows] = await connection.execute('SELECT assignee_user_id,assignee_supplier_id FROM operational_tasks WHERE company_id=? AND id=? LIMIT 1', [parsed.companyId, parsed.segments[1]]);
    const task = rows[0];
    if (task && (String(task.assignee_user_id || '') === String(session.user.id) ||
      (role === 'supplier' && String(task.assignee_supplier_id || '') === String(membership.supplier_id || '')))) {
      return { allowed: true, manager, membership };
    }
  }
  if (bucket === 'delivery-evidence' && role === 'driver') {
    const [rows] = await connection.execute('SELECT id FROM shipments WHERE company_id=? AND id=? AND driver_user_id=? LIMIT 1', [parsed.companyId, parsed.segments[1], session.user.id]);
    if (rows.length) return { allowed: true, manager, membership };
  }
  return { allowed: false, manager, membership };
}

async function fileReferenceExists(connection, bucket, companyId, name) {
  const checks = {
    'delivery-evidence': ['delivery_evidence','storage_path'],
    'operational-evidence': ['task_evidence','storage_path'],
    'capacity-evidence': ['capacity_commitments','evidence_path'],
    'contract-documents': ['partnership_agreements','signed_document_path'],
  };
  const [table, column] = checks[bucket] || [];
  if (!table) return false;
  const [rows] = await connection.execute(
    'SELECT id FROM ' + sqlIdentifier(table) + ' WHERE company_id=? AND ' + sqlIdentifier(column) + '=? LIMIT 1',
    [companyId, name],
  );
  return rows.length > 0;
}

app.put('/api/storage/:bucket', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای بارگذاری فایل وارد حساب شو.' }, 401);
  const bucket = c.req.param('bucket');
  const name = c.req.query('path') || '';
  const contentType = (c.req.header('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!STORAGE_MIME_TYPES.has(contentType)) return c.json({ message: 'نوع فایل در فضای مدار مجاز نیست.' }, 415);
  const bytes = Buffer.from(await c.req.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) return c.json({ message: 'حجم فایل باید کمتر از ۲۰ مگابایت و بیشتر از صفر باشد.' }, 413);
  if (!matchesStorageMimeType(contentType, bytes)) return c.json({ message: 'محتوای فایل با نوع اعلام‌شده مطابقت ندارد.' }, 415);
  let parsed;
  try { parsed = storagePath(bucket, name); } catch (error) { return c.json({ message: error.message }, 422); }
  if ((bucket === 'contract-documents' && contentType.startsWith('video/')) ||
      (bucket === 'capacity-evidence' && contentType.startsWith('video/'))) {
    return c.json({ message: 'ویدئو برای این نوع مدرک مجاز نیست.' }, 415);
  }
  const connection = await pool.getConnection();
  const lockName = 'medar:' + sha256(bucket + ':' + name).slice(0, 58);
  let tempFile = '';
  let backupFile = '';
  let finalFile = parsed.file;
  let movedOriginal = false;
  let movedNew = false;
  let lockAcquired = false;
  try {
    const [locks] = await connection.execute('SELECT GET_LOCK(?,5) AS acquired', [lockName]);
    lockAcquired = Number(locks[0]?.acquired) === 1;
    if (!lockAcquired) return c.json({ message: 'این فایل هم‌زمان در حال تغییر است؛ دوباره تلاش کن.' }, 409);
    const access = await storageAccess(connection, session, bucket, parsed, 'upload');
    if (!access.allowed) return c.json({ message: 'برای این مسیر فایل دسترسی نداری.' }, 403);
    await mkdir(dirname(finalFile), { recursive: true });
    tempFile = finalFile + '.' + randomUUID() + '.tmp';
    backupFile = finalFile + '.' + randomUUID() + '.bak';
    await writeFile(tempFile, bytes, { flag: 'wx', mode: 0o600 });
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT id FROM medar_files WHERE bucket_id=? AND name=? FOR UPDATE', [bucket, name]);
    const upsert = c.req.header('x-upsert') === 'true';
    if (existing.length && !upsert) {
      await connection.rollback();
      await rm(tempFile, { force: true });
      return c.json({ message: 'فایلی با همین مسیر از قبل وجود دارد.' }, 409);
    }
    try {
      await rename(finalFile, backupFile);
      movedOriginal = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await rename(tempFile, finalFile);
    movedNew = true;
    await connection.execute(
      'INSERT INTO medar_files (id,bucket_id,name,company_id,content_type,size_bytes,uploaded_by,content_base64) VALUES (?,?,?,?,?,?,?,NULL) ' +
      'ON DUPLICATE KEY UPDATE content_type=VALUES(content_type),size_bytes=VALUES(size_bytes),uploaded_by=VALUES(uploaded_by),created_at=NOW(3),content_base64=NULL',
      [randomUUID(), bucket, name, parsed.companyId, contentType, bytes.length, session.user.id],
    );
    await connection.commit();
    if (movedOriginal) await rm(backupFile, { force: true });
    return c.json({ data: { path: name, size: bytes.length, contentType }, error: null });
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    if (movedNew) await rm(finalFile, { force: true }).catch(() => undefined);
    if (movedOriginal) await rename(backupFile, finalFile).catch(() => undefined);
    if (tempFile) await rm(tempFile, { force: true }).catch(() => undefined);
    console.error('[medar-storage] upload failed: ' + (error instanceof Error ? error.message : 'unknown error'));
    return c.json({ message: 'ذخیره فایل انجام نشد؛ فضای دیسک و پایگاه داده را بررسی کن.' }, 500);
  } finally {
    if (lockAcquired) await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined);
    connection.release();
  }
});

app.get('/api/storage/:bucket', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای مشاهده فایل وارد حساب شو.' }, 401);
  const bucket = c.req.param('bucket');
  const name = c.req.query('path') || '';
  let parsed;
  try { parsed = storagePath(bucket, name); } catch { return c.json({ message: 'مسیر فایل معتبر نیست.' }, 422); }
  const connection = await pool.getConnection();
  try {
    const access = await storageAccess(connection, session, bucket, parsed, 'read');
    if (!access.allowed) return c.json({ message: 'برای مشاهده این فایل دسترسی نداری.' }, 403);
    const [rows] = await connection.execute('SELECT content_type,size_bytes,content_base64 FROM medar_files WHERE bucket_id=? AND name=? AND company_id=? LIMIT 1', [bucket, name, parsed.companyId]);
    const metadata = rows[0];
    if (!metadata) return c.json({ message: 'فایل پیدا نشد.' }, 404);
    let bytes;
    if (metadata.content_base64) bytes = Buffer.from(metadata.content_base64, 'base64');
    else {
      try { bytes = await readFile(parsed.file); }
      catch { return c.json({ message: 'فایل ثبت شده اما محتوای آن روی فضای ذخیره‌سازی پیدا نشد.' }, 404); }
    }
    const headers = {
      'content-type': metadata.content_type,
      'content-length': String(bytes.length),
      'cache-control': 'private, no-store',
      'accept-ranges': 'bytes',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    };
    const range = c.req.header('range');
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const match = range.match(/^bytes=(\d*)-(\d*)$/);
      const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2] || 0));
      const end = match[2] ? Math.min(bytes.length - 1, Number(match[2])) : bytes.length - 1;
      if (start < 0 || end < start || start >= bytes.length) {
        return new Response(null, { status: 416, headers: { ...headers, 'content-range': 'bytes */' + bytes.length } });
      }
      const slice = bytes.subarray(start, end + 1);
      headers['content-length'] = String(slice.length);
      headers['content-range'] = 'bytes ' + start + '-' + end + '/' + bytes.length;
      return c.body(slice, 206, headers);
    }
    return c.body(bytes, 200, headers);
  } finally {
    connection.release();
  }
});

app.post('/api/storage/:bucket/remove', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای حذف فایل وارد حساب شو.' }, 401);
  const bucket = c.req.param('bucket');
  if (!STORAGE_BUCKETS.has(bucket)) return c.json({ message: 'مخزن فایل معتبر نیست.' }, 404);
  const body = await c.req.json().catch(() => null);
  const paths = Array.isArray(body?.paths) ? body.paths : [];
  if (!paths.length || paths.length > 100 || paths.some((path) => typeof path !== 'string')) return c.json({ message: 'فهرست فایل‌ها معتبر نیست.' }, 422);
  const connection = await pool.getConnection();
  const removed = [];
  const filesToRemove = [];
  try {
    await connection.beginTransaction();
    for (const name of paths) {
      let parsed;
      try { parsed = storagePath(bucket, name); } catch { throw new Error('مسیر فایل معتبر نیست.'); }
      const access = await storageAccess(connection, session, bucket, parsed, 'remove');
      const [rows] = await connection.execute('SELECT id,uploaded_by FROM medar_files WHERE bucket_id=? AND name=? AND company_id=? FOR UPDATE', [bucket, name, parsed.companyId]);
      if (!rows.length) continue;
      const file = rows[0];
      if (!access.allowed || (!access.manager && String(file.uploaded_by || '') !== String(session.user.id))) {
        throw new Error('برای حذف این فایل دسترسی نداری.');
      }
      if (!access.manager && await fileReferenceExists(connection, bucket, parsed.companyId, name)) {
        throw new Error('فایل متصل به یک رکورد عملیاتی است و باید از مسیر مدیریتی حذف شود.');
      }
      await connection.execute('DELETE FROM medar_files WHERE id=?', [file.id]);
      filesToRemove.push(parsed.file);
      removed.push(name);
    }
    await connection.commit();
    for (const file of filesToRemove) await rm(file, { force: true }).catch(() => undefined);
    return c.json({ data: removed, error: null });
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    return c.json({ message: error instanceof Error ? error.message : 'حذف فایل ناموفق بود.' }, 422);
  } finally {
    connection.release();
  }
});


const DOMESTIC_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOMESTIC_EVENT_SOURCE_TABLES = {
  order: 'orders', purchase_order: 'purchase_orders', task: 'operational_tasks',
  shipment: 'shipments', invoice: 'invoices', inventory: 'inventory_movements',
  production: 'production_batches', quality: 'quality_reviews', supplier: 'suppliers',
};

async function domesticMembership(userId, companyId) {
  const [rows] = await pool.execute(
    'SELECT id, company_id, user_id, role, active FROM memberships WHERE user_id=? AND company_id=? AND active=TRUE LIMIT 1',
    [userId, companyId],
  );
  return rows[0] || null;
}

async function domesticModuleAllowed(membership, moduleKey, capability) {
  if (!membership) return false;
  if (membership.role === 'owner' || membership.role === 'admin') return true;
  const allowedCapabilities = new Set(['can_read', 'can_create', 'can_update', 'can_delete', 'can_approve']);
  if (!allowedCapabilities.has(capability)) return false;
  const [rows] = await pool.execute(
    'SELECT inherit_role_defaults, can_read, can_create, can_update, can_delete, can_approve FROM medar_membership_module_permissions WHERE company_id=? AND membership_id=? AND module_key=? LIMIT 1',
    [membership.company_id, membership.id, moduleKey],
  );
  const policy = rows[0];
  if (!policy || Boolean(policy.inherit_role_defaults)) return capability !== 'can_delete' && capability !== 'can_approve';
  return Boolean(policy[capability]);
}

function domesticJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch { /* reject malformed persisted JSON by returning a safe empty object */ }
  }
  return fallback;
}

function domesticEventRow(row) {
  return {
    id: String(row.id), companyId: String(row.company_id), eventType: String(row.event_type),
    severity: String(row.severity), sourceType: String(row.source_type),
    sourceId: row.source_id ? String(row.source_id) : null,
    title: String(row.title), body: String(row.body || ''),
    payload: domesticJson(row.payload), occurredAt: row.occurred_at,
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    actorUsername: row.actor_username || null,
  };
}

function domesticExceptionRow(row) {
  return {
    id: String(row.id), eventId: row.event_id ? String(row.event_id) : null,
    title: String(row.title), details: String(row.details || ''), severity: String(row.severity),
    status: String(row.status), assignedUserId: row.assigned_user_id ? String(row.assigned_user_id) : null,
    assignedUsername: row.assigned_username || null, dueAt: row.due_at || null,
    acknowledgedAt: row.acknowledged_at || null, resolvedAt: row.resolved_at || null,
    resolvedBy: row.resolved_by ? String(row.resolved_by) : null,
    resolutionNote: row.resolution_note || null, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

app.get('/api/notifications', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const companyId = c.req.query('companyId') || '';
  if (!DOMESTIC_UUID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await domesticMembership(session.user.id, companyId);
  if (!membership || !(await domesticModuleAllowed(membership, 'home', 'can_read'))) {
    return c.json({ message: 'برای مشاهده اعلان‌ها مجوز نداری.' }, 403);
  }
  const [rows] = await pool.execute(
    'SELECT id,title,body,href,read_at,created_at FROM notifications WHERE company_id=? AND user_id=? ORDER BY created_at DESC LIMIT 30',
    [companyId, session.user.id],
  );
  const [[summary]] = await pool.execute(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM notifications WHERE company_id=? AND user_id=?',
    [companyId, session.user.id],
  );
  return c.json({
    notifications: rows.map(row => ({ id: String(row.id), title: row.title, body: row.body, href: row.href, readAt: row.read_at, createdAt: row.created_at })),
    summary: { total: Number(summary.total || 0), unread: Number(summary.unread || 0) },
  });
});

app.post('/api/notifications/read-all', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const body = await c.req.json().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  if (!DOMESTIC_UUID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await domesticMembership(session.user.id, companyId);
  if (!membership || !(await domesticModuleAllowed(membership, 'home', 'can_update'))) {
    return c.json({ message: 'مجوز ثبت وضعیت خوانده‌شدن اعلان را نداری.' }, 403);
  }
  const [result] = await pool.execute(
    'UPDATE notifications SET read_at=COALESCE(read_at,NOW(3)) WHERE company_id=? AND user_id=? AND read_at IS NULL',
    [companyId, session.user.id],
  );
  return c.json({ ok: true, updated: Number(result.affectedRows || 0) });
});

app.post('/api/notifications/:id/read', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const notificationId = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  if (!DOMESTIC_UUID_RE.test(companyId) || !DOMESTIC_UUID_RE.test(notificationId)) {
    return c.json({ message: 'شناسه اعلان یا مجموعه معتبر نیست.' }, 422);
  }
  const membership = await domesticMembership(session.user.id, companyId);
  if (!membership || !(await domesticModuleAllowed(membership, 'home', 'can_update'))) {
    return c.json({ message: 'مجوز ثبت وضعیت خوانده‌شدن اعلان را نداری.' }, 403);
  }
  const [result] = await pool.execute(
    'UPDATE notifications SET read_at=COALESCE(read_at,NOW(3)) WHERE id=? AND company_id=? AND user_id=?',
    [notificationId, companyId, session.user.id],
  );
  if (!result.affectedRows) return c.json({ message: 'اعلان در حساب فعلی پیدا نشد.' }, 404);
  const [[row]] = await pool.execute(
    'SELECT id,read_at FROM notifications WHERE id=? AND company_id=? AND user_id=? LIMIT 1',
    [notificationId, companyId, session.user.id],
  );
  return c.json({ ok: true, notification: { id: String(row.id), readAt: row.read_at } });
});

app.post('/api/client/heartbeat', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const body = await c.req.json().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const clientId = typeof body?.clientId === 'string' ? body.clientId : '';
  const platform = body?.platform;
  const appVersion = typeof body?.appVersion === 'string' ? body.appVersion.trim() : '';
  if (!DOMESTIC_UUID_RE.test(companyId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId) ||
      !['web','android','ios'].includes(platform) || appVersion.length < 1 || appVersion.length > 40 ||
      Array.from(appVersion).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    return c.json({ message: 'اطلاعات وضعیت دستگاه معتبر نیست.' }, 422);
  }
  const membership = await domesticMembership(session.user.id, companyId);
  if (!membership) return c.json({ message: 'این حساب به مجموعه انتخاب‌شده دسترسی فعال ندارد.' }, 403);
  await pool.execute(
    'INSERT INTO medar_client_presence(company_id,user_id,client_id,platform,app_version) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE platform=VALUES(platform),app_version=VALUES(app_version),last_seen_at=NOW(3)',
    [companyId, session.user.id, clientId, platform, appVersion],
  );
  const [[row]] = await pool.execute(
    'SELECT last_seen_at FROM medar_client_presence WHERE company_id=? AND user_id=? AND client_id=? LIMIT 1',
    [companyId, session.user.id, clientId],
  );
  return c.json({ ok: true, lastSeenAt: row.last_seen_at });
});

app.get('/api/operational/events', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const companyId = c.req.query('companyId') || '';
  if (!DOMESTIC_UUID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await domesticMembership(session.user.id, companyId);
  if (!membership || !(await domesticModuleAllowed(membership, 'operational-tasks', 'can_read'))) {
    return c.json({ message: 'برای مشاهده رویدادها مجوز نداری.' }, 403);
  }
  const [rows] = await pool.execute(
    'SELECT e.id,e.company_id,e.event_type,e.severity,e.source_type,e.source_id,e.title,e.body,e.payload,e.occurred_at,e.actor_user_id,u.username AS actor_username FROM medar_operational_events e LEFT JOIN medar_users u ON u.id=e.actor_user_id WHERE e.company_id=? ORDER BY e.occurred_at DESC LIMIT 100',
    [companyId],
  );
  return c.json({ events: rows.map(domesticEventRow) });
});

app.post('/api/operational/events', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ message: 'درخواست رویداد معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!DOMESTIC_UUID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await domesticMembership(session.user.id, companyId);
  if (!membership || !INTERNAL_ROLES.has(String(membership.role)) || !(await domesticModuleAllowed(membership, 'operational-tasks', 'can_create'))) {
    return c.json({ message: 'برای ثبت رویداد عملیاتی مجوز نداری.' }, 403);
  }
  const eventType = typeof body.eventType === 'string' ? body.eventType.trim() : '';
  const severity = typeof body.severity === 'string' ? body.severity : 'info';
  const sourceType = typeof body.sourceType === 'string' ? body.sourceType : 'system';
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.body === 'string' ? body.body.trim() : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
  const sourceTypes = new Set(['order','purchase_order','task','shipment','invoice','inventory','production','quality','supplier','system','other']);
  if (!/^[a-z][a-z0-9_.-]{1,79}$/.test(eventType) || !['info','warning','critical'].includes(severity) ||
      !sourceTypes.has(sourceType) || title.length < 2 || title.length > 180 || description.length > 4000 ||
      (sourceId && !DOMESTIC_UUID_RE.test(sourceId)) || (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 240))) {
    return c.json({ message: 'اطلاعات رویداد معتبر نیست.' }, 422);
  }
  if (sourceId) {
    const table = DOMESTIC_EVENT_SOURCE_TABLES[sourceType];
    if (!table) return c.json({ message: 'این نوع رویداد نمی‌تواند به رکورد عملیاتی متصل شود.' }, 422);
    const [found] = await pool.execute('SELECT 1 FROM ' + sqlIdentifier(table) + ' WHERE id=? AND company_id=? LIMIT 1', [sourceId, companyId]);
    if (!found.length) return c.json({ message: 'رکورد مرتبط در این شرکت پیدا نشد.' }, 404);
  }
  const connection = await pool.getConnection();
  let event;
  try {
    await connection.beginTransaction();
    const newId = randomUUID();
    if (idempotencyKey) {
      await connection.execute(
        'INSERT INTO medar_operational_events(id,company_id,actor_user_id,event_type,severity,source_type,source_id,title,body,payload,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE idempotency_key=VALUES(idempotency_key)',
        [newId,companyId,session.user.id,eventType,severity,sourceType,sourceId || null,title,description,JSON.stringify(payload),idempotencyKey],
      );
      const [rows] = await connection.execute(
        'SELECT id,company_id,event_type,severity,source_type,source_id,title,body,payload,occurred_at,actor_user_id FROM medar_operational_events WHERE company_id=? AND idempotency_key=? LIMIT 1',
        [companyId,idempotencyKey],
      );
      event = rows[0];
    } else {
      await connection.execute(
        'INSERT INTO medar_operational_events(id,company_id,actor_user_id,event_type,severity,source_type,source_id,title,body,payload) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [newId,companyId,session.user.id,eventType,severity,sourceType,sourceId || null,title,description,JSON.stringify(payload)],
      );
      const [rows] = await connection.execute(
        'SELECT id,company_id,event_type,severity,source_type,source_id,title,body,payload,occurred_at,actor_user_id FROM medar_operational_events WHERE id=? AND company_id=? LIMIT 1',
        [newId,companyId],
      );
      event = rows[0];
    }
    if ((severity === 'warning' || severity === 'critical' || body.createException === true) && event) {
      const dedupeKey = idempotencyKey ? 'event:' + idempotencyKey : '';
      const exceptionId = randomUUID();
      if (dedupeKey) {
        await connection.execute(
          'INSERT INTO medar_exception_cases(id,company_id,event_id,title,details,severity,created_by,dedupe_key) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE updated_at=NOW(3)',
          [exceptionId,companyId,event.id,title,description,severity === 'critical' ? 'critical' : 'warning',session.user.id,dedupeKey],
        );
      } else {
        await connection.execute(
          'INSERT INTO medar_exception_cases(id,company_id,event_id,title,details,severity,created_by) VALUES(?,?,?,?,?,?,?)',
          [exceptionId,companyId,event.id,title,description,severity === 'critical' ? 'critical' : 'warning',session.user.id],
        );
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    console.error('Domestic operational event write failed', { code: typeof error?.code === 'string' ? error.code : 'unknown' });
    return c.json({ message: 'ثبت رویداد عملیاتی کامل نشد.' }, 500);
  } finally { connection.release(); }
  return c.json({ ok: true, event: domesticEventRow(event) }, 201);
});

app.get('/api/operational/exceptions', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const companyId = c.req.query('companyId') || '';
  if (!DOMESTIC_UUID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await domesticMembership(session.user.id, companyId);
  if (!membership || !INTERNAL_ROLES.has(String(membership.role)) || !(await domesticModuleAllowed(membership, 'operational-tasks', 'can_read'))) {
    return c.json({ message: 'برای مشاهده صندوق استثناها مجوز نداری.' }, 403);
  }
  const status = c.req.query('status') || '';
  if (status && !['open','acknowledged','in_progress','resolved','closed'].includes(status)) {
    return c.json({ message: 'وضعیت مسئله معتبر نیست.' }, 422);
  }
  const [rows] = await pool.execute(
    'SELECT x.id,x.event_id,x.title,x.details,x.severity,x.status,x.assigned_user_id,u.username AS assigned_username,x.due_at,x.acknowledged_at,x.resolved_at,x.resolved_by,x.resolution_note,x.created_at,x.updated_at FROM medar_exception_cases x LEFT JOIN medar_users u ON u.id=x.assigned_user_id WHERE x.company_id=? AND (? = \\'\\' OR x.status=?) ORDER BY CASE x.severity WHEN \\'critical\\' THEN 0 ELSE 1 END,(x.due_at IS NULL) ASC,x.due_at ASC,x.created_at DESC LIMIT 100',
    [companyId,status,status],
  );
  return c.json({ exceptions: rows.map(domesticExceptionRow) });
});

app.post('/api/operational/exceptions', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ message: 'درخواست ایجاد مسئله معتبر نیست.' }, 400);
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!DOMESTIC_UUID_RE.test(companyId)) return c.json({ message: 'شناسه مجموعه معتبر نیست.' }, 422);
  const membership = await domesticMembership(session.user.id, companyId);
  if (!membership || !INTERNAL_ROLES.has(String(membership.role)) || !(await domesticModuleAllowed(membership, 'operational-tasks', 'can_create'))) {
    return c.json({ message: 'برای ایجاد مسئله عملیاتی مجوز نداری.' }, 403);
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const details = typeof body.details === 'string' ? body.details.trim() : '';
  const severity = typeof body.severity === 'string' ? body.severity : 'warning';
  const eventId = typeof body.eventId === 'string' ? body.eventId : '';
  const assignedUserId = typeof body.assignedUserId === 'string' ? body.assignedUserId : '';
  const dueAt = typeof body.dueAt === 'string' ? body.dueAt : '';
  const dedupeKey = typeof body.dedupeKey === 'string' ? body.dedupeKey.trim() : '';
  if (title.length < 2 || title.length > 180 || details.length > 4000 || !['warning','critical'].includes(severity) ||
      (eventId && !DOMESTIC_UUID_RE.test(eventId)) || (assignedUserId && !DOMESTIC_UUID_RE.test(assignedUserId)) ||
      (dueAt && !Number.isFinite(Date.parse(dueAt))) || (dedupeKey && (dedupeKey.length < 8 || dedupeKey.length > 240))) {
    return c.json({ message: 'اطلاعات مسئله معتبر نیست.' }, 422);
  }
  if (eventId) {
    const [found] = await pool.execute('SELECT 1 FROM medar_operational_events WHERE id=? AND company_id=? LIMIT 1', [eventId,companyId]);
    if (!found.length) return c.json({ message: 'رویداد مرتبط در این شرکت پیدا نشد.' }, 404);
  }
  if (assignedUserId) {
    const [found] = await pool.execute('SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND active=TRUE LIMIT 1', [companyId,assignedUserId]);
    if (!found.length) return c.json({ message: 'مسئول باید عضو فعال همین شرکت باشد.' }, 422);
  }
  const newId = randomUUID();
  if (dedupeKey) {
    await pool.execute(
      'INSERT INTO medar_exception_cases(id,company_id,event_id,title,details,severity,assigned_user_id,due_at,created_by,dedupe_key) VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE updated_at=NOW(3)',
      [newId,companyId,eventId || null,title,details,severity,assignedUserId || null,dueAt ? new Date(dueAt) : null,session.user.id,dedupeKey],
    );
    const [rows] = await pool.execute(
      'SELECT x.*,u.username AS assigned_username FROM medar_exception_cases x LEFT JOIN medar_users u ON u.id=x.assigned_user_id WHERE x.company_id=? AND x.active_dedupe_key=? LIMIT 1',
      [companyId,dedupeKey],
    );
    return c.json({ ok: true, exception: domesticExceptionRow(rows[0]) }, 201);
  }
  await pool.execute(
    'INSERT INTO medar_exception_cases(id,company_id,event_id,title,details,severity,assigned_user_id,due_at,created_by) VALUES(?,?,?,?,?,?,?,?,?)',
    [newId,companyId,eventId || null,title,details,severity,assignedUserId || null,dueAt ? new Date(dueAt) : null,session.user.id],
  );
  const [rows] = await pool.execute(
    'SELECT x.*,u.username AS assigned_username FROM medar_exception_cases x LEFT JOIN medar_users u ON u.id=x.assigned_user_id WHERE x.company_id=? AND x.id=? LIMIT 1',
    [companyId,newId],
  );
  return c.json({ ok: true, exception: domesticExceptionRow(rows[0]) }, 201);
});

for (const [action, fromStates, toState] of [
  ['acknowledge', ['open','acknowledged'], 'acknowledged'],
  ['start', ['acknowledged'], 'in_progress'],
]) {
  app.post('/api/operational/exceptions/:id/' + action, async (c) => {
    if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
    const session = await currentSession(c);
    if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
    if (!DOMESTIC_UUID_RE.test(id) || !DOMESTIC_UUID_RE.test(companyId)) return c.json({ message: 'شناسه مسئله یا مجموعه معتبر نیست.' }, 422);
    const membership = await domesticMembership(session.user.id, companyId);
    if (!membership || !INTERNAL_ROLES.has(String(membership.role)) || !(await domesticModuleAllowed(membership, 'operational-tasks', 'can_update'))) {
      return c.json({ message: 'برای رسیدگی به این مسئله دسترسی نداری.' }, 403);
    }
    const connection = await pool.getConnection();
    let row;
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        'SELECT id,status,acknowledged_at,updated_at FROM medar_exception_cases WHERE id=? AND company_id=? FOR UPDATE',
        [id,companyId],
      );
      const existing = rows[0];
      if (!existing || !fromStates.includes(String(existing.status))) {
        await connection.rollback();
        return c.json({ message: 'مسئله پیدا نشد یا وضعیت فعلی اجازه این عملیات را نمی‌دهد.' }, 409);
      }
      const [result] = await connection.execute(
        'UPDATE medar_exception_cases SET status=?,acknowledged_at=CASE WHEN ?=\\'acknowledged\\' THEN COALESCE(acknowledged_at,NOW(3)) ELSE acknowledged_at END,updated_at=NOW(3) WHERE id=? AND company_id=?',
        [toState,toState,id,companyId],
      );
      const [updated] = await connection.execute(
        'SELECT id,status,acknowledged_at,updated_at FROM medar_exception_cases WHERE id=? AND company_id=? LIMIT 1',
        [id,companyId],
      );
      row = updated[0];
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      return c.json({ message: 'به‌روزرسانی مسئله کامل نشد.' }, 500);
    } finally { connection.release(); }
    return c.json({ ok: true, exception: { id: String(row.id), status: row.status, acknowledgedAt: row.acknowledged_at, updatedAt: row.updated_at } });
  });
}

app.post('/api/operational/exceptions/:id/resolve', async (c) => {
  if (!pool) return c.json({ message: 'پایگاه داده تنظیم نشده است.' }, 503);
  const session = await currentSession(c);
  if (!session) return c.json({ message: 'برای ادامه وارد حساب شو.' }, 401);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
  const resolutionNote = typeof body?.resolutionNote === 'string' ? body.resolutionNote.trim() : '';
  if (!DOMESTIC_UUID_RE.test(id) || !DOMESTIC_UUID_RE.test(companyId)) return c.json({ message: 'شناسه مسئله یا مجموعه معتبر نیست.' }, 422);
  if (resolutionNote.length < 3 || resolutionNote.length > 2000) return c.json({ message: 'برای بستن مسئله، شرح نتیجه لازم است.' }, 422);
  const membership = await domesticMembership(session.user.id, companyId);
  if (!membership || !INTERNAL_ROLES.has(String(membership.role)) || !(await domesticModuleAllowed(membership, 'operational-tasks', 'can_update'))) {
    return c.json({ message: 'برای رسیدگی به این مسئله دسترسی نداری.' }, 403);
  }
  const [result] = await pool.execute(
    "UPDATE medar_exception_cases SET status='resolved',resolved_at=NOW(3),resolved_by=?,resolution_note=?,updated_at=NOW(3) WHERE id=? AND company_id=? AND status NOT IN ('resolved','closed')",
    [session.user.id,resolutionNote,id,companyId],
  );
  if (!result.affectedRows) return c.json({ message: 'مسئله پیدا نشد یا قبلاً بسته شده است.' }, 409);
  const [rows] = await pool.execute(
    'SELECT x.*,u.username AS assigned_username FROM medar_exception_cases x LEFT JOIN medar_users u ON u.id=x.assigned_user_id WHERE x.id=? AND x.company_id=? LIMIT 1',
    [id,companyId],
  );
  return c.json({ ok: true, exception: domesticExceptionRow(rows[0]) });
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
    const { serve } = await import('@hono/node-server');
    serve({ fetch: app.fetch, port: PORT, hostname: process.env.HOST || '127.0.0.1' }, (info) => {
      console.log('Medar domestic API listening on ' + info.address + ':' + info.port);
    });
  }
}

export async function closePool() {
  if (pool) await pool.end();
}

export { app, normalizeUsername, verifyPassword, hashPassword };
