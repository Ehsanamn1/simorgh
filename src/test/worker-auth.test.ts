import { describe, expect, it } from 'vitest';
import { normalizeIranPhone, normalizeUsername } from '../../worker/index';

describe('Worker authentication input validation', () => {
  it('normalizes Iranian mobile numbers to E.164 using ASCII, Persian and Arabic numerals', () => {
    expect(normalizeIranPhone('09121234567')).toBe('+989121234567');
    expect(normalizeIranPhone('+989121234567')).toBe('+989121234567');
    expect(normalizeIranPhone('00989121234567')).toBe('+989121234567');
    expect(normalizeIranPhone('۰۹۱۲۱۲۳۴۵۶۷')).toBe('+989121234567');
    expect(normalizeIranPhone('٠٩١٢١٢٣٤٥٦٧')).toBe('+989121234567');
    expect(normalizeIranPhone('02112345678')).toBeNull();
    expect(normalizeIranPhone('0912123456')).toBeNull();
  });

  it('canonicalizes usernames and rejects malformed or ambiguous values', () => {
    expect(normalizeUsername(' Owner.Test ')).toBe('owner.test');
    expect(normalizeUsername('کاربر۱۲۳')).toBe('کاربر۱۲۳');
    expect(normalizeUsername('test_user-7')).toBe('test_user-7');
    expect(normalizeUsername('ab')).toBeNull();
    expect(normalizeUsername('_owner')).toBeNull();
    expect(normalizeUsername('owner!')).toBeNull();
    expect(normalizeUsername('')).toBeNull();
  });
});
