import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const url = process.env.MEDAR_MYSQL_TEST_URL;
if (!url) throw new Error('MEDAR_MYSQL_TEST_URL is required for the disposable MySQL migration test.');
const sql = await readFile(new URL('../worker/migrations/mysql/0001_foundation.sql', import.meta.url), 'utf8');
const sqlWithoutComments = sql.split(String.fromCharCode(10))
  .filter(line => !line.trim().startsWith('--'))
  .join(String.fromCharCode(10));
const statements = sqlWithoutComments.split(';').map(part => part.trim()).filter(Boolean);

const db = await mysql.createConnection(url);
try {
  await db.query('SET NAMES utf8mb4');
  await db.query("SET time_zone = '+00:00'");
  const [[server]] = await db.query('SELECT VERSION() AS version');
  console.log('Applying Medar foundation migration to disposable MySQL:', server.version);
  for (let index = 0; index < statements.length; index += 1) {
    try {
      await db.query(statements[index]);
    } catch (error) {
      const preview = statements[index].replace(/\\s+/g, ' ').slice(0, 180);
      let diagnostic = '';
      try {
        const [statusRows] = await db.query('SHOW ENGINE INNODB STATUS');
        const status = String(statusRows?.[0]?.Status || '');
        const marker = status.indexOf('LATEST FOREIGN KEY ERROR');
        if (marker >= 0) diagnostic = '\\n' + status.slice(marker, marker + 1600);
      } catch {}
      throw new Error('MySQL migration statement ' + (index + 1) + '/' + statements.length + ' failed: ' + preview + '\\n' + error.message + diagnostic);
    }
  }
  const required = ['medar_users','medar_sessions','medar_login_attempts','medar_rate_limits','medar_audit_log','companies','profiles','memberships','access_requests'];
  const [rows] = await db.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = \'BASE TABLE\'',
  );
  const found = new Set(rows.map(row => String(row.TABLE_NAME).toLowerCase()));
  for (const table of required) assert(found.has(table), 'Missing MySQL foundation table: ' + table);
  const [constraints] = await db.query(
    "SELECT TABLE_NAME, CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
  );
  assert(constraints.length >= 10, 'Expected identity and tenant foreign keys to be installed.');
  const [generated] = await db.query(
    "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND EXTRA LIKE '%GENERATED%'",
  );
  assert(generated.some(row => row.COLUMN_NAME === 'active_owner_company_id'), 'Active-owner uniqueness guard missing.');
  assert(generated.some(row => row.COLUMN_NAME === 'pending_company_id'), 'Pending access-request uniqueness guard missing.');
  console.log('Medar MySQL foundation passed:', required.length, 'tables,', constraints.length, 'foreign keys,', generated.length, 'generated columns.');
} finally {
  await db.end();
}
