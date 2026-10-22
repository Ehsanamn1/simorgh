import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { app, hashPassword, closePool } from './server.mjs';

const mysqlUrl = process.env.MYSQL_URL;
if (!mysqlUrl) throw new Error('MYSQL_URL is required for domestic API integration tests.');
const db = mysql.createPool(mysqlUrl);
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const username = 'ci_medar_' + suffix;
const password = 'Domestic-Test-Password-1405!';
const userId = randomUUID();
const companyId = randomUUID();
const membershipId = randomUUID();
let sessionCookie = '';

after(async () => {
  try {
    await db.execute('DELETE FROM medar_sessions WHERE user_id=?', [userId]);
    await db.execute('DELETE FROM memberships WHERE id=?', [membershipId]);
    await db.execute('DELETE FROM medar_audit_log WHERE actor_user_id=?', [userId]);
    await db.execute('DELETE FROM medar_login_attempts WHERE username_normalized=?', [username]);
    await db.execute('DELETE FROM medar_users WHERE id=?', [userId]);
    await db.execute('DELETE FROM companies WHERE id=?', [companyId]);
  } finally {
    await db.end();
    await closePool();
  }
});

test('domestic MySQL API supports health, login, session, memberships, password change and logout', async () => {
  const encodedPassword = await hashPassword(password);
  await db.execute('INSERT INTO companies (id,name,province) VALUES (?,?,?)', [companyId, 'CI Medar Workspace', 'Golestan']);
  await db.execute(
    'INSERT INTO medar_users (id,username,username_normalized,display_name,password_hash,requested_role,account_status) VALUES (?,?,?,?,?,?,?)',
    [userId, username, username, 'CI Medar User', encodedPassword, 'owner', 'active'],
  );
  await db.execute(
    'INSERT INTO memberships (id,company_id,user_id,role,active) VALUES (?,?,?,?,TRUE)',
    [membershipId, companyId, userId, 'owner'],
  );

  const health = await app.request('/api/health');
  assert.equal(health.status, 200, 'health endpoint must confirm MySQL connectivity');
  assert.equal((await health.json()).database, true);

  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200, 'valid credentials should establish a session');
  sessionCookie = String(login.headers.get('set-cookie') || '').split(';')[0];
  assert.match(sessionCookie, /^medar_session=[a-f0-9]{64}$/);
  assert.match(String(login.headers.get('set-cookie')), /HttpOnly/);
  assert.match(String(login.headers.get('set-cookie')), /SameSite=Lax/);

  const me = await app.request('/api/auth/me', { headers: { cookie: sessionCookie } });
  assert.equal(me.status, 200);
  const mePayload = await me.json();
  assert.equal(mePayload.user.id, userId);
  assert.equal(mePayload.user.username, username);
  assert.equal(mePayload.memberships.length, 1);
  assert.equal(mePayload.memberships[0].id, membershipId);
  assert.equal(mePayload.memberships[0].company.name, 'CI Medar Workspace');

  const membershipList = await app.request('/api/workspace/memberships', { headers: { cookie: sessionCookie } });
  assert.equal(membershipList.status, 200);
  assert.equal((await membershipList.json()).memberships.length, 1);

  const changed = await app.request('/api/auth/password/change', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ currentPassword: password, newPassword: 'Domestic-Test-Password-Changed-1405!' }),
  });
  assert.equal(changed.status, 200, 'authenticated user should be able to change their password');
  const [sessions] = await db.execute('SELECT revoked_at FROM medar_sessions WHERE user_id=?', [userId]);
  assert.ok(sessions.every(row => row.revoked_at !== null), 'password change must revoke existing sessions including the current session only after the response path');

  const logout = await app.request('/api/auth/logout', {
    method: 'POST',
    headers: { cookie: sessionCookie },
  });
  assert.equal(logout.status, 200);
  assert.match(String(logout.headers.get('set-cookie')), /Max-Age=0/);
});
