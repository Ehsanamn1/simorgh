import { describe, expect, it } from 'vitest';
import { app, normalizePhone, passwordHash, verifyPassword } from './index';

describe('Medar username authentication primitives', () => {
  it('normalizes Iranian mobile numbers in common formats', () => {
    expect(normalizePhone('09121234567')).toBe('+989121234567');
    expect(normalizePhone('9121234567')).toBe('+989121234567');
    expect(normalizePhone('+989121234567')).toBe('+989121234567');
    expect(normalizePhone('۰۹۱۲۱۲۳۴۵۶۷')).toBe('+989121234567');
  });

  it('rejects malformed phone numbers', () => {
    expect(normalizePhone('02112345678')).toBeNull();
    expect(normalizePhone('0912123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('hashes passwords with a random salt and verifies only the correct password', async () => {
    const hash = await passwordHash('correct horse battery staple');
    expect(hash.startsWith('pbkdf2$600000$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('fails closed when database configuration is missing', async () => {
    const response = await app.request('/api/health');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, database: false });
  });

  it('does not expose workspace memberships without a session', async () => {
    const response = await app.request('/api/workspace/memberships');
    expect(response.status).toBe(401);
  });

  it('does not expose the generic data API without a session', async () => {
    const response = await app.request('/api/data/orders/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'select', query: { select: '*', filters: [] } }),
    });
    expect(response.status).toBe(401);
  });

  it('does not mutate generic business data without a session', async () => {
    const response = await app.request('/api/data/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'insert', values: { reference: 'TEST' }, query: { filters: [] } }),
    });
    expect(response.status).toBe(401);
  });

  it('does not execute legacy RPC replacements without a session', async () => {
    const response = await app.request('/api/rpc/company_members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ _company: '00000000-0000-4000-8000-000000000001' }),
    });
    expect(response.status).toBe(401);
  });

  it('does not upload delivery evidence without a session', async () => {
    const form = new FormData();
    form.set('file', new File(['test'], 'test.pdf', { type: 'application/pdf' }));
    const response = await app.request('/api/storage/delivery-evidence/upload?path=00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/test.pdf', {
      method: 'POST',
      body: form,
    });
    expect(response.status).toBe(401);
  });

  it('does not expose operational records without a session', async () => {
    const response = await app.request('/api/operations/farm-sites?companyId=00000000-0000-4000-8000-000000000001');
    expect(response.status).toBe(401);
  });

  it('does not create operational records without a session', async () => {
    const response = await app.request('/api/operations/farm-sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company_id: '00000000-0000-4000-8000-000000000001', name: 'Test site' }),
    });
    expect(response.status).toBe(401);
  });

  it('does not create settlement periods without a session', async () => {
    const response = await app.request('/api/operations/settlements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId: '00000000-0000-4000-8000-000000000001', agreementId: '00000000-0000-4000-8000-000000000002', periodStart: '2026-10-01', periodEnd: '2026-10-15' }),
    });
    expect(response.status).toBe(401);
  });

  it('does not expose task evidence without a session', async () => {
    const response = await app.request('/api/operations/operational-tasks/00000000-0000-4000-8000-000000000001/evidence?companyId=00000000-0000-4000-8000-000000000002');
    expect(response.status).toBe(401);
  });

  it('does not expose member lists without a session', async () => {
    const response = await app.request('/api/workspace/members?companyId=00000000-0000-4000-8000-000000000001');
    expect(response.status).toBe(401);
  });

  it('does not grant memberships without a session', async () => {
    const response = await app.request('/api/workspace/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyId: '00000000-0000-4000-8000-000000000001', username: 'test_user', role: 'admin' }),
    });
    expect(response.status).toBe(401);
  });

  it('does not allow access-request reviews without a session', async () => {
    const response = await app.request('/api/admin/access-requests/00000000-0000-4000-8000-000000000001/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(response.status).toBe(401);
  });

  it('does not accept role requests without a session', async () => {
    const response = await app.request('/api/access-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    });
    expect(response.status).toBe(401);
  });
});

  it('does not allow changing a password without an authenticated session', async () => {
    const response = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'old-password', newPassword: 'new-password-123' }),
    });
    expect(response.status).toBe(401);
  });
