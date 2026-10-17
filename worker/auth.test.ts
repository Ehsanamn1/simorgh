import { describe, expect, it } from 'vitest';
import { CREATE_OWNER_WORKSPACE_SQL, DUMMY_PASSWORD_HASH, FAILED_LOGIN_UPSERT_SQL, normalizeUsername, verifyPassword } from './index';

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
    const unsupportedHash = DUMMY_PASSWORD_HASH.replace('$100000    expect(DUMMY_PASSWORD_HASH).toMatch(/^pbkdf2_sha256\$100000\$/);
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
, '$310000    expect(DUMMY_PASSWORD_HASH).toMatch(/^pbkdf2_sha256\$100000\$/);
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
);
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
