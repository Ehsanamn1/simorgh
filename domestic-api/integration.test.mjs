import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { app, hashPassword, closePool } from './server.mjs';

async function requestWithTimeout(input, init) {
  let timer;
  const method = String(init?.method || 'GET').toUpperCase();
  const label = method + ' ' + String(input);
  const trace = process.env.MEDAR_TEST_TRACE === 'true';
  if (trace) console.log('[medar-integration] -> ' + label);
  try {
    const response = await Promise.race([
      app.request(input, init),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Domestic API request timed out: ' + label)), 15_000);
      }),
    ]);
    if (trace) console.log('[medar-integration] <- ' + label + ' ' + response.status);
    return response;
  } catch (error) {
    if (trace) console.error('[medar-integration] !! ' + label + ' ' + String(error));
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

test('domestic API authenticates a provisioned MySQL user and revokes the session on logout', { skip: !process.env.MYSQL_URL, timeout: 120_000 }, async () => {
  const db = await mysql.createConnection(process.env.MYSQL_URL);
  const userId = randomUUID();
  const companyId = randomUUID();
  const membershipId = randomUUID();
  const username = 'ci_' + randomBytes(5).toString('hex');
  const suffix = randomBytes(5).toString('hex');
  let supplierUserId = null;
  let supplierMembershipId = null;
  const provisionedUserIds = [];
  const provisionedMembershipIds = [];
  const provisionedUsernames = [];
  const provisionedSupplierIds = [];
  const phone = '+989' + randomBytes(5).toString('hex').slice(0, 9);
  const password = 'Domestic-CI-Password-2026!';
  const passwordHash = await hashPassword(password);
  const usernameKey = createHash('sha256').update('username:' + username).digest('hex');
  try {
    await db.execute(
      'INSERT INTO medar_users (id, username, username_normalized, phone_e164, display_name, password_hash, account_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, username, username, phone, 'Domestic CI User', passwordHash, 'active'],
    );
    await db.execute(
      'INSERT INTO companies (id, name, province, timezone) VALUES (?, ?, ?, ?)',
      [companyId, 'Domestic CI ' + username, 'Golestan', 'Asia/Tehran'],
    );
    await db.execute(
      'INSERT INTO memberships (id, company_id, user_id, role, active, created_by) VALUES (?, ?, ?, ?, TRUE, ?)',
      [membershipId, companyId, userId, 'owner', userId],
    );

    const health = await requestWithTimeout('http://localhost/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: 'medar-domestic-api', database: true, auth: 'mysql' });
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('x-frame-options'), 'DENY');
    assert.equal(health.headers.get('cache-control'), 'no-store');

    const rejectedOrigin = await requestWithTimeout('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://untrusted.example' },
    });
    assert.equal(rejectedOrigin.status, 403, 'Unsafe requests from an untrusted origin must be rejected before route handling.');
    const disabledSignup = await requestWithTimeout('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(disabledSignup.status, 403, 'Public signup must remain disabled on the domestic API.');
    const disabledInvite = await requestWithTimeout('http://localhost/api/auth/signup-with-invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviteCode: 'invalid' }),
    });
    assert.equal(disabledInvite.status, 410, 'Invite-based signup must not accidentally become active.');

    const login = await requestWithTimeout('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json();
    assert.equal(loginBody.user.id, userId);
    assert.equal(loginBody.memberships.length, 1);
    assert.equal(loginBody.memberships[0].company_id, companyId);
    assert.equal(loginBody.memberships[0].company.name, 'Domestic CI ' + username);
    const setCookie = login.headers.get('set-cookie');
    assert.ok(setCookie?.startsWith('medar_session='));
    const cookie = setCookie.split(';')[0];
    const sessionToken = cookie.slice('medar_session='.length);
    assert.match(sessionToken, /^[a-f0-9]{64}$/);
    const [[storedSession]] = await db.query('SELECT token_hash FROM medar_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1', [userId]);
    assert.ok(storedSession);
    assert.notEqual(storedSession.token_hash, sessionToken, 'The raw session token must never be stored in MySQL.');
    assert.match(storedSession.token_hash, /^[a-f0-9]{64}$/);

    const badLogin = await requestWithTimeout('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: password + '-wrong' }),
    });
    assert.equal(badLogin.status, 401, 'Invalid credentials must use the same generic authentication failure response.');
    assert.equal(badLogin.headers.get('set-cookie'), null, 'Failed authentication must not issue a session cookie.');
    const [[failedAttempt]] = await db.query(
      'SELECT succeeded FROM medar_login_attempts WHERE username_normalized=? ORDER BY attempted_at DESC LIMIT 1',
      [username],
    );
    assert.equal(Number(failedAttempt.succeeded), 0, 'Failed logins must be auditable without recording the submitted password.');

    const limitedUsername = username + '-limit';
    const limitedKey = createHash('sha256').update('username:' + limitedUsername).digest('hex');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const failed = await requestWithTimeout('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: limitedUsername, password: 'Incorrect-Domestic-Password' }),
      });
      assert.equal(failed.status, 401, 'Failed credentials should not reveal whether the username exists.');
    }
    const rateLimited = await requestWithTimeout('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: limitedUsername, password: 'Incorrect-Domestic-Password' }),
    });
    assert.equal(rateLimited.status, 429, 'Eight failed attempts must activate the fifteen-minute login limit.');
    const [[limitedRecord]] = await db.query('SELECT attempts FROM medar_rate_limits WHERE key_hash=?', [limitedKey]);
    assert.ok(Number(limitedRecord?.attempts) >= 8, 'The rate limit must be persisted for the normalized username key.');

    const me = await requestWithTimeout('http://localhost/api/auth/me', { headers: { cookie } });
    assert.equal(me.status, 200);
    const meBody = await me.json();
    assert.equal(meBody.user.id, userId);
    assert.equal(meBody.memberships[0].id, membershipId);

    const provisionedPassword = 'Domestic-Provisioned-Supplier-1405!';
    const provisionedUsername = 'ci_created_supplier_' + suffix;
    const provisionedFullName = 'Domestic CI Provisioned Supplier ' + suffix;
    const adminUsername = 'ci_created_admin_' + suffix;
    const adminPassword = 'Domestic-Provisioned-Admin-1405!';
    const escalationUsername = 'ci_forbidden_admin_' + suffix;
    const invalidSupplierUsername = 'ci_invalid_supplier_' + suffix;
    const customerRoleUsername = 'ci_customer_role_' + suffix;
    provisionedUsernames.push(provisionedUsername, adminUsername, escalationUsername, invalidSupplierUsername, customerRoleUsername);
    const memberRequest = (memberCookie, payload) => requestWithTimeout('http://localhost/api/workspace/members/create', {
      method: 'POST',
      headers: { ...(memberCookie ? { cookie: memberCookie } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const unauthenticatedMemberCreate = await memberRequest(null, {
      companyId, username: 'ci_unauth_' + suffix, fullName: 'Unauthenticated Member',
      password: provisionedPassword, role: 'staff',
    });
    assert.equal(unauthenticatedMemberCreate.status, 401, 'Only a valid session may provision a member account.');

    const createdSupplierResponse = await memberRequest(cookie, {
      companyId, username: provisionedUsername, fullName: provisionedFullName,
      password: provisionedPassword, role: 'supplier',
    });
    assert.equal(createdSupplierResponse.status, 201, 'An owner can create a supplier and its linked account.');
    const createdSupplierBody = await createdSupplierResponse.json();
    const createdSupplier = createdSupplierBody.member;
    assert.ok(createdSupplier?.id && createdSupplier?.membership_id && createdSupplier?.supplier_id);
    assert.equal(createdSupplier.username, provisionedUsername);
    assert.equal(createdSupplier.role, 'supplier');
    assert.equal(createdSupplier.company_id, companyId);
    provisionedUserIds.push(createdSupplier.id);
    provisionedMembershipIds.push(createdSupplier.membership_id);
    provisionedSupplierIds.push(createdSupplier.supplier_id);

    const [[createdSupplierUser]] = await db.query(
      'SELECT username, username_normalized, display_name, password_hash, account_status FROM medar_users WHERE id=?',
      [createdSupplier.id],
    );
    assert.equal(createdSupplierUser.username, provisionedUsername);
    assert.equal(createdSupplierUser.username_normalized, provisionedUsername);
    assert.equal(createdSupplierUser.display_name, provisionedFullName);
    assert.equal(createdSupplierUser.account_status, 'active');
    assert.notEqual(createdSupplierUser.password_hash, provisionedPassword, 'Plaintext passwords must never be stored.');
    assert.match(createdSupplierUser.password_hash, /^pbkdf2_sha256\$100000\$/);
    const [[createdProfile]] = await db.query('SELECT full_name, phone FROM profiles WHERE id=?', [createdSupplier.id]);
    assert.equal(createdProfile.full_name, provisionedFullName);
    const [[createdMembership]] = await db.query(
      'SELECT company_id, user_id, role, supplier_id, active, created_by FROM memberships WHERE id=?',
      [createdSupplier.membership_id],
    );
    assert.equal(createdMembership.company_id, companyId);
    assert.equal(createdMembership.user_id, createdSupplier.id);
    assert.equal(createdMembership.role, 'supplier');
    assert.equal(createdMembership.supplier_id, createdSupplier.supplier_id);
    assert.equal(Number(createdMembership.active), 1);
    assert.equal(createdMembership.created_by, userId);
    const [[createdSupplierRow]] = await db.query('SELECT company_id, name FROM suppliers WHERE id=?', [createdSupplier.supplier_id]);
    assert.equal(createdSupplierRow.company_id, companyId);
    assert.equal(createdSupplierRow.name, provisionedFullName);
    const [[createdAudit]] = await db.query(
      `SELECT action, entity_id, JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.username')) AS username FROM medar_audit_log WHERE action='membership.account_created' AND entity_id=? LIMIT 1`,
      [createdSupplier.membership_id],
    );
    assert.equal(createdAudit.action, 'membership.account_created');
    assert.equal(createdAudit.username, provisionedUsername);

    const duplicateMember = await memberRequest(cookie, {
      companyId, username: provisionedUsername, fullName: provisionedFullName,
      password: provisionedPassword, role: 'supplier',
    });
    assert.equal(duplicateMember.status, 409, 'Duplicate usernames must fail without partially creating another supplier or membership.');
    const [[duplicateUserCount]] = await db.query('SELECT COUNT(*) AS count FROM medar_users WHERE username_normalized=?', [provisionedUsername]);
    const [[duplicateProfileCount]] = await db.query('SELECT COUNT(*) AS count FROM profiles WHERE id=?', [createdSupplier.id]);
    const [[duplicateMembershipCount]] = await db.query('SELECT COUNT(*) AS count FROM memberships WHERE user_id=? AND company_id=?', [createdSupplier.id, companyId]);
    const [[duplicateSupplierCount]] = await db.query('SELECT COUNT(*) AS count FROM suppliers WHERE company_id=? AND name LIKE ?', [companyId, provisionedFullName + '%']);
    assert.equal(Number(duplicateUserCount.count), 1);
    assert.equal(Number(duplicateProfileCount.count), 1);
    assert.equal(Number(duplicateMembershipCount.count), 1);
    assert.equal(Number(duplicateSupplierCount.count), 1, 'A rolled-back duplicate must not leave an orphan supplier row.');

    const invalidSupplierLink = await memberRequest(cookie, {
      companyId, username: invalidSupplierUsername, fullName: 'Invalid Supplier Link',
      password: provisionedPassword, role: 'supplier', supplierId: randomUUID(),
    });
    assert.equal(invalidSupplierLink.status, 422, 'A supplier from another company or a nonexistent supplier ID must be rejected.');
    const invalidCustomerRole = await memberRequest(cookie, {
      companyId, username: customerRoleUsername, fullName: 'Forbidden Customer Role',
      password: provisionedPassword, role: 'customer',
    });
    assert.equal(invalidCustomerRole.status, 422, 'The private supply-chain release must not provision customer-ordering accounts.');

    const adminCreate = await memberRequest(cookie, {
      companyId, username: adminUsername, fullName: 'Domestic CI Admin', password: adminPassword, role: 'admin',
    });
    assert.equal(adminCreate.status, 201, 'The owner may create a manager/admin account.');
    const adminCreatedMember = (await adminCreate.json()).member;
    provisionedUserIds.push(adminCreatedMember.id);
    provisionedMembershipIds.push(adminCreatedMember.membership_id);
    assert.equal(adminCreatedMember.role, 'admin');

    const supplierLogin = await requestWithTimeout('http://localhost/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: provisionedUsername, password: provisionedPassword }),
    });
    assert.equal(supplierLogin.status, 200);
    const supplierCookie = supplierLogin.headers.get('set-cookie')?.split(';')[0];
    assert.ok(supplierCookie?.startsWith('medar_session='));
    const supplierCannotCreateStaff = await memberRequest(supplierCookie, {
      companyId, username: 'ci_supplier_forbidden_' + suffix, fullName: 'Forbidden Staff',
      password: provisionedPassword, role: 'staff',
    });
    assert.equal(supplierCannotCreateStaff.status, 403, 'A supplier cannot provision users.');

    const adminLogin = await requestWithTimeout('http://localhost/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: adminUsername, password: adminPassword }),
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = adminLogin.headers.get('set-cookie')?.split(';')[0];
    assert.ok(adminCookie?.startsWith('medar_session='));
    const adminEscalation = await memberRequest(adminCookie, {
      companyId, username: escalationUsername, fullName: 'Forbidden Second Admin',
      password: adminPassword, role: 'admin',
    });
    assert.equal(adminEscalation.status, 403, 'Only the owner may provision an admin account.');
    const [[escalatedCount]] = await db.query('SELECT COUNT(*) AS count FROM medar_users WHERE username_normalized=?', [escalationUsername]);
    assert.equal(Number(escalatedCount.count), 0, 'A denied role escalation must leave no user row.');

    const insertCustomer = await requestWithTimeout('http://localhost/api/data/customers', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'insert', values: { company_id: companyId, name: 'Domestic CI Customer' } }),
    });
    assert.equal(insertCustomer.status, 200);
    const inserted = await insertCustomer.json();
    assert.equal(inserted.count, 1);
    assert.match(inserted.data[0].id, /^[0-9a-f-]{36}$/i);
    assert.equal(inserted.data[0].company_id, companyId);

    const attemptedStatusOverride = await requestWithTimeout('http://localhost/api/data/orders', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'insert', values: {
        company_id: companyId,
        customer_id: inserted.data[0].id,
        reference: 'CI-PROTECTED-STATUS-' + username,
        status: 'delivered',
      } }),
    });
    assert.equal(attemptedStatusOverride.status, 200);
    const protectedOrder = await requestWithTimeout('http://localhost/api/data/orders', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'select', filters: [{ column: 'reference', op: 'eq', value: 'CI-PROTECTED-STATUS-' + username }] }),
    });
    assert.equal(protectedOrder.status, 200);
    assert.equal((await protectedOrder.json()).data[0].status, 'draft', 'Generic CRUD must not bypass protected order-state transitions.');

    const selectCustomers = await requestWithTimeout('http://localhost/api/data/customers', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'select', filters: [{ column: 'name', op: 'eq', value: 'Domestic CI Customer' }], count: true }),
    });
    assert.equal(selectCustomers.status, 200);
    const selected = await selectCustomers.json();
    assert.equal(selected.count, 1);
    assert.equal(selected.data[0].name, 'Domestic CI Customer');

    const atomicInsert = await requestWithTimeout('http://localhost/api/data/customers', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'insert', values: [
        { company_id: companyId, name: 'Atomic CI Customer' },
        { company_id: companyId, name: 'Invalid Atomic Customer', unknown_column: 'must-fail' },
      ] }),
    });
    assert.equal(atomicInsert.status, 422);
    const [[atomicCount]] = await db.query('SELECT COUNT(*) AS count FROM customers WHERE company_id=? AND name=?', [companyId, 'Atomic CI Customer']);
    assert.equal(Number(atomicCount.count), 0, 'A failed bulk insert must roll back all earlier rows in the same batch.');

    const projectedSelect = await requestWithTimeout('http://localhost/api/data/customers', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'select',
        selection: 'id,name',
        filters: [{ column: 'name', op: 'not_in', value: '(Nobody,Other)' }],
        orFilters: [{ column: 'name', op: 'eq', value: 'Domestic CI Customer' }],
      }),
    });
    assert.equal(projectedSelect.status, 200);
    const projected = await projectedSelect.json();
    assert.ok(projected.data.some((row) => row.name === 'Domestic CI Customer'));
    assert.deepEqual(Object.keys(projected.data[0]).sort(), ['id','name']);

    const crossTenantInsert = await requestWithTimeout('http://localhost/api/data/customers', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'insert', values: { company_id: randomUUID(), name: 'Cross Tenant Customer' } }),
    });
    assert.equal(crossTenantInsert.status, 403, 'Generic writes must not allow users to target a company they do not belong to.');

    const deniedTable = await requestWithTimeout('http://localhost/api/data/medar_users', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'select' }),
    });
    assert.equal(deniedTable.status, 404, 'Authentication tables must not be exposed through the generic data API.');

    const taskId = randomUUID();
    await db.execute(
      "INSERT INTO operational_tasks (id,company_id,assignee_user_id,assigned_by,title,status) VALUES (?,?,?,?,?,'pending')",
      [taskId, companyId, userId, userId, 'Domestic CI task lifecycle'],
    );
    const rpc = async (name, args) => requestWithTimeout('http://localhost/api/rpc/' + name, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ args }),
    });
    const startTask = await rpc('start_operational_task', { _task: taskId });
    assert.equal(startTask.status, 200);
    const submitTask = await rpc('submit_operational_task', { _task: taskId, _completion_note: 'Completed by CI' });
    assert.equal(submitTask.status, 200);
    const reviewTask = await rpc('review_operational_task', { _task: taskId, _decision: 'approved', _review_note: 'Verified by CI' });
    assert.equal(reviewTask.status, 200);
    const [[taskAfterReview]] = await db.query('SELECT status,reviewed_by,reviewed_at,completion_note FROM operational_tasks WHERE id=?', [taskId]);
    assert.equal(taskAfterReview.status, 'approved');
    assert.equal(taskAfterReview.reviewed_by, userId);
    assert.ok(taskAfterReview.reviewed_at);
    assert.equal(taskAfterReview.completion_note, 'Completed by CI');
    const invalidReview = await rpc('review_operational_task', { _task: taskId, _decision: 'rejected', _review_note: 'Too late' });
    assert.equal(invalidReview.status, 422, 'A reviewed task cannot be transitioned a second time.');

    const supplierId = randomUUID();
    const agreementId = randomUUID();
    await db.execute('INSERT INTO suppliers (id,company_id,name) VALUES (?,?,?)', [supplierId, companyId, 'Domestic CI Partner']);

    supplierUserId = randomUUID();
    supplierMembershipId = randomUUID();
    const supplierUsername = 'ci_supplier_' + suffix;
    const supplierPassword = 'Domestic-Supplier-Test-Password-1405!';
    await db.execute(
      'INSERT INTO medar_users (id,username,username_normalized,display_name,password_hash,requested_role,account_status) VALUES (?,?,?,?,?,?,?)',
      [supplierUserId, supplierUsername, supplierUsername, 'CI Supplier User', await hashPassword(supplierPassword), 'supplier', 'active'],
    );
    await db.execute(
      'INSERT INTO memberships (id,company_id,user_id,supplier_id,role,active,created_by) VALUES (?,?,?,?,?,TRUE,?)',
      [supplierMembershipId, companyId, supplierUserId, supplierId, 'supplier', userId],
    );
    const supplierLoginForDataApi = await requestWithTimeout('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: supplierUsername, password: supplierPassword }),
    });
    assert.equal(supplierLoginForDataApi.status, 200);
    const supplierCookieForDataApi = String(supplierLoginForDataApi.headers.get('set-cookie') || '').split(';')[0];
    assert.match(supplierCookieForDataApi, /^medar_session=[a-f0-9]{64}$/);
    const supplierRead = await requestWithTimeout('http://localhost/api/data/suppliers', {
      method: 'POST',
      headers: { cookie: supplierCookieForDataApi, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'select' }),
    });
    assert.equal(supplierRead.status, 200);
    const supplierRows = await supplierRead.json();
    assert.deepEqual(supplierRows.data.map((row) => row.id), [supplierId], 'A supplier membership must be scoped to its own supplier record.');
    const supplierWrite = await requestWithTimeout('http://localhost/api/data/customers', {
      method: 'POST',
      headers: { cookie: supplierCookieForDataApi, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'insert', values: { company_id: companyId, name: 'Supplier Must Not Create Customers' } }),
    });
    assert.equal(supplierWrite.status, 403, 'Supplier roles must not write internal customer records.');

    const fileName = 'capacity-ci-' + username + '.png';
    const evidencePath = companyId + '/' + supplierId + '/' + fileName;
    const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    const mismatchedUpload = await requestWithTimeout('http://localhost/api/storage/capacity-evidence?path=' + encodeURIComponent(evidencePath), {
      method: 'PUT',
      headers: { cookie, 'content-type': 'image/jpeg' },
      body: imageBytes,
    });
    assert.equal(mismatchedUpload.status, 415, 'The API must reject a declared MIME type that does not match the file signature.');
    const uploadFile = await requestWithTimeout('http://localhost/api/storage/capacity-evidence?path=' + encodeURIComponent(evidencePath), {
      method: 'PUT',
      headers: { cookie, 'content-type': 'image/png' },
      body: imageBytes,
    });
    assert.equal(uploadFile.status, 200, 'Authorized managers must be able to upload evidence.');
    assert.equal((await uploadFile.json()).data.size, imageBytes.length);
    const [[fileMetadata]] = await db.query('SELECT company_id,content_type,size_bytes,uploaded_by FROM medar_files WHERE bucket_id=? AND name=?', ['capacity-evidence', evidencePath]);
    assert.equal(fileMetadata.company_id, companyId);
    assert.equal(fileMetadata.content_type, 'image/png');
    assert.equal(Number(fileMetadata.size_bytes), imageBytes.length);
    assert.equal(fileMetadata.uploaded_by, userId);

    const downloadFile = await requestWithTimeout('http://localhost/api/storage/capacity-evidence?path=' + encodeURIComponent(evidencePath), { headers: { cookie } });
    assert.equal(downloadFile.status, 200);
    assert.equal(downloadFile.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await downloadFile.arrayBuffer()), imageBytes);
    const rangedFile = await requestWithTimeout('http://localhost/api/storage/capacity-evidence?path=' + encodeURIComponent(evidencePath), {
      headers: { cookie, range: 'bytes=1-3' },
    });
    assert.equal(rangedFile.status, 206);
    assert.deepEqual(new Uint8Array(await rangedFile.arrayBuffer()), imageBytes.slice(1, 4));

    const removeFile = await requestWithTimeout('http://localhost/api/storage/capacity-evidence/remove', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ paths: [evidencePath] }),
    });
    assert.equal(removeFile.status, 200);
    assert.deepEqual((await removeFile.json()).data, [evidencePath]);
    const [[removedMetadata]] = await db.query('SELECT id FROM medar_files WHERE bucket_id=? AND name=?', ['capacity-evidence', evidencePath]);
    assert.equal(removedMetadata, undefined);

    await db.execute(
      "INSERT INTO partnership_agreements (id,company_id,supplier_id,agreement_code,status,effective_from,company_profit_share_pct,partner_profit_share_pct,shared_expense_categories,signed_document_path,signed_at,approved_by,approved_at,created_by) VALUES (?,?,?,?,'active','2025-01-01',50,50,?,'ci/signed-agreement.pdf',NOW(3),?,NOW(3),?)",
      [agreementId, companyId, supplierId, 'CI-SETTLEMENT-' + username, JSON.stringify({ feed: true }), userId, userId],
    );
    await db.execute(
      "INSERT INTO partner_financial_entries (id,company_id,supplier_id,agreement_id,entry_type,status,direction,amount,paid_amount,currency,paid_by,payment_status,recognized_on,external_reference,created_by,submitted_by,submitted_at,approved_by,approved_at,posted_by,posted_at) VALUES (?,?,?,?,'sale_collection','posted','inflow_to_company',10000,10000,'TOMAN','customer','paid','2026-01-15',?,?,?,NOW(3),?,NOW(3),?,NOW(3))",
      [randomUUID(), companyId, supplierId, agreementId, 'CI-SETTLEMENT-COLLECTION-' + username, userId, userId, userId, userId],
    );
    const createPeriod = await rpc('create_partner_settlement_period', {
      _agreement: agreementId, _period_start: '2026-01-01', _period_end: '2026-01-31',
    });
    assert.equal(createPeriod.status, 200);
    const createdPeriodBody = await createPeriod.json();
    const periodId = createdPeriodBody.data.id;
    assert.match(periodId, /^[0-9a-f-]{36}$/i);
    const [[createdPeriod]] = await db.query(
      'SELECT collected_revenue,partner_share_amount,balance_due_to_partner,recorded_cash_available,status FROM partner_settlement_periods WHERE id=?',
      [periodId],
    );
    assert.equal(String(createdPeriod.collected_revenue), '10000');
    assert.equal(String(createdPeriod.partner_share_amount), '5000');
    assert.equal(String(createdPeriod.balance_due_to_partner), '5000');
    assert.equal(String(createdPeriod.recorded_cash_available), '10000');
    assert.equal(createdPeriod.status, 'draft');

    const overlapPeriod = await rpc('create_partner_settlement_period', {
      _agreement: agreementId, _period_start: '2026-01-15', _period_end: '2026-02-15',
    });
    assert.equal(overlapPeriod.status, 422, 'Settlement periods must not overlap for the same agreement.');
    const approvePeriod = await rpc('approve_partner_settlement_period', { _period: periodId });
    assert.equal(approvePeriod.status, 200);
    const payPeriod = await rpc('record_partner_settlement_payment', {
      _period: periodId, _amount: 3000, _payment_reference: 'CI-PAYMENT-' + username,
    });
    assert.equal(payPeriod.status, 200);
    const partialPeriod = await rpc('record_partner_settlement_payment', {
      _period: periodId, _amount: 2000, _payment_reference: 'CI-PAYMENT-FINAL-' + username,
    });
    assert.equal(partialPeriod.status, 200);
    const [[settledPeriod]] = await db.query('SELECT status,settled_amount,settled_by,settled_at FROM partner_settlement_periods WHERE id=?', [periodId]);
    assert.equal(settledPeriod.status, 'settled');
    assert.equal(String(settledPeriod.settled_amount), '5000');
    assert.equal(settledPeriod.settled_by, userId);
    assert.ok(settledPeriod.settled_at);

    const logout = await requestWithTimeout('http://localhost/api/auth/logout', { method: 'POST', headers: { cookie } });
    assert.equal(logout.status, 200);
    const afterLogout = await requestWithTimeout('http://localhost/api/auth/me', { headers: { cookie } });
    assert.deepEqual(await afterLogout.json(), { user: null, memberships: [] });
  } finally {
    await db.execute('DELETE FROM medar_rate_limits WHERE key_hash IN (?,?)', [usernameKey, createHash('sha256').update('username:' + username + '-limit').digest('hex')]);
    await db.execute('DELETE FROM medar_login_attempts WHERE username_normalized IN (?,?)', [username, username + '-limit']);
    await db.execute('DELETE FROM medar_files WHERE company_id=?', [companyId]);
    for (const bucket of ['delivery-evidence','operational-evidence','contract-documents','capacity-evidence']) {
      await rm(resolve(process.env.MEDAR_STORAGE_DIR || './storage/medar', bucket, companyId), { recursive: true, force: true });
    }
    if (supplierUserId) {
      await db.execute('DELETE FROM medar_sessions WHERE user_id=?', [supplierUserId]);
      await db.execute('DELETE FROM memberships WHERE id=?', [supplierMembershipId]);
      await db.execute('DELETE FROM medar_login_attempts WHERE username_normalized=?', ['ci_supplier_' + suffix]);
      await db.execute('DELETE FROM medar_users WHERE id=?', [supplierUserId]);
    }
    for (const provisionedMembershipId of provisionedMembershipIds) {
      await db.execute('DELETE FROM medar_audit_log WHERE entity_id=?', [provisionedMembershipId]);
      await db.execute('DELETE FROM medar_sessions WHERE user_id IN (SELECT user_id FROM memberships WHERE id=?)', [provisionedMembershipId]);
      await db.execute('DELETE FROM memberships WHERE id=?', [provisionedMembershipId]);
    }
    for (const provisionedSupplierId of provisionedSupplierIds) {
      await db.execute('DELETE FROM suppliers WHERE id=? AND company_id=?', [provisionedSupplierId, companyId]);
    }
    for (const provisionedUserId of provisionedUserIds) {
      await db.execute('DELETE FROM medar_sessions WHERE user_id=?', [provisionedUserId]);
      await db.execute('DELETE FROM profiles WHERE id=?', [provisionedUserId]);
      await db.execute('DELETE FROM medar_users WHERE id=?', [provisionedUserId]);
    }
    for (const provisionedUsername of provisionedUsernames) {
      await db.execute('DELETE FROM medar_rate_limits WHERE key_hash=?', [createHash('sha256').update('username:' + provisionedUsername).digest('hex')]);
      await db.execute('DELETE FROM medar_login_attempts WHERE username_normalized=?', [provisionedUsername]);
    }
    await db.execute('DELETE FROM medar_audit_log WHERE actor_user_id=? AND action=\'membership.account_created\'', [userId]);
    await db.execute('DELETE FROM memberships WHERE id=?', [membershipId]);
    await db.execute('DELETE FROM companies WHERE id=?', [companyId]);
    await db.execute('DELETE FROM medar_users WHERE id=?', [userId]);
    await db.end();
    await closePool();
  }
});
