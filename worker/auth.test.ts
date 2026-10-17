import { describe, expect, it } from 'vitest';
import { DUMMY_PASSWORD_HASH, FAILED_LOGIN_UPSERT_SQL, normalizeUsername, verifyPassword } from './index';

describe('server-side login identifier normalization', () => {
  it('uses an explicit INSERT alias in the failed-login upsert', () => {
    expect(FAILED_LOGIN_UPSERT_SQL).toContain('INSERT INTO public.medar_rate_limits AS rate_limit');
    expect(FAILED_LOGIN_UPSERT_SQL).toContain('rate_limit.window_started_at');
    expect(FAILED_LOGIN_UPSERT_SQL).not.toContain('public.medar_rate_limits.window_started_at');
  });

  it('uses a valid fixed PBKDF2 dummy verifier for missing-account login checks', async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^pbkdf2_sha256\$310000\$/);
    await expect(verifyPassword('medar-invalid-login-dummy-password', DUMMY_PASSWORD_HASH)).resolves.toBe(true);
    await expect(verifyPassword('different-password', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });

  it('normalizes usernames for signup and login', () => {
    expect(normalizeUsername('  Owner_Test  ')).toBe('owner_test');
    expect(normalizeUsername('کاربر_۱')).toBe('کاربر_۱');
  });

  it('rejects usernames outside the supported simple format', () => {
    expect(normalizeUsername(null)).toBeNull();
    expect(normalizeUsername({ username: 'bad' })).toBeNull();
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('@bad')).toBeNull();
    expect(normalizeUsername('.bad')).toBeNull();
  });
});
