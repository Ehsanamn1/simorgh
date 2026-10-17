import { describe, expect, it } from 'vitest';
import { canTransitionMedarStatus, normalizeIranPhone, normalizeUsername } from '../../worker/index';

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

describe('Medar operational state transitions', () => {
  it('allows only the next valid order states', () => {
    expect(canTransitionMedarStatus('orders', 'draft', 'submitted')).toBe(true);
    expect(canTransitionMedarStatus('orders', 'submitted', 'confirmed')).toBe(true);
    expect(canTransitionMedarStatus('orders', 'confirmed', 'allocated')).toBe(true);
    expect(canTransitionMedarStatus('orders', 'draft', 'delivered')).toBe(false);
    expect(canTransitionMedarStatus('orders', 'delivered', 'cancelled')).toBe(false);
  });

  it('keeps shipment progression ordered and terminal states closed', () => {
    expect(canTransitionMedarStatus('shipments', 'planned', 'loading')).toBe(true);
    expect(canTransitionMedarStatus('shipments', 'in_transit', 'arrived')).toBe(true);
    expect(canTransitionMedarStatus('shipments', 'planned', 'delivered')).toBe(false);
    expect(canTransitionMedarStatus('shipments', 'delivered', 'loading')).toBe(false);
  });

  it('requires invoices to be issued before payment states', () => {
    expect(canTransitionMedarStatus('invoices', 'draft', 'issued')).toBe(true);
    expect(canTransitionMedarStatus('invoices', 'issued', 'paid')).toBe(true);
    expect(canTransitionMedarStatus('invoices', 'draft', 'paid')).toBe(false);
    expect(canTransitionMedarStatus('invoices', 'paid', 'void')).toBe(false);
  });

  it('requires settlement approval before recording payment', () => {
    expect(canTransitionMedarStatus('settlements', 'pending', 'approved')).toBe(true);
    expect(canTransitionMedarStatus('settlements', 'approved', 'paid')).toBe(true);
    expect(canTransitionMedarStatus('settlements', 'pending', 'paid')).toBe(false);
    expect(canTransitionMedarStatus('settlements', 'paid', 'disputed')).toBe(false);
  });
});
