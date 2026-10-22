import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { app, hashPassword, closePool } from './server.mjs';

test('domestic API authenticates a provisioned MySQL user and revokes the session on logout', { skip: !process.env.MYSQL_URL }, async () => {
  const db = await mysql.createConnection(process.env.MYSQL_URL);
  const userId = randomUUID();
  const companyId = randomUUID();
  const membershipId = randomUUID();
  const username = 'ci_' + randomBytes(5).toString('hex');
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

    const health = await app.request('http://localhost/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: 'medar-domestic-api', database: true, auth: 'mysql' });

    const login = await app.request('http://localhost/api/auth/login', {
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

    const me = await app.request('http://localhost/api/auth/me', { headers: { cookie } });
    assert.equal(me.status, 200);
    const meBody = await me.json();
    assert.equal(meBody.user.id, userId);
    assert.equal(meBody.memberships[0].id, membershipId);

    const insertCustomer = await app.request('http://localhost/api/data/customers', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'insert', values: { company_id: companyId, name: 'Domestic CI Customer' } }),
    });
    assert.equal(insertCustomer.status, 200);
    const inserted = await insertCustomer.json();
    assert.equal(inserted.count, 1);
    assert.match(inserted.data[0].id, /^[0-9a-f-]{36}$/i);
    assert.equal(inserted.data[0].company_id, companyId);

    const selectCustomers = await app.request('http://localhost/api/data/customers', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'select', filters: [{ column: 'name', op: 'eq', value: 'Domestic CI Customer' }], count: true }),
    });
    assert.equal(selectCustomers.status, 200);
    const selected = await selectCustomers.json();
    assert.equal(selected.count, 1);
    assert.equal(selected.data[0].name, 'Domestic CI Customer');

    const crossTenantInsert = await app.request('http://localhost/api/data/customers', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'insert', values: { company_id: randomUUID(), name: 'Cross Tenant Customer' } }),
    });
    assert.equal(crossTenantInsert.status, 403, 'Generic writes must not allow users to target a company they do not belong to.');

    const deniedTable = await app.request('http://localhost/api/data/medar_users', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'select' }),
    });
    assert.equal(deniedTable.status, 404, 'Authentication tables must not be exposed through the generic data API.');

    const logout = await app.request('http://localhost/api/auth/logout', { method: 'POST', headers: { cookie } });
    assert.equal(logout.status, 200);
    const afterLogout = await app.request('http://localhost/api/auth/me', { headers: { cookie } });
    assert.deepEqual(await afterLogout.json(), { user: null, memberships: [] });
  } finally {
    await db.execute('DELETE FROM medar_rate_limits WHERE key_hash=?', [usernameKey]);
    await db.execute('DELETE FROM medar_login_attempts WHERE username_normalized=?', [username]);
    await db.execute('DELETE FROM memberships WHERE id=?', [membershipId]);
    await db.execute('DELETE FROM companies WHERE id=?', [companyId]);
    await db.execute('DELETE FROM medar_users WHERE id=?', [userId]);
    await db.end();
    await closePool();
  }
});
