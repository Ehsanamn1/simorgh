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
        diagnostic = marker >= 0
          ? String.fromCharCode(10) + status.slice(marker, marker + 2200)
          : String.fromCharCode(10) + 'InnoDB diagnostic tail: ' + status.slice(-2400);
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
    const constraintMatch = operationalStatements[index].match(/^ALTER\\s+TABLE\\s+`?([a-z_][a-z0-9_]*)`?\\s+ADD\\s+CONSTRAINT\\s+`?([a-z_][a-z0-9_]*)`?/i);
    if (constraintMatch) {
      const [, tableName, constraintName] = constraintMatch;
      const [existing] = await db.execute(
        'SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1',
        [tableName, constraintName],
      );
      if (existing.length) continue;
    }
    await db.query(operationalStatements[index]);
  }

  const extendedSql = await readFile(new URL('../worker/migrations/mysql/0003_extended_schema.sql', import.meta.url), 'utf8');
  const extendedStatements = extendedSql.split(String.fromCharCode(10))
    .filter(line => !line.trim().startsWith('--'))
    .join(String.fromCharCode(10))
    .split(';').map(part => part.trim()).filter(Boolean);
  for (let index = 0; index < extendedStatements.length; index += 1) {
    const constraintMatch = extendedStatements[index].match(/^ALTER\s+TABLE\s+`?([a-z_][a-z0-9_]*)`?\s+ADD\s+CONSTRAINT\s+`?([a-z_][a-z0-9_]*)`?/i);
    if (constraintMatch) {
      const [, tableName, constraintName] = constraintMatch;
      const [existing] = await db.execute(
        'SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1',
        [tableName, constraintName],
      );
      if (existing.length) continue;
    }
    try {
      await db.query(extendedStatements[index]);
    } catch (error) {
      const preview = extendedStatements[index].split(String.fromCharCode(10)).join(' ').slice(0, 180);
      let diagnostics = '';
      try {
        const [warnings] = await db.query('SHOW WARNINGS');
        if (warnings.length) diagnostics += String.fromCharCode(10) + 'Warnings: ' + JSON.stringify(warnings);
      } catch (diagnosticError) { diagnostics += String.fromCharCode(10) + 'Warnings unavailable: ' + diagnosticError.message; }
      try {
        const [statusRows] = await db.query('SHOW ENGINE INNODB STATUS');
        const status = String(statusRows?.[0]?.Status || '');
        const marker = status.lastIndexOf('LATEST FOREIGN KEY ERROR');
        const foreignKeyError = marker >= 0 ? status.slice(marker, marker + 3500) : '';
        diagnostics += String.fromCharCode(10) + 'InnoDB status length: ' + status.length + String.fromCharCode(10) + 'InnoDB: ' + (foreignKeyError || status.slice(-3000));
      } catch (diagnosticError) { diagnostics += String.fromCharCode(10) + 'InnoDB diagnostics unavailable: ' + diagnosticError.message; }
      for (const tableName of ['companies','medar_users','medar_ai_provider_configs','notifications','medar_notification_outbox']) {
        try {
          const [createRows] = await db.query('SHOW CREATE TABLE `' + tableName + '`');
          diagnostics += String.fromCharCode(10) + 'SHOW CREATE ' + tableName + ': ' + String(createRows?.[0]?.['Create Table'] || '').slice(0, 2400);
          const [indexRows] = await db.query('SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX', [tableName]);
          diagnostics += String.fromCharCode(10) + 'INDEXES ' + tableName + ': ' + JSON.stringify(indexRows);
        } catch (diagnosticError) { diagnostics += String.fromCharCode(10) + 'SHOW CREATE / indexes ' + tableName + ' unavailable: ' + diagnosticError.message; }
      }
      throw new Error('MySQL extended migration statement ' + (index + 1) + '/' + extendedStatements.length + ' failed: ' + preview + String.fromCharCode(10) + error.message + diagnostics);
    }
  }
  const extendedRequired = ['company_invites','medar_files','purchase_orders','purchase_order_items','medar_client_presence','medar_ai_provider_configs','medar_ai_usage_log','medar_ai_action_runs','medar_membership_module_permissions','medar_bank_accounts','medar_bank_transactions','medar_operational_events','medar_exception_cases','medar_conversations','medar_conversation_participants','medar_messages','medar_push_subscriptions','medar_notification_outbox'];
  const [extendedRows] = await db.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = \'BASE TABLE\'');
  const extendedFound = new Set(extendedRows.map(row => String(row.TABLE_NAME).toLowerCase()));
  for (const table of extendedRequired) assert(extendedFound.has(table), 'Missing MySQL extended table: ' + table);
  for (let index = 0; index < extendedStatements.length; index += 1) {
    const constraintMatch = extendedStatements[index].match(/^ALTER\s+TABLE\s+`?([a-z_][a-z0-9_]*)`?\s+ADD\s+CONSTRAINT\s+`?([a-z_][a-z0-9_]*)`?/i);
    if (constraintMatch) {
      const [, tableName, constraintName] = constraintMatch;
      const [existing] = await db.execute(
        'SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1',
        [tableName, constraintName],
      );
      if (existing.length) continue;
    }
    await db.query(extendedStatements[index]);
  }

  const videoSql = await readFile(new URL('../worker/migrations/mysql/0004_delivery_video_evidence.sql', import.meta.url), 'utf8');
  const videoStatements = videoSql.split(String.fromCharCode(10))
    .filter(line => !line.trim().startsWith('--'))
    .join(String.fromCharCode(10))
    .split(';').map(part => part.trim()).filter(Boolean);
  for (let pass = 0; pass < 2; pass += 1) {
    for (const statement of videoStatements) {
      const constraintMatch = statement.match(/^ALTER\s+TABLE\s+`?([a-z_][a-z0-9_]*)`?\s+ADD\s+CONSTRAINT\s+`?([a-z_][a-z0-9_]*)`?/i);
      if (constraintMatch) {
        const [, tableName, constraintName] = constraintMatch;
        const [existing] = await db.execute(
          'SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1',
          [tableName, constraintName],
        );
        if (existing.length) continue;
      }
      await db.query(statement);
    }
  }
  const [videoConstraintRows] = await db.query(
    "SELECT cc.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='delivery_evidence' AND tc.CONSTRAINT_NAME='delivery_evidence_kind_check' LIMIT 1",
  );
  assert.equal(videoConstraintRows.length, 1, 'Delivery video evidence constraint must exist after two migration passes.');
  assert.match(String(videoConstraintRows[0].CHECK_CLAUSE), /video/i, 'Delivery evidence check must allow video.');

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
  const adminUserId = randomUUID();
  await db.execute(
    'INSERT INTO medar_users (id,username,username_normalized,display_name,password_hash,requested_role,account_status) VALUES (?,?,?,?,?,?,?)',
    [adminUserId, 'mysql-admin-ci', 'mysql-admin-ci', 'CI Admin', 'ci-password-hash', 'admin', 'active'],
  );
  await db.execute('INSERT INTO profiles (id,full_name) VALUES (?,?)', [adminUserId, 'CI Admin']);
  await db.execute('INSERT INTO companies (id,name,province) VALUES (?,?,?)', [companyA, 'CI Company A', 'Golestan']);
  await db.execute('INSERT INTO companies (id,name,province) VALUES (?,?,?)', [companyB, 'CI Company B', 'Golestan']);
  const membershipA = randomUUID();
  const membershipB = randomUUID();
  await db.execute('INSERT INTO memberships (id,company_id,user_id,role,active) VALUES (?,?,?,?,?)', [membershipA, companyA, ownerId, 'owner', true]);
  await db.execute('INSERT INTO memberships (id,company_id,user_id,role,active) VALUES (?,?,?,?,?)', [membershipB, companyB, secondOwnerId, 'owner', true]);
  await db.execute('INSERT INTO medar_membership_module_permissions (company_id,membership_id,module_key,updated_by) VALUES (?,?,?,?)', [companyA, membershipA, 'orders', ownerId]);
  await assert.rejects(
    db.execute('INSERT INTO medar_membership_module_permissions (company_id,membership_id,module_key,updated_by) VALUES (?,?,?,?)', [companyA, membershipB, 'finance', ownerId]),
    error => error?.code === 'ER_NO_REFERENCED_ROW_2',
    'Module permissions must not reference a membership from another company.',
  );

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

  const inviteToken = 'a'.repeat(64);
  await db.execute('INSERT INTO company_invites (id,company_id,role,token_hash,created_by,expires_at,customer_id) VALUES (?,?,?,?,?,?,?)', [randomUUID(), companyA, 'customer', inviteToken, ownerId, '2026-12-01 00:00:00', customerA]);
  await assert.rejects(
    db.execute('INSERT INTO company_invites (id,company_id,role,token_hash,created_by,expires_at,customer_id) VALUES (?,?,?,?,?,?,?)', [randomUUID(), companyA, 'customer', inviteToken, ownerId, '2026-12-01 00:00:00', customerA]),
    error => error?.code === 'ER_DUP_ENTRY',
    'Company invite token hashes must be unique.',
  );

  const filePath = companyA + '/capacity-evidence/' + randomUUID() + '.json';
  await db.execute('INSERT INTO medar_files (bucket_id,name,company_id,content_type,size_bytes,uploaded_by) VALUES (?,?,?,?,?,?)', ['capacity-evidence', filePath, companyA, 'application/json', 32, ownerId]);
  await assert.rejects(
    db.execute('INSERT INTO medar_files (bucket_id,name,company_id,content_type,size_bytes,uploaded_by) VALUES (?,?,?,?,?,?)', ['capacity-evidence', filePath, companyA, 'application/json', 32, ownerId]),
    error => error?.code === 'ER_DUP_ENTRY',
    'Private-file paths must be unique within a storage bucket.',
  );

  await db.execute('INSERT INTO purchase_orders (company_id,supplier_id,reference,created_by) VALUES (?,?,?,?)', [companyA, supplierA, 'PO-CI-001', ownerId]);
  const [[purchaseOrder]] = await db.query('SELECT id FROM purchase_orders WHERE company_id=? AND reference=?', [companyA, 'PO-CI-001']);
  await db.execute('INSERT INTO purchase_order_items (company_id,purchase_order_id,product_id,ordered_quantity,received_quantity,unit_cost) VALUES (?,?,?,?,?,?)', [companyA, purchaseOrder.id, productA, 10, 0, 1]);
  await assert.rejects(
    db.execute('UPDATE purchase_order_items SET received_quantity=11 WHERE company_id=? AND purchase_order_id=? AND product_id=?', [companyA, purchaseOrder.id, productA]),
    error => error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED',
    'Purchase receiving must not exceed the ordered quantity.',
  );

  const clientId = randomUUID();
  await db.execute('INSERT INTO medar_client_presence (company_id,user_id,client_id,platform) VALUES (?,?,?,?)', [companyA, ownerId, clientId, 'web']);
  await assert.rejects(
    db.execute('INSERT INTO medar_client_presence (company_id,user_id,client_id,platform) VALUES (?,?,?,?)', [companyA, ownerId, clientId, 'web']),
    error => error?.code === 'ER_DUP_ENTRY',
    'Client presence must be unique per company/user/client.',
  );

  await db.execute('INSERT INTO medar_ai_provider_configs (company_id,provider,model,encrypted_api_key,is_default,updated_by) VALUES (?,?,?,?,?,?)', [companyA, 'openai', 'gpt-ci', 'x'.repeat(64), true, ownerId]);
  await assert.rejects(
    db.execute('INSERT INTO medar_ai_provider_configs (company_id,provider,model,encrypted_api_key,is_default,updated_by) VALUES (?,?,?,?,?,?)', [companyA, 'gemini', 'gemini-ci', 'y'.repeat(64), true, ownerId]),
    error => error?.code === 'ER_DUP_ENTRY',
    'Only one AI provider may be the default for a company.',
  );
  await db.execute('INSERT INTO medar_ai_usage_log (company_id,user_id,provider,model,input_chars) VALUES (?,?,?,?,?)', [companyA, ownerId, 'openai', 'gpt-ci', 120]);
  await assert.rejects(
    db.execute("INSERT INTO medar_ai_action_runs (company_id,requested_by,tool_key,status,arguments) VALUES (?,?,?,'executed',?)", [companyA, ownerId, 'create_operational_task', '{}']),
    error => error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED',
    'An AI action cannot be marked executed without result, actor and timestamp.',
  );

  await db.execute('INSERT INTO medar_bank_accounts (company_id,label,created_by) VALUES (?,?,?)', [companyA, 'CI Operating Account', ownerId]);
  const [[bankAccount]] = await db.query('SELECT id FROM medar_bank_accounts WHERE company_id=? AND label=?', [companyA, 'CI Operating Account']);
  await db.execute("INSERT INTO medar_bank_transactions (company_id,bank_account_id,external_transaction_id,booked_at,amount,currency,direction,imported_by) VALUES (?,?,?,?,?,?,?,?)", [companyA, bankAccount.id, 'BANK-CI-0001', '2026-10-20 10:00:00', 100, 'IRR', 'incoming', ownerId]);
  await assert.rejects(
    db.execute("INSERT INTO medar_bank_transactions (company_id,bank_account_id,external_transaction_id,booked_at,amount,currency,direction,imported_by) VALUES (?,?,?,?,?,?,?,?)", [companyA, bankAccount.id, 'BANK-CI-0002', '2026-10-20 10:00:00', -100, 'IRR', 'incoming', ownerId]),
    error => error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED',
    'Incoming bank transactions must have positive amounts.',
  );

  await db.execute("INSERT INTO medar_operational_events (company_id,event_type,source_type,title,idempotency_key) VALUES (?,?,?,?,?)", [companyA, 'order.created', 'order', 'CI order event', 'ci-event-0001']);
  await assert.rejects(
    db.execute("INSERT INTO medar_operational_events (company_id,event_type,source_type,title,idempotency_key) VALUES (?,?,?,?,?)", [companyA, 'order.created', 'order', 'CI duplicate event', 'ci-event-0001']),
    error => error?.code === 'ER_DUP_ENTRY',
    'Operational event idempotency keys must be unique per company.',
  );
  const [[eventRow]] = await db.query('SELECT id FROM medar_operational_events WHERE company_id=? AND idempotency_key=?', [companyA, 'ci-event-0001']);
  await db.execute('INSERT INTO medar_exception_cases (company_id,event_id,title,dedupe_key,created_by) VALUES (?,?,?,?,?)', [companyA, eventRow.id, 'CI exception', 'ci-exception-0001', ownerId]);
  await assert.rejects(
    db.execute('INSERT INTO medar_exception_cases (company_id,event_id,title,dedupe_key,created_by) VALUES (?,?,?,?,?)', [companyA, eventRow.id, 'CI duplicate exception', 'ci-exception-0001', ownerId]),
    error => error?.code === 'ER_DUP_ENTRY',
    'Unresolved exceptions must deduplicate by company and dedupe key.',
  );
  await db.execute("UPDATE medar_exception_cases SET status='resolved',resolved_at=CURRENT_TIMESTAMP(3),resolved_by=? WHERE company_id=? AND dedupe_key=?", [ownerId, companyA, 'ci-exception-0001']);
  await db.execute('INSERT INTO medar_exception_cases (company_id,event_id,title,dedupe_key,created_by) VALUES (?,?,?,?,?)', [companyA, eventRow.id, 'CI reopened exception', 'ci-exception-0001', ownerId]);

  await db.execute('INSERT INTO medar_conversations (company_id,title,created_by) VALUES (?,?,?)', [companyA, 'CI conversation', ownerId]);
  const [[conversation]] = await db.query('SELECT id FROM medar_conversations WHERE company_id=? AND title=?', [companyA, 'CI conversation']);
  await db.execute('INSERT INTO medar_messages (company_id,conversation_id,sender_user_id,body,client_message_id) VALUES (?,?,?,?,?)', [companyA, conversation.id, ownerId, 'CI message', 'ci-message-0001']);
  await assert.rejects(
    db.execute('INSERT INTO medar_messages (company_id,conversation_id,sender_user_id,body,client_message_id) VALUES (?,?,?,?,?)', [companyA, conversation.id, ownerId, 'CI duplicate message', 'ci-message-0001']),
    error => error?.code === 'ER_DUP_ENTRY',
    'Client message IDs must be idempotent within a conversation.',
  );

  const pushEndpoint = 'https://push.example.invalid/' + randomUUID();
  await db.execute('INSERT INTO medar_push_subscriptions (company_id,user_id,endpoint,endpoint_hash,p256dh_key,auth_secret) VALUES (?,?,?,?,?,?)', [companyA, ownerId, pushEndpoint, 'b'.repeat(64), 'p'.repeat(80), 'a'.repeat(16)]);
  const notificationId = randomUUID();
  await db.execute('INSERT INTO notifications (id,company_id,user_id,title,body,dedupe_key) VALUES (?,?,?,?,?,?)', [notificationId, companyA, ownerId, 'CI notification', 'CI body', 'ci-notification-0001']);
  await db.execute('INSERT INTO medar_notification_outbox (company_id,user_id,notification_id,payload,idempotency_key) VALUES (?,?,?,?,?)', [companyA, ownerId, notificationId, '{}', 'ci-push-0001']);
  await assert.rejects(
    db.execute('INSERT INTO medar_notification_outbox (company_id,user_id,notification_id,payload,idempotency_key) VALUES (?,?,?,?,?)', [companyB, secondOwnerId, notificationId, '{}', 'ci-cross-company-push-0001']),
    error => error?.code === 'ER_NO_REFERENCED_ROW_2',
    'Notification outbox rows must not reference another company\'s notification.',
  );

  await db.execute('INSERT INTO orders (id,company_id,customer_id,reference,status) VALUES (?,?,?,?,?)', [orderA, companyA, customerA, 'SO-CI-001', 'draft']);
  const shipmentA = randomUUID();
  await db.execute("INSERT INTO shipments (id,company_id,order_id,stage) VALUES (?,?,?,'planned')", [shipmentA, companyA, orderA]);
  await db.execute("INSERT INTO delivery_evidence (id,company_id,shipment_id,kind,storage_path) VALUES (?,?,?,'video',?)", [randomUUID(), companyA, shipmentA, companyA + '/delivery-evidence/' + randomUUID() + '.mp4']);
  await assert.rejects(
    db.execute("INSERT INTO delivery_evidence (id,company_id,shipment_id,kind) VALUES (?,?,?,'animation')", [randomUUID(), companyA, shipmentA]),
    error => error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED',
    'Delivery evidence must reject unsupported media kinds.',
  );
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
