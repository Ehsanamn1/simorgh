import { describe, expect, it } from 'vitest';
import {
  CREATE_OWNER_WORKSPACE_SQL,
  DUMMY_PASSWORD_HASH,
  FAILED_LOGIN_UPSERT_SQL,
  normalizeUsername,
  parseClientHeartbeat,
  resolveApiModeAccess,
  scopeHasModulePermission,
  verifyPassword,
} from './index';

describe('Worker API deployment mode isolation', () => {
  it('keeps an unconfigured or public-demo Worker read-only by default', () => {
    for (const mode of [undefined, 'public-demo', 'unknown']) {
      expect(resolveApiModeAccess(mode, 'GET', '/api/health')).toBe('allow');
      expect(resolveApiModeAccess(mode, 'GET', '/api/auth/me')).toBe('anonymous-session');
      expect(resolveApiModeAccess(mode, 'POST', '/api/auth/signup')).toBe('deny');
      expect(resolveApiModeAccess(mode, 'POST', '/api/auth/login')).toBe('deny');
      expect(resolveApiModeAccess(mode, 'POST', '/api/data/orders')).toBe('deny');
      expect(resolveApiModeAccess(mode, 'POST', '/api/storage/contract-documents')).toBe('deny');
    }
  });

  it('allows the full API only when the Worker is explicitly operational', () => {
    expect(resolveApiModeAccess('operational', 'POST', '/api/auth/signup')).toBe('allow');
    expect(resolveApiModeAccess('operational', 'POST', '/api/data/orders')).toBe('allow');
    expect(resolveApiModeAccess('operational', 'GET', '/api/storage/contract-documents')).toBe('allow');
  });

  it('does not allow unsafe methods to use public health/session exceptions', () => {
    expect(resolveApiModeAccess('public-demo', 'POST', '/api/health')).toBe('deny');
    expect(resolveApiModeAccess('public-demo', 'POST', '/api/auth/me')).toBe('deny');
  });
});

describe('shared web/mobile presence payload validation', () => {
  const valid = {
    companyId: '0b9a0d6f-f5a0-4a0f-9a9b-7d8b30d5d482',
    clientId: 'dd4bd88c-8c1d-4cf5-a9f2-61aafba2bdf1',
    platform: 'android',
    appVersion: '0.1.0',
  };

  it('accepts a validated platform heartbeat for an existing tenant', () => {
    expect(parseClientHeartbeat(valid)).toEqual(valid);
  });

  it('rejects unsupported platforms, malformed identifiers, and oversized versions', () => {
    expect(parseClientHeartbeat({ ...valid, platform: 'unknown' })).toBeNull();
    expect(parseClientHeartbeat({ ...valid, clientId: 'not-a-uuid' })).toBeNull();
    expect(parseClientHeartbeat({ ...valid, companyId: 'public' })).toBeNull();
    expect(parseClientHeartbeat({ ...valid, appVersion: 'v'.repeat(41) })).toBeNull();
    expect(parseClientHeartbeat(null)).toBeNull();
  });
});

describe('server-side username normalization', () => {
  it('lets PostgreSQL generate username_normalized during owner signup', () => {
    const columns = CREATE_OWNER_WORKSPACE_SQL.match(/insert into public\.medar_users\(([^)]+)\)/i)?.[1];
    expect(columns?.split(',').map((column) => column.trim())).toEqual([
      'username',
      'display_name',
      'password_hash',
      'requested_role',
      'account_status',
    ]);
    expect(CREATE_OWNER_WORKSPACE_SQL).toContain('returning id,username,username_normalized,display_name');
  });

  it('uses an explicit INSERT alias in the failed-login upsert', () => {
    expect(FAILED_LOGIN_UPSERT_SQL).toContain('INSERT INTO public.medar_rate_limits AS rate_limit');
    expect(FAILED_LOGIN_UPSERT_SQL).toContain('rate_limit.window_started_at');
    expect(FAILED_LOGIN_UPSERT_SQL).not.toContain('public.medar_rate_limits.window_started_at');
  });

  it('rejects PBKDF2 hashes above the Cloudflare Web Crypto iteration ceiling', async () => {
    const unsupportedHash = DUMMY_PASSWORD_HASH.replace('$100000$', '$310000$');
    await expect(verifyPassword('medar-invalid-login-dummy-password', unsupportedHash)).resolves.toBe(false);
  });

  it('uses a valid fixed PBKDF2 dummy verifier for missing-account login checks', async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^pbkdf2_sha256\$100000\$/);
    await expect(verifyPassword('medar-invalid-login-dummy-password', DUMMY_PASSWORD_HASH)).resolves.toBe(true);
    await expect(verifyPassword('different-password', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });

  it('normalizes usernames consistently and preserves legacy usernames', () => {
    expect(normalizeUsername('  Legacy_User  ')).toBe('legacy_user');
    expect(normalizeUsername('OWNER.TEST')).toBe('owner.test');
  });

  it('supports Persian usernames without requiring a phone number', () => {
    expect(normalizeUsername('کاربر_مدار')).toBe('کاربر_مدار');
  });

  it('rejects empty, malformed, or out-of-range username inputs', () => {
    expect(normalizeUsername(null)).toBeNull();
    expect(normalizeUsername({ username: 'bad' })).toBeNull();
    expect(normalizeUsername('@@')).toBeNull();
    expect(normalizeUsername('_starts_with_punctuation')).toBeNull();
    expect(normalizeUsername('a'.repeat(33))).toBeNull();
  });
});

describe('company-scoped module permissions', () => {
  const staff = {
    membership_id: 'membership-staff',
    company_id: 'company-1',
    role: 'staff',
    customer_id: null,
    supplier_id: null,
  };
  const override = {
    membership_id: 'membership-staff',
    module_key: 'finance',
    inherit_role_defaults: false,
    can_read: false,
    can_create: true,
    can_update: false,
    can_delete: false,
    can_approve: false,
  };

  it('inherits existing role behavior when no per-member override exists', () => {
    expect(scopeHasModulePermission(staff, new Map(), 'can_read')).toBe(true);
    expect(scopeHasModulePermission(staff, new Map(), 'can_delete')).toBe(true);
  });

  it('uses explicit capabilities when a member has a custom module policy', () => {
    const policies = new Map([[staff.membership_id, override]]);
    expect(scopeHasModulePermission(staff, policies, 'can_read')).toBe(false);
    expect(scopeHasModulePermission(staff, policies, 'can_create')).toBe(true);
    expect(scopeHasModulePermission(staff, policies, 'can_update')).toBe(false);
    expect(scopeHasModulePermission(staff, policies, 'can_delete')).toBe(false);
    expect(scopeHasModulePermission(staff, policies, 'can_approve')).toBe(false);
  });

  it('preserves owner and admin authority while custom policy is applied to delegated roles', () => {
    const policies = new Map([[staff.membership_id, override]]);
    expect(scopeHasModulePermission({ ...staff, role: 'owner' }, policies, 'can_delete')).toBe(true);
    expect(scopeHasModulePermission({ ...staff, role: 'admin' }, policies, 'can_approve')).toBe(true);
  });

  it('does not apply a policy to a different membership in the same company', () => {
    const otherMember = { ...staff, membership_id: 'membership-other' };
    const policies = new Map([[staff.membership_id, override]]);
    expect(scopeHasModulePermission(otherMember, policies, 'can_read')).toBe(true);
  });
});
