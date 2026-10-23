import test, { after } from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { app, hashPassword, closePool } from './server.mjs';

const mysqlUrl = process.env.MYSQL_URL;
const db = mysqlUrl ? mysql.createPool(mysqlUrl) : null;
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const username = 'ci_medar_' + suffix;
const password = 'Domestic-Test-Password-1405!';
const userId = randomUUID();
const companyId = randomUUID();
const membershipId = randomUUID();
let sessionCookie = '';

after(async () => {
  if (!db) return;
  console.log('[medar-integration] cleanup:start');
  try {
    console.log('[medar-integration] cleanup:sessions');
    console.log('[medar-integration] cleanup:operational-records');
    await db.execute('DELETE FROM medar_exception_cases WHERE company_id=?', [companyId]);
    await db.execute('DELETE FROM medar_operational_events WHERE company_id=?', [companyId]);
    await db.execute('DELETE FROM notifications WHERE company_id=?', [companyId]);
    await db.execute('DELETE FROM medar_client_presence WHERE company_id=?', [companyId]);
    await db.execute('DELETE FROM medar_sessions WHERE user_id=?', [userId]);
    await db.execute('DELETE FROM memberships WHERE id=?', [membershipId]);
    await db.execute('DELETE FROM medar_audit_log WHERE actor_user_id=?', [userId]);
    await db.execute('DELETE FROM medar_login_attempts WHERE username_normalized=?', [username]);
    await db.execute('DELETE FROM medar_users WHERE id=?', [userId]);
    await db.execute('DELETE FROM companies WHERE id=?', [companyId]);
    console.log('[medar-integration] cleanup:rows-deleted');
  } finally {
    console.log('[medar-integration] cleanup:close-test-pool');
    await db.end();
    console.log('[medar-integration] cleanup:close-app-pool');
    await closePool();
    console.log('[medar-integration] cleanup:complete');
  }
});

test('domestic MySQL API supports health, login, session, memberships, password change and logout', { skip: !mysqlUrl, timeout: 120_000 }, async () => {
  if (!db) return;
  console.log('[medar-integration] setup:hash-password');
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

  console.log('[medar-integration] request:health');
  const health = await app.request('/api/health');
  assert.equal(health.status, 200, 'health endpoint must confirm MySQL connectivity');
  assert.equal((await health.json()).database, true);

  console.log('[medar-integration] request:login');
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

  console.log('[medar-integration] request:me');
  const me = await app.request('/api/auth/me', { headers: { cookie: sessionCookie } });
  assert.equal(me.status, 200);
  const mePayload = await me.json();
  assert.equal(mePayload.user.id, userId);
  assert.equal(mePayload.user.username, username);
  assert.equal(mePayload.memberships.length, 1);
  assert.equal(mePayload.memberships[0].id, membershipId);
  assert.equal(mePayload.memberships[0].company.name, 'CI Medar Workspace');

  console.log('[medar-integration] request:memberships');
  const membershipList = await app.request('/api/workspace/memberships', { headers: { cookie: sessionCookie } });
  assert.equal(membershipList.status, 200);
  assert.equal((await membershipList.json()).memberships.length, 1);

  console.log('[medar-integration] request:notifications');
  const firstNotificationId = randomUUID();
  await db.execute(
    'INSERT INTO notifications(id,company_id,user_id,title,body,href,dedupe_key) VALUES(?,?,?,?,?,?,?)',
    [firstNotificationId,companyId,userId,'CI notification','Unread fixture','/madar/app/home','ci-notification-'+suffix],
  );
  const notificationsResponse = await app.request('/api/notifications?companyId='+companyId, { headers: { cookie: sessionCookie } });
  assert.equal(notificationsResponse.status, 200);
  const notificationsPayload = await notificationsResponse.json();
  assert.equal(notificationsPayload.summary.total, 1);
  assert.equal(notificationsPayload.summary.unread, 1);
  assert.equal(notificationsPayload.notifications[0].id, firstNotificationId);

  const markOne = await app.request('/api/notifications/'+firstNotificationId+'/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId }),
  });
  assert.equal(markOne.status, 200);
  assert.ok((await markOne.json()).notification.readAt);

  await db.execute(
    'INSERT INTO notifications(id,company_id,user_id,title,body,href,dedupe_key) VALUES(?,?,?,?,?,?,?)',
    [randomUUID(),companyId,userId,'CI second notification','Unread fixture','/madar/app/home','ci-notification-second-'+suffix],
  );
  const markAll = await app.request('/api/notifications/read-all', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId }),
  });
  assert.equal(markAll.status, 200);
  assert.equal((await markAll.json()).updated, 1);
  const notificationSummary = await app.request('/api/notifications?companyId='+companyId, { headers: { cookie: sessionCookie } });
  assert.equal((await notificationSummary.json()).summary.unread, 0);

  console.log('[medar-integration] request:client-heartbeat');
  const clientId = randomUUID();
  const heartbeat = await app.request('/api/client/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, clientId, platform: 'web', appVersion: 'ci-test' }),
  });
  assert.equal(heartbeat.status, 200);
  assert.ok((await heartbeat.json()).lastSeenAt);
  const invalidHeartbeat = await app.request('/api/client/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, clientId: 'not-a-uuid', platform: 'web', appVersion: 'ci-test' }),
  });
  assert.equal(invalidHeartbeat.status, 422);

  console.log('[medar-integration] request:operational-events');
  const eventIdempotencyKey = 'ci-event-' + suffix;
  const eventInput = {
    companyId, eventType: 'ci.domestic_event', severity: 'info', sourceType: 'system',
    title: 'CI operational event', body: 'Testing the domestic MySQL event endpoint',
    payload: { source: 'integration-test' }, idempotencyKey: eventIdempotencyKey,
  };
  const createEvent = await app.request('/api/operational/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify(eventInput),
  });
  assert.equal(createEvent.status, 201);
  const createdEvent = (await createEvent.json()).event;
  assert.ok(createdEvent.id);
  assert.equal(createdEvent.eventType, 'ci.domestic_event');
  assert.equal(createdEvent.payload.source, 'integration-test');
  const createDuplicateEvent = await app.request('/api/operational/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify(eventInput),
  });
  assert.equal(createDuplicateEvent.status, 201);
  assert.equal((await createDuplicateEvent.json()).event.id, createdEvent.id, 'same idempotency key must not create a duplicate event');
  const [[eventCount]] = await db.execute('SELECT COUNT(*) AS n FROM medar_operational_events WHERE company_id=? AND idempotency_key=?', [companyId,eventIdempotencyKey]);
  assert.equal(Number(eventCount.n), 1);

  const eventList = await app.request('/api/operational/events?companyId='+companyId, { headers: { cookie: sessionCookie } });
  assert.equal(eventList.status, 200);
  assert.equal((await eventList.json()).events.length, 1);
  const noOtherCompanyAccess = await app.request('/api/operational/events?companyId='+randomUUID(), { headers: { cookie: sessionCookie } });
  assert.equal(noOtherCompanyAccess.status, 403);

  console.log('[medar-integration] request:exception-lifecycle');
  const exceptionKey = 'ci-exception-' + suffix;
  const createException = await app.request('/api/operational/exceptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({
      companyId, eventId: createdEvent.id, title: 'CI exception case',
      details: 'Testing exception state transitions', severity: 'warning',
      assignedUserId: userId, dedupeKey: exceptionKey,
    }),
  });
  assert.equal(createException.status, 201);
  const createdException = (await createException.json()).exception;
  assert.ok(createdException.id);
  assert.equal(createdException.status, 'open');
  assert.equal(createdException.eventId, createdEvent.id);

  const exceptionList = await app.request('/api/operational/exceptions?companyId='+companyId+'&status=open', { headers: { cookie: sessionCookie } });
  assert.equal(exceptionList.status, 200);
  assert.equal((await exceptionList.json()).exceptions.length, 1);

  const acknowledge = await app.request('/api/operational/exceptions/'+createdException.id+'/acknowledge', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: sessionCookie }, body: JSON.stringify({ companyId }),
  });
  assert.equal(acknowledge.status, 200);
  assert.equal((await acknowledge.json()).exception.status, 'acknowledged');

  const start = await app.request('/api/operational/exceptions/'+createdException.id+'/start', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: sessionCookie }, body: JSON.stringify({ companyId }),
  });
  assert.equal(start.status, 200);
  assert.equal((await start.json()).exception.status, 'in_progress');

  const resolve = await app.request('/api/operational/exceptions/'+createdException.id+'/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, resolutionNote: 'Confirmed by MySQL integration test' }),
  });
  assert.equal(resolve.status, 200);
  assert.equal((await resolve.json()).exception.status, 'resolved');
  const resolvedList = await app.request('/api/operational/exceptions?companyId='+companyId+'&status=resolved', { headers: { cookie: sessionCookie } });
  assert.equal((await resolvedList.json()).exceptions.length, 1);

  console.log('[medar-integration] request:password-change');
  const changed = await app.request('/api/auth/password/change', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ currentPassword: password, newPassword: 'Domestic-Test-Password-Changed-1405!' }),
  });
  assert.equal(changed.status, 200, 'authenticated user should be able to change their password');
  const [sessions] = await db.execute('SELECT revoked_at FROM medar_sessions WHERE user_id=?', [userId]);
  assert.ok(sessions.some(row => row.revoked_at === null), 'password change should keep the current session while revoking other sessions');

  console.log('[medar-integration] request:logout');
  const logout = await app.request('/api/auth/logout', {
    method: 'POST',
    headers: { cookie: sessionCookie },
  });
  assert.equal(logout.status, 200);
  assert.match(String(logout.headers.get('set-cookie')), /Max-Age=0/);
  console.log('[medar-integration] test:complete');
});
