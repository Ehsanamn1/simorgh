import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';

const APPLY = process.argv.includes('--apply');
const url = process.env.MEDAR_MYSQL_URL;
if (!url) throw new Error('MEDAR_MYSQL_URL is required. Use a dedicated MySQL staging database only.');
if (!/^mysql:\/\//i.test(url)) throw new Error('MEDAR_MYSQL_URL must use mysql://.');
const parsed = new URL(url);
const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
if (!/(?:_staging|_stage|_ci)$/i.test(databaseName) && process.env.MEDAR_MYSQL_ALLOW_NONSTAGING !== 'YES') {
  throw new Error('Refusing non-staging database "' + databaseName + '". The MySQL port is incomplete; database name must end in _staging, _stage or _ci.');
}
const migrationPath = new URL('../worker/migrations/mysql/0001_foundation.sql', import.meta.url);
const raw = await readFile(migrationPath, 'utf8');
const checksum = createHash('sha256').update(raw).digest('hex');
const statements = raw.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
  .split(';').map(statement => statement.trim()).filter(Boolean);
const db = await mysql.createConnection(url);
try {
  const [[server]] = await db.query('SELECT VERSION() AS version, DATABASE() AS database_name');
  console.log('Madar MySQL foundation target:', server.database_name, 'server:', server.version, 'mode:', APPLY ? 'APPLY' : 'DRY RUN');
  if (!APPLY) {
    console.log('Dry run only; no database writes performed.');
    console.log('Migration 0001_foundation checksum:', checksum);
    console.log('Statements planned:', statements.length);
    for (let index = 0; index < statements.length; index += 1) {
      const preview = statements[index].replace(/\s+/g, ' ').slice(0, 140);
      console.log(String(index + 1).padStart(2, '0') + '. ' + preview);
    }
    process.exitCode = 0;
  } else {
    await db.query("CREATE TABLE IF NOT EXISTS medar_schema_migrations (version VARCHAR(128) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci");
    const [applied] = await db.execute('SELECT checksum FROM medar_schema_migrations WHERE version = ?', ['0001_foundation']);
    if (applied.length) {
      if (applied[0].checksum !== checksum) throw new Error('Migration 0001_foundation checksum differs from the applied ledger. Do not overwrite a migration; create a new version.');
      console.log('Migration 0001_foundation is already applied with the same checksum; nothing to do.');
    } else {
      for (let index = 0; index < statements.length; index += 1) {
        const statement = statements[index];
        const addConstraint = statement.match(/^ALTER\s+TABLE\s+`?([a-z_][a-z0-9_]*)`?\s+ADD\s+CONSTRAINT\s+`?([a-z_][a-z0-9_]*)`?/i);
        if (addConstraint) {
          const [, tableName, constraintName] = addConstraint;
          const [existing] = await db.execute(
            'SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1',
            [tableName, constraintName],
          );
          if (existing.length) {
            console.log('Skipping already installed constraint:', tableName + '.' + constraintName);
            continue;
          }
        }
        try {
          await db.query(statement);
        } catch (error) {
          throw new Error('Foundation statement ' + (index + 1) + '/' + statements.length + ' failed: ' + statement.replace(/\s+/g, ' ').slice(0, 180) + '\n' + error.message);
        }
        console.log('Applied statement', index + 1, 'of', statements.length);
      }
      const required = ['medar_users','medar_sessions','medar_login_attempts','medar_rate_limits','medar_audit_log','companies','profiles','memberships','company_owners','access_requests','pending_access_request_guards'];
      const [rows] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
      const found = new Set(rows.map(row => String(row.TABLE_NAME).toLowerCase()));
      const missing = required.filter(table => !found.has(table));
      if (missing.length) throw new Error('Post-migration verification failed; missing tables: ' + missing.join(', '));
      const [fks] = await db.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'");
      if (fks.length < 10) throw new Error('Post-migration verification failed; only ' + fks.length + ' foreign keys found.');
      await db.execute('INSERT INTO medar_schema_migrations (version, checksum) VALUES (?, ?)', ['0001_foundation', checksum]);
      console.log('Madar MySQL foundation applied and verified:', required.length, 'tables,', fks.length, 'foreign keys. This is identity/tenant foundation only, not the complete Medar database port.');
    }
  }
} finally {
  await db.end();
}
