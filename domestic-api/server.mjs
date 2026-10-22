import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
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


const DATA_TABLES = new Set([
  'customers','suppliers','products','price_agreements','orders','order_items','capacity_commitments','lots',
  'shipments','delivery_evidence','invoices','settlements','notifications','farm_sites','partnership_agreements',
  'flock_cycles','production_batches','daily_production_records','task_templates','operational_tasks','task_evidence',
  'operational_incidents','partner_financial_entries','shipment_locations','company_goals',
]);
const READ_ONLY_TABLES = new Set(['notifications','delivery_evidence','task_evidence']);
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
      if (!Array.isArray(value) || value.length > 200) throw new Error('Invalid IN filter');
      if (!value.length) { parts.push(op === 'in' ? '0=1' : '1=1'); continue; }
      parts.push(column + (op === 'not_in' ? ' NOT IN (' : ' IN (') + value.map(() => '?').join(',') + ')');
      values.push(...value);
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
      let query = 'SELECT * FROM ' + sqlIdentifier(table) + where;
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
      const inserted = [];
      for (const original of input) {
        const companyId = typeof original.company_id === 'string' ? original.company_id : '';
        if (!memberships.some((m) => m.company_id === companyId && INTERNAL_ROLES.has(String(m.role)))) {
          return c.json({ message: 'این شرکت به حساب فعلی تعلق ندارد.' }, 403);
        }
        const row = {};
        for (const [key, value] of Object.entries(original)) {
          if (!columns.has(key)) throw new Error('Unknown insert field');
          if (key === 'company_id') continue;
          if (PROTECTED_FIELDS.has(key)) continue;
          row[key] = value;
        }
        row.company_id = companyId;
        if (columns.has('created_by')) row.created_by = session.user.id;
        if (!Object.keys(row).length) throw new Error('Empty insert');
        const keys = Object.keys(row);
        const [result] = await pool.execute(
          'INSERT INTO ' + sqlIdentifier(table) + ' (' + keys.map(sqlIdentifier).join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')',
          keys.map((key) => row[key]),
        );
        inserted.push({ id: result.insertId ?? null, ...row });
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
      if (PROTECTED_FIELDS.has(key)) continue;
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
