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
    console.log('[medar-integration] cleanup:conversations');
    console.log('[medar-integration] cleanup:bank-records');
    console.log('[medar-integration] cleanup:contact-import');
    console.log('[medar-integration] cleanup:ai-actions-and-tasks');
    await db.execute('DELETE FROM medar_ai_action_runs WHERE company_id=?', [companyId]);
    await db.execute('DELETE FROM operational_tasks WHERE company_id=? AND title IN (?,?)', [companyId,'CI domestic AI action task execute '+suffix,'CI domestic AI action task cancel '+suffix]);
    await db.execute('DELETE FROM suppliers WHERE company_id=? AND name IN (?,?)', [companyId,'CI Domestic Supplier '+suffix,'CI Domestic Supplier '+suffix+' ('+userId.slice(0,8)+')']);
    await db.execute('DELETE FROM customers WHERE company_id=? AND name=?', [companyId,'CI Domestic Customer '+suffix]);
    await db.execute('DELETE FROM medar_bank_transactions WHERE company_id=?', [companyId]);
    await db.execute('DELETE FROM medar_bank_accounts WHERE company_id=?', [companyId]);
    await db.execute('DELETE FROM medar_messages WHERE company_id=?', [companyId]);
    await db.execute('DELETE FROM medar_conversation_participants WHERE company_id=?', [companyId]);
    await db.execute('DELETE FROM medar_conversations WHERE company_id=?', [companyId]);
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
  const markOneAgain = await app.request('/api/notifications/'+firstNotificationId+'/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId }),
  });
  assert.equal(markOneAgain.status, 200, 'reading an already-read notification should be idempotent');

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

  console.log('[medar-integration] request:module-permissions-and-client-admin');
  const modulePermissionsResponse = await app.request('/api/workspace/my-module-permissions?companyId='+companyId, { headers: { cookie: sessionCookie } });
  assert.equal(modulePermissionsResponse.status, 200);
  const modulePermissions = await modulePermissionsResponse.json();
  assert.equal(modulePermissions.permissions.home, true);
  assert.equal(modulePermissions.permissions.audit, true);

  const adminClients = await app.request('/api/admin/system/clients?companyId='+companyId, { headers: { cookie: sessionCookie } });
  assert.equal(adminClients.status, 200);
  const adminClientPayload = await adminClients.json();
  assert.equal(adminClientPayload.summary.knownClients, 1);
  assert.equal(adminClientPayload.summary.onlineClients, 1);
  assert.equal(adminClientPayload.clients[0].clientId, clientId);

  console.log('[medar-integration] request:connect');
  const peopleResponse = await app.request('/api/connect/people?companyId='+companyId, { headers: { cookie: sessionCookie } });
  assert.equal(peopleResponse.status, 200);
  assert.ok((await peopleResponse.json()).people.some(person => person.id === userId));

  const createConversation = await app.request('/api/connect/conversations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, title: 'CI team conversation', participantUserIds: [userId] }),
  });
  assert.equal(createConversation.status, 201);
  const conversationId = (await createConversation.json()).conversation.id;
  assert.ok(conversationId);

  const conversationList = await app.request('/api/connect/conversations?companyId='+companyId, { headers: { cookie: sessionCookie } });
  assert.equal(conversationList.status, 200);
  assert.ok((await conversationList.json()).conversations.some(conversation => conversation.id === conversationId));

  const clientMessageId = 'ci-message-' + suffix;
  const firstMessage = await app.request('/api/connect/conversations/'+conversationId+'/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, body: 'First test message', clientMessageId }),
  });
  assert.equal(firstMessage.status, 201);
  const firstMessagePayload = (await firstMessage.json()).message;
  assert.equal(firstMessagePayload.body, 'First test message');

  const duplicateMessage = await app.request('/api/connect/conversations/'+conversationId+'/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, body: 'This retry must not replace the original', clientMessageId }),
  });
  assert.equal(duplicateMessage.status, 201);
  const duplicateMessagePayload = (await duplicateMessage.json()).message;
  assert.equal(duplicateMessagePayload.id, firstMessagePayload.id);
  assert.equal(duplicateMessagePayload.body, 'First test message');
  const [[messageCount]] = await db.execute('SELECT COUNT(*) AS n FROM medar_messages WHERE company_id=? AND conversation_id=? AND sender_user_id=? AND client_message_id=?', [companyId,conversationId,userId,clientMessageId]);
  assert.equal(Number(messageCount.n), 1);

  const messagesResponse = await app.request('/api/connect/conversations/'+conversationId+'/messages?companyId='+companyId, { headers: { cookie: sessionCookie } });
  assert.equal(messagesResponse.status, 200);
  const messagePayload = await messagesResponse.json();
  assert.equal(messagePayload.messages.length, 1);
  assert.equal(messagePayload.messages[0].id, firstMessagePayload.id);

  console.log('[medar-integration] request:ai-action-lifecycle');
  const proposeAction = await app.request('/api/ai/actions/propose', {
    method:'POST',
    headers:{'content-type':'application/json',cookie:sessionCookie},
    body:JSON.stringify({
      companyId,
      toolKey:'create_operational_task',
      arguments:{title:'CI domestic AI action task execute '+suffix,instructions:'Create a task only after explicit owner confirmation.',priority:'high',assigneeUserId:userId},
    }),
  });
  assert.equal(proposeAction.status,201);
  const proposedAction=(await proposeAction.json()).action;
  assert.equal(proposedAction.status,'proposed');
  assert.equal(proposedAction.requiresConfirmation,undefined);

  const actionList = await app.request('/api/ai/actions?companyId='+companyId+'&status=proposed',{headers:{cookie:sessionCookie}});
  assert.equal(actionList.status,200);
  assert.ok((await actionList.json()).actions.some(action=>action.id===proposedAction.id));

  const noConfirmation = await app.request('/api/ai/actions/'+proposedAction.id+'/execute',{
    method:'POST',headers:{'content-type':'application/json',cookie:sessionCookie},
    body:JSON.stringify({companyId,confirmed:false}),
  });
  assert.equal(noConfirmation.status,422);

  const executeAction = await app.request('/api/ai/actions/'+proposedAction.id+'/execute',{
    method:'POST',headers:{'content-type':'application/json',cookie:sessionCookie},
    body:JSON.stringify({companyId,confirmed:true}),
  });
  assert.equal(executeAction.status,200);
  const executedResult=(await executeAction.json()).result;
  assert.ok(executedResult.taskId);
  assert.equal(executedResult.status,'pending');
  const [executedTasks]=await db.execute('SELECT title,status,priority,assignee_user_id FROM operational_tasks WHERE id=? AND company_id=?',[executedResult.taskId,companyId]);
  assert.equal(executedTasks.length,1);
  assert.equal(executedTasks[0].title,'CI domestic AI action task execute '+suffix);
  assert.equal(executedTasks[0].status,'pending');
  assert.equal(executedTasks[0].priority,'high');
  assert.equal(executedTasks[0].assignee_user_id,userId);

  const executeAgain=await app.request('/api/ai/actions/'+proposedAction.id+'/execute',{
    method:'POST',headers:{'content-type':'application/json',cookie:sessionCookie},
    body:JSON.stringify({companyId,confirmed:true}),
  });
  assert.equal(executeAgain.status,409,'an AI action must not execute more than once');

  const proposeCancel=await app.request('/api/ai/actions/propose',{
    method:'POST',headers:{'content-type':'application/json',cookie:sessionCookie},
    body:JSON.stringify({companyId,toolKey:'create_operational_task',arguments:{title:'CI domestic AI action task cancel '+suffix,assigneeUserId:userId}}),
  });
  assert.equal(proposeCancel.status,201);
  const cancelId=(await proposeCancel.json()).action.id;
  const cancel=await app.request('/api/ai/actions/'+cancelId+'/cancel',{
    method:'POST',headers:{'content-type':'application/json',cookie:sessionCookie},
    body:JSON.stringify({companyId}),
  });
  assert.equal(cancel.status,200);
  const actionStates=await db.execute('SELECT id,status FROM medar_ai_action_runs WHERE company_id=? AND id IN (?,?)',[companyId,proposedAction.id,cancelId]);
  assert.deepEqual(new Set(actionStates[0].map(row=>row.status)),new Set(['executed','cancelled']));

  console.log('[medar-integration] request:contacts-import');
  const customerName = 'CI Domestic Customer ' + suffix;
  const supplierName = 'CI Domestic Supplier ' + suffix;
  const contactImport = await app.request('/api/contacts/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({
      companyId,
      contacts: [
        { name: customerName, kind: 'customers', phone: '۰۹۱۲۳۴۵۶۷۸۹', city: 'سیمین‌شهر', email: 'customer@example.test', tags: ['عمده‌فروش'] },
        { name: supplierName, kind: 'suppliers', phone: '09123456780', city: 'گنبد', organization: 'CI farm', tags: ['تأمین‌کننده'] },
        { name: customerName, kind: 'customers', phone: '۰۹۱۲۳۴۵۶۷۸۹', city: 'سیمین‌شهر' },
      ],
    }),
  });
  assert.equal(contactImport.status, 200);
  const contactImportPayload = await contactImport.json();
  assert.equal(contactImportPayload.imported, 2);
  assert.equal(contactImportPayload.updated, 0);
  assert.equal(contactImportPayload.skipped, 1);
  assert.equal(contactImportPayload.byKind.customers.imported, 1);
  assert.equal(contactImportPayload.byKind.suppliers.imported, 1);

  const [customerRows] = await db.execute('SELECT name,phone,city,email,contact_tags,contact_source FROM customers WHERE company_id=? AND name=?', [companyId,customerName]);
  assert.equal(customerRows.length, 1);
  assert.equal(customerRows[0].phone, '09123456789');
  assert.equal(customerRows[0].contact_source, 'phone_import');
  const tags = typeof customerRows[0].contact_tags === 'string' ? JSON.parse(customerRows[0].contact_tags) : customerRows[0].contact_tags;
  assert.deepEqual(tags, ['عمده‌فروش']);

  const updateContact = await app.request('/api/contacts/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, contacts: [{name:customerName,kind:'customers',phone:'09123456700',city:'آق‌قلا',tags:['مشتری ویژه']}] }),
  });
  assert.equal(updateContact.status, 200);
  const updatePayload = await updateContact.json();
  assert.equal(updatePayload.imported, 0);
  assert.equal(updatePayload.updated, 1);
  const [updatedCustomers] = await db.execute('SELECT phone,city FROM customers WHERE company_id=? AND name=?', [companyId,customerName]);
  assert.equal(updatedCustomers[0].phone, '09123456700');
  assert.equal(updatedCustomers[0].city, 'آق‌قلا');

  const pushConfig = await app.request('/api/push/config?companyId='+companyId, { headers: { cookie: sessionCookie } });
  assert.equal(pushConfig.status, 200);
  assert.equal((await pushConfig.json()).enabled, false, 'external push must remain disabled until a domestic delivery service is configured');

  console.log('[medar-integration] request:bank-account-and-import');
  const bankAccountResponse = await app.request('/api/finance/bank-accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, label: 'CI operating account', bankName: 'Test Bank', maskedAccount: '۱۲۳۴', currency: 'IRR' }),
  });
  assert.equal(bankAccountResponse.status, 201);
  const bankAccount = (await bankAccountResponse.json()).account;
  assert.ok(bankAccount.id);
  assert.equal(bankAccount.maskedAccount, '۱۲۳۴');

  const invalidBankAccount = await app.request('/api/finance/bank-accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, label: 'Invalid account', bankName: 'Test Bank', maskedAccount: '1234567890123456', currency: 'IRR' }),
  });
  assert.equal(invalidBankAccount.status, 422, 'full bank account numbers must not be stored');

  const externalTransactionId = 'ci-bank-txn-' + suffix;
  const transactionInput = {
    externalTransactionId, bookedAt: '2026-10-23T10:30:00.000Z', amount: 125000000,
    currency: 'IRR', description: 'CI import record', counterparty: 'Test counterparty', reference: 'CI-' + suffix,
  };
  const importResponse = await app.request('/api/finance/bank-transactions/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, accountId: bankAccount.id, transactions: [transactionInput] }),
  });
  assert.equal(importResponse.status, 200);
  assert.deepEqual(await importResponse.json(), { inserted: 1, skippedDuplicates: 0, submitted: 1 });

  const importDuplicate = await app.request('/api/finance/bank-transactions/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, accountId: bankAccount.id, transactions: [transactionInput] }),
  });
  assert.equal(importDuplicate.status, 200);
  assert.deepEqual(await importDuplicate.json(), { inserted: 0, skippedDuplicates: 1, submitted: 1 });

  const transactionList = await app.request('/api/finance/bank-transactions?companyId='+companyId+'&accountId='+bankAccount.id+'&status=unmatched', {
    headers: { cookie: sessionCookie },
  });
  assert.equal(transactionList.status, 200);
  const listedTransactions = (await transactionList.json()).transactions;
  assert.equal(listedTransactions.length, 1);
  const bankTransactionId = listedTransactions[0].id;
  assert.equal(listedTransactions[0].externalTransactionId, externalTransactionId);
  assert.equal(listedTransactions[0].reconciliationStatus, 'unmatched');

  const candidates = await app.request('/api/finance/bank-transactions/'+bankTransactionId+'/candidates?companyId='+companyId, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(candidates.status, 200);
  assert.equal((await candidates.json()).transaction.direction, 'incoming');

  const ignore = await app.request('/api/finance/bank-transactions/'+bankTransactionId+'/ignore', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId }),
  });
  assert.equal(ignore.status, 200);
  assert.equal((await ignore.json()).status, 'ignored');

  const ignoreAgain = await app.request('/api/finance/bank-transactions/'+bankTransactionId+'/ignore', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId }),
  });
  assert.equal(ignoreAgain.status, 409, 'terminal transaction status must not be silently changed twice');

  const bankAccountList = await app.request('/api/finance/bank-accounts?companyId='+companyId, { headers: { cookie: sessionCookie } });
  assert.equal(bankAccountList.status, 200);
  const listedAccounts = await bankAccountList.json();
  assert.equal(listedAccounts.accounts.length, 1);
  assert.equal(listedAccounts.accounts[0].transactionCount, 1);
  assert.equal(listedAccounts.accounts[0].unmatchedCount, 0);

  console.log('[medar-integration] request:profile-complete');
  const profileComplete = await app.request('/api/profile/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, firstName: 'احسان', lastName: 'آزمایشی', phone: '۰۹۱۲۳۴۵۶۷۸۹' }),
  });
  assert.equal(profileComplete.status, 200);
  const profilePayload = await profileComplete.json();
  assert.equal(profilePayload.user.full_name, 'احسان آزمایشی');
  assert.equal(profilePayload.user.phone, '+989123456789');
  const [profileRows] = await db.execute('SELECT full_name,phone FROM profiles WHERE id=?', [userId]);
  assert.equal(profileRows.length, 1);
  assert.equal(profileRows[0].full_name, 'احسان آزمایشی');
  assert.equal(profileRows[0].phone, '+989123456789');

  const invalidProfilePhone = await app.request('/api/profile/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie },
    body: JSON.stringify({ companyId, firstName: 'احسان', lastName: 'آزمایشی', phone: 'invalid' }),
  });
  assert.equal(invalidProfilePhone.status, 422);

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
