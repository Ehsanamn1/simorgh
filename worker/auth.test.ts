import { describe, expect, it } from 'vitest';
import { DUMMY_PASSWORD_HASH, FAILED_LOGIN_UPSERT_SQL, normalizeLoginIdentifier, verifyPassword } from './index';

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

  it('converts Iranian mobile numbers written with Persian digits into canonical E.164', () => {
    expect(normalizeLoginIdentifier('۰۹۱۲۱۲۳۴۵۶۷')).toEqual({
      kind: 'phone',
      value: '+989121234567',
    });
  });

  it('treats 0098, +98 and national mobile representations as the same login identifier', () => {
    const variants = [
      '09121234567',
      '9121234567',
      '+989121234567',
      '00989121234567',
      '۰۹۱۲۱۲۳۴۵۶۷',
      '+98 (912) 123-4567',
    ];

    for (const variant of variants) {
      expect(normalizeLoginIdentifier(variant)).toEqual({
        kind: 'phone',
        value: '+989121234567',
      });
    }
  });

  it('preserves normalized username login for existing accounts', () => {
    expect(normalizeLoginIdentifier('  Legacy_User  ')).toEqual({
      kind: 'username',
      value: 'legacy_user',
    });
  });

  it('rejects identifiers that cannot be normalized as a username or Iranian mobile number', () => {
    expect(normalizeLoginIdentifier(null)).toBeNull();
    expect(normalizeLoginIdentifier({ username: 'bad' })).toBeNull();
    expect(normalizeLoginIdentifier('@@')).toBeNull();
  });
});
