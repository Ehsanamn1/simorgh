import { describe, expect, it } from 'vitest';
import { normalizeLoginIdentifier } from './index';

describe('server-side login identifier normalization', () => {
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
