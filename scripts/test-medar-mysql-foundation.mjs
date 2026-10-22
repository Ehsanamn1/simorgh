import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
      const preview = statements[index].split(String.fromCharCode(10)).join(' ').slice(0, 180);
      let diagnostic = '';
      try {
        const [statusRows] = await db.query('SHOW ENGINE INNODB STATUS');
        const status = String(statusRows?.[0]?.Status || '');
        const marker = status.indexOf('LATEST FOREIGN KEY ERROR');
        if (marker >= 0) diagnostic = String.fromCharCode(10) + status.slice(marker, marker + 1600);
      } catch (diagnosticError) {
        diagnostic = ' (could not retrieve InnoDB diagnostics: ' + diagnosticError.message + ')';
      }
      try {
        const [warnings] = await db.query('SHOW WARNINGS');
        if (warnings.length) diagnostic += String.fromCharCode(10) + JSON.stringify(warnings);
      } catch (warningError) {
        diagnostic += ' (could not retrieve SQL warnings: ' + warningError.message + ')';
      }
      for (const table of ['memberships', 'companies', 'medar_users']) {
        try {
          const [ddl] = await db.query('SHOW CREATE TABLE `' + table + '`');
          diagnostic += String.fromCharCode(10) + 'SHOW CREATE ' + table + ': ' + ddl[0]['Create Table'];
        } catch (ddlError) {
          diagnostic += String.fromCharCode(10) + 'SHOW CREATE ' + table + ' failed: ' + ddlError.message;
        }
      }
      throw new Error('MySQL migration statement ' + (index + 1) + '/' + statements.length + ' failed: ' + preview + String.fromCharCode(10) + error.message + diagnostic);
    }
  }
  const operationalSql = await readFile(new URL('../worker/migrations/mysql/0002_operational_schema.sql', import.meta.url), 'utf8');
  const operationalStatements = operationalSql.split(String.fromCharCode(10))
    .filter(line => !line.trim().startsWith('--'))
    .join(String.fromCharCode(10))
    .split(';').map(part => part.trim()).filter(Boolean);
  for (let index = 0; index < operationalStatements.length; index += 1) {
    try {
      await db.query(operationalStatements[index]);
    } catch (error) {
      const preview = operationalStatements[index].split(String.fromCharCode(10)).join(' ').slice(0, 180);
      let diagnostics = '';
      try {
        const [warnings] = await db.query('SHOW WARNINGS');
        if (warnings.length) diagnostics = String.fromCharCode(10) + JSON.stringify(warnings);
      } catch (diagnosticError) { diagnostics = String.fromCharCode(10) + 'Could not retrieve MySQL warnings: ' + diagnosticError.message; }
      throw new Error('MySQL operational migration statement ' + (index + 1) + '/' + operationalStatements.length + ' failed: ' + preview + String.fromCharCode(10) + error.message + diagnostics);
    }
  }
  const operationalRequired = ['customers','suppliers','products','price_agreements','orders','order_items','capacity_commitments','lots','quality_reviews','shipments','delivery_evidence','invoices','settlements','notifications','audit_events','farm_sites','partnership_agreements','flock_cycles','production_batches','daily_production_records','task_templates','operational_tasks','task_evidence','operational_incidents','partner_financial_entries','partner_settlement_periods','shipment_locations','inventory_movements','company_goals'];
  const [operationalRows] = await db.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = \'BASE TABLE\'',
  );
  const operationalFound = new Set(operationalRows.map(row => String(row.TABLE_NAME).toLowerCase()));
  for (const table of operationalRequired) assert(operationalFound.has(table), 'Missing MySQL operational table: ' + table);
  const [[emailColumn]] = await db.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'access_requests' AND COLUMN_NAME = 'email'");
  assert.equal(Number(emailColumn.count), 1, 'Access-request email field from the later PostgreSQL schema must be present.');
  for (let index = 0; index < operationalStatements.length; index += 1) {
    await db.query(operationalStatements[index]);
  }

  const required = ['medar_users','medar_sessions','medar_login_attempts','medar_rate_limits','medar_audit_log','companies','profiles','memberships','company_owners','access_requests','pending_access_request_guards'];
  const [rows] = await db.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = \'BASE TABLE\'',
  );
  const found = new Set(rows.map(row => String(row.TABLE_NAME).toLowerCase()));
  for (const table of required) assert(found.has(table), 'Missing MySQL foundation table: ' + table);
  const [constraints] = await db.query(
    "SELECT TABLE_NAME, CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
  );
  assert(constraints.length >= 10, 'Expected identity and tenant foreign keys to be installed.');
  const [ownerKeys] = await db.query(
    "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'company_owners' AND CONSTRAINT_TYPE IN ('PRIMARY KEY','UNIQUE')",
  );
  assert(ownerKeys.some(row => row.CONSTRAINT_NAME === 'PRIMARY'), 'Single-owner-per-company registry must have a primary key on company_id.');
  const [pendingKeys] = await db.query(
    "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'pending_access_request_guards' AND CONSTRAINT_TYPE IN ('PRIMARY KEY','UNIQUE')",
  );
  assert(pendingKeys.some(row => row.CONSTRAINT_NAME === 'PRIMARY'), 'Pending-request guard must have a primary key on (company_id, user_id).');

  const ownerId = randomUUID();
  const secondOwnerId = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  await db.execute(
    'INSERT INTO medar_users (id,username,username_normalized,phone_e164,display_name,password_hash,requested_role,account_status) VALUES (?,?,?,?,?,?,?,?)',
    [ownerId, 'mysql-owner-a', 'mysql-owner-a', '+15550000001', 'Owner One', 'ci-password-hash', 'owner', 'active'],
  );
  await db.execute(
    'INSERT INTO medar_users (id,username,username_normalized,phone_e164,display_name,password_hash,requested_role,account_status) VALUES (?,?,?,?,?,?,?,?)',
    [secondOwnerId, 'mysql-owner-b', 'mysql-owner-b', '+15550000002', 'Owner Two', 'ci-password-hash', 'owner', 'active'],
  );
  await db.execute('INSERT INTO companies (id,name,province) VALUES (?,?,?)', [companyA, 'CI Company A', 'Golestan']);
  await db.execute('INSERT INTO companies (id,name,province) VALUES (?,?,?)', [companyB, 'CI Company B', 'Golestan']);

  const supplierA = randomUUID();
  const customerA = randomUUID();
  const productA = randomUUID();
  const customerB = randomUUID();
  const productB = randomUUID();
  const orderA = randomUUID();
  await db.execute('INSERT INTO suppliers (id,company_id,name) VALUES (?,?,?)', [supplierA, companyA, 'CI Supplier A']);
  await db.execute('INSERT INTO customers (id,company_id,name) VALUES (?,?,?)', [customerA, companyA, 'CI Customer A']);
  await db.execute('INSERT INTO customers (id,company_id,name) VALUES (?,?,?)', [customerB, companyB, 'CI Customer B']);
  await db.execute('INSERT INTO products (id,company_id,sku,name,kind) VALUES (?,?,?,?,?)', [productA, companyA, 'CI-EGG-A', 'CI Quail Eggs A', 'eggs']);
  await db.execute('INSERT INTO products (id,company_id,sku,name,kind) VALUES (?,?,?,?,?)', [productB, companyB, 'CI-EGG-B', 'CI Quail Eggs B', 'eggs']);
  await db.execute('INSERT INTO orders (id,company_id,customer_id,reference,status) VALUES (?,?,?,?,?)', [orderA, companyA, customerA, 'SO-CI-001', 'draft']);
  await db.execute('INSERT INTO order_items (id,company_id,order_id,product_id,quantity,unit_price) VALUES (?,?,?,?,?,?)', [randomUUID(), companyA, orderA, productA, 10, 100]);
  await db.execute('INSERT INTO orders (company_id,customer_id,status,notes) VALUES (?,?,?,?)', [companyA, customerA, 'draft', 'CI AUTO DEFAULTS']);
  const [[autoOrder]] = await db.query('SELECT id,reference FROM orders WHERE company_id=? AND customer_id=? AND notes=?', [companyA, customerA, 'CI AUTO DEFAULTS']);
  assert.match(autoOrder.id, /^[0-9a-f-]{36}$/i, 'Operational primary keys must retain generated UUID defaults.');
  assert.match(autoOrder.reference, /^SO-\d{6}-[0-9A-F]{6}$/, 'Sales-order references must retain the generated reference default.');
  await assert.rejects(
    db.execute('INSERT INTO invoices (id,company_id,order_id,customer_id,reference,amount,paid_amount) VALUES (?,?,?,?,?,?,?)', [randomUUID(), companyA, orderA, customerA, 'INV-CI-OVERPAY', 100, 101]),
    error => error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED',
    'An invoice must not record paid_amount above its amount.',
  );
  await assert.rejects(
    db.execute("INSERT INTO invoices (id,company_id,order_id,customer_id,reference,amount,paid_amount,status) VALUES (?,?,?,?,?,?,?,'paid')", [randomUUID(), companyA, orderA, customerA, 'INV-CI-MISSING-EVIDENCE', 100, 100]),
    error => error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED',
    'Paid invoices must include payment reference, timestamp and actor evidence.',
  );
  await assert.rejects(
    db.execute("INSERT INTO settlements (id,company_id,supplier_id,amount,status) VALUES (?,?,?,?, 'paid')", [randomUUID(), companyA, supplierA, 100]),
    error => error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED',
    'Paid settlements must include payment reference, timestamp and actor evidence.',
  );
  await assert.rejects(
    db.execute('INSERT INTO order_items (id,company_id,order_id,product_id,quantity,unit_price) VALUES (?,?,?,?,?,?)', [randomUUID(), companyA, orderA, productB, 10, 100]),
    error => error?.code === 'ER_NO_REFERENCED_ROW_2',
    'Operational composite foreign keys must prevent cross-company product references.',
  );
  await assert.rejects(
    db.execute('INSERT INTO partnership_agreements (id,company_id,supplier_id,agreement_code,effective_from,company_profit_share_pct,partner_profit_share_pct) VALUES (?,?,?,?,?,?,?)', [randomUUID(), companyA, supplierA, 'CI-INVALID-SHARE', '2026-01-01', 70, 50]),
    error => error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED',
    'Partnership share percentages must total exactly 100 percent.',
  );
  const activeAgreement = () => [randomUUID(), companyA, supplierA, 'CI-ACTIVE-' + randomUUID().slice(0, 8), '2026-01-01', 'active', JSON.stringify(['feed']), 'ci/companyA/agreements/active.pdf', '2026-01-01 00:00:00', ownerId, '2026-01-01 00:00:00'];
  await db.execute(
    'INSERT INTO partnership_agreements (id,company_id,supplier_id,agreement_code,effective_from,status,shared_expense_categories,signed_document_path,signed_at,approved_by,approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    activeAgreement(),
  );
  await assert.rejects(
    db.execute('INSERT INTO partnership_agreements (id,company_id,supplier_id,agreement_code,effective_from,status,shared_expense_categories,signed_document_path,signed_at,approved_by,approved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', activeAgreement()),
    error => error?.code === 'ER_DUP_ENTRY',
    'A supplier must not have more than one active partnership agreement per company.',
  );
  await assert.rejects(
    db.execute('INSERT INTO company_goals (id,company_id,title,baseline_value,target_value) VALUES (?,?,?,?,?)', [randomUUID(), companyA, 'CI Invalid Goal', 10, 10]),
    error => error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED',
    'A company goal target must be above its baseline.',
  );

  await db.execute('INSERT INTO company_owners (company_id,owner_user_id) VALUES (?,?)', [companyA, ownerId]);
  await db.execute('INSERT INTO company_owners (company_id,owner_user_id) VALUES (?,?)', [companyB, ownerId]);
  await assert.rejects(
    db.execute('INSERT INTO company_owners (company_id,owner_user_id) VALUES (?,?)', [companyA, secondOwnerId]),
    error => error?.code === 'ER_DUP_ENTRY',
    'A company must not accept a second owner in the owner registry.',
  );

  const requestA = randomUUID();
  const requestB = randomUUID();
  await db.execute(
    'INSERT INTO access_requests (id,company_id,user_id,requested_role,full_name,status) VALUES (?,?,?,?,?,?)',
    [requestA, companyA, ownerId, 'supplier', 'CI Access Request A', 'pending'],
  );
  await db.execute(
    'INSERT INTO access_requests (id,company_id,user_id,requested_role,full_name,status) VALUES (?,?,?,?,?,?)',
    [requestB, companyA, ownerId, 'supplier', 'CI Access Request B', 'pending'],
  );
  await db.execute(
    'INSERT INTO pending_access_request_guards (company_id,user_id,access_request_id) VALUES (?,?,?)',
    [companyA, ownerId, requestA],
  );
  await assert.rejects(
    db.execute('INSERT INTO pending_access_request_guards (company_id,user_id,access_request_id) VALUES (?,?,?)', [companyA, ownerId, requestB]),
    error => error?.code === 'ER_DUP_ENTRY',
    'Only one pending request per company/user may be guarded at once.',
  );
  console.log('Medar MySQL schema passed:', required.length + operationalRequired.length, 'identity + operational tables,', constraints.length, 'foundation foreign keys, owner and pending-request uniqueness semantics.');
} finally {
  await db.end();
}
