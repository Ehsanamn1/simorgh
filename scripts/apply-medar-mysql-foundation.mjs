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
  throw new Error('Refusing non-staging database "' + databaseName + '". The operational API port is incomplete; database name must end in _staging, _stage or _ci.');
}

const migrations = [
  {
    version: '0001_foundation',
    file: '../worker/migrations/mysql/0001_foundation.sql',
    required: ['medar_users','medar_sessions','medar_login_attempts','medar_rate_limits','medar_audit_log','companies','profiles','memberships','company_owners','access_requests','pending_access_request_guards'],
  },
  {
    version: '0002_operational_schema',
    file: '../worker/migrations/mysql/0002_operational_schema.sql',
    required: ['customers','suppliers','products','price_agreements','orders','order_items','capacity_commitments','lots','quality_reviews','shipments','delivery_evidence','invoices','settlements','notifications','audit_events','farm_sites','partnership_agreements','flock_cycles','production_batches','daily_production_records','task_templates','operational_tasks','task_evidence','operational_incidents','partner_financial_entries','partner_settlement_periods','shipment_locations','inventory_movements','company_goals'],
  },
  {
    version: '0003_extended_schema',
    file: '../worker/migrations/mysql/0003_extended_schema.sql',
    required: ['company_invites','medar_files','purchase_orders','purchase_order_items','medar_client_presence','medar_ai_provider_configs','medar_ai_usage_log','medar_ai_action_runs','medar_membership_module_permissions','medar_bank_accounts','medar_bank_transactions','medar_operational_events','medar_exception_cases','medar_conversations','medar_conversation_participants','medar_messages','medar_push_subscriptions','medar_notification_outbox'],
  },
  {
    version: '0004_delivery_video_evidence',
    file: '../worker/migrations/mysql/0004_delivery_video_evidence.sql',
    required: ['delivery_evidence'],
    requiredConstraints: ['delivery_evidence_kind_check'],
  },
];

function statementsOf(raw) {
  return raw.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
    .split(';').map(statement => statement.trim()).filter(Boolean);
}
async function verifyTables(db, required, version) {
  const [rows] = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
  const found = new Set(rows.map(row => String(row.TABLE_NAME).toLowerCase()));
  const missing = required.filter(table => !found.has(table));
  if (missing.length) throw new Error(version + ' verification failed; missing tables: ' + missing.join(', '));
}
async function verifyConstraints(db, required, version) {
  if (!required?.length) return;
  const [rows] = await db.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'delivery_evidence' AND CONSTRAINT_TYPE = 'CHECK'");
  const found = new Set(rows.map(row => String(row.CONSTRAINT_NAME).toLowerCase()));
  const missing = required.filter(name => !found.has(name.toLowerCase()));
  if (missing.length) throw new Error(version + ' verification failed; missing constraints: ' + missing.join(', '));
}
const loaded = [];
for (const migration of migrations) {
  const raw = await readFile(new URL(migration.file, import.meta.url), 'utf8');
  loaded.push({ ...migration, raw, checksum: createHash('sha256').update(raw).digest('hex'), statements: statementsOf(raw) });
}

const db = await mysql.createConnection(url);
try {
  const [[server]] = await db.query('SELECT VERSION() AS version, DATABASE() AS database_name');
  console.log('Madar MySQL staging target:', server.database_name, 'server:', server.version, 'mode:', APPLY ? 'APPLY' : 'DRY RUN');
  if (!APPLY) {
    console.log('Dry run only; no database writes performed.');
    for (const migration of loaded) {
      console.log('\nMigration', migration.version, 'checksum:', migration.checksum, 'statements:', migration.statements.length);
      migration.statements.forEach((statement, index) => console.log(String(index + 1).padStart(2, '0') + '. ' + statement.replace(/\s+/g, ' ').slice(0, 140)));
    }
  } else {
    await db.query("CREATE TABLE IF NOT EXISTS medar_schema_migrations (version VARCHAR(128) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci");
    for (const migration of loaded) {
      const [applied] = await db.execute('SELECT checksum FROM medar_schema_migrations WHERE version = ?', [migration.version]);
      if (applied.length) {
        if (applied[0].checksum !== migration.checksum) throw new Error('Migration ' + migration.version + ' checksum differs from the applied ledger. Never overwrite an applied migration; create a new version.');
        await verifyTables(db, migration.required, migration.version);
        await verifyConstraints(db, migration.requiredConstraints, migration.version);
        console.log('Already applied and verified:', migration.version);
        continue;
      }
      console.log('Applying', migration.version, 'with', migration.statements.length, 'statements.');
      for (let index = 0; index < migration.statements.length; index += 1) {
        const statement = migration.statements[index];
        const addConstraint = statement.match(/^ALTER\s+TABLE\s+`?([a-z_][a-z0-9_]*)`?\s+ADD\s+CONSTRAINT\s+`?([a-z_][a-z0-9_]*)`?/i);
        if (addConstraint) {
          const [, tableName, constraintName] = addConstraint;
          const [existing] = await db.execute(
            'SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1',
            [tableName, constraintName],
          );
          if (existing.length) continue;
        }
        try {
          await db.query(statement);
        } catch (error) {
          throw new Error(migration.version + ' statement ' + (index + 1) + '/' + migration.statements.length + ' failed: ' + statement.replace(/\s+/g, ' ').slice(0, 180) + '\n' + error.message);
        }
      }
      await verifyTables(db, migration.required, migration.version);
      await verifyConstraints(db, migration.requiredConstraints, migration.version);
      const [fks] = await db.query("SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'");
      if (fks.length < 10) throw new Error('Post-migration verification failed; only ' + fks.length + ' foreign keys found.');
      await db.execute('INSERT INTO medar_schema_migrations (version, checksum) VALUES (?, ?)', [migration.version, migration.checksum]);
      console.log('Applied and verified:', migration.version, 'required tables:', migration.required.length, 'database foreign keys:', fks.length);
    }
    console.log('Schema migrations applied. This still does not mean the PostgreSQL operational API or production data has been migrated.');
  }
} finally {
  await db.end();
}
