import { describe, expect, it } from 'vitest';
import { moneyFa, orderLabel, roleLabel } from '../lib/format';
import { pageSectionLabel } from '../lib/pageSections';
import { normalizeIranPhone } from '../lib/phone';

describe('Simorgh formatting and role labels', () => {
  it('formats Iranian currency with Persian digits and unit', () => {
    expect(moneyFa(120000)).toContain('تومان');
    expect(moneyFa(120000)).not.toContain('NaN');
  });
  it('provides role labels without inferring roles', () => {
    expect(roleLabel.owner).toBe('مالک');
    expect(roleLabel.driver).toBe('راننده');
  });
  it('translates the order workflow states', () => {
    expect(orderLabel.submitted).toBe('ثبت‌شده');
    expect(orderLabel.delivered).toBe('تحویل‌شده');
  });
  it('uses readable Persian section labels in the operational workspace', () => {
    expect(pageSectionLabel('CONTROL CENTER / 01')).toBe('نمای کلی شبکه');
    expect(pageSectionLabel('FINANCE / RECONCILIATION')).toBe('مالی و تسویه');
    expect(pageSectionLabel('SUPPLIER / CAPACITY')).toBe('ظرفیت تأمین‌کننده');
    expect(pageSectionLabel('farm_sites')).toBe('مزارع و واحدها');
    expect(pageSectionLabel('audit_events')).toBe('تاریخچه‌ی ممیزی');
    expect(pageSectionLabel('company_goals')).toBe('اهداف مجموعه');
    expect(pageSectionLabel('فضای تازه')).toBe('فضای تازه');
  });
  it('normalizes Iranian mobile numbers to E.164 and rejects invalid values', () => {
    expect(normalizeIranPhone('09121234567')).toBe('+989121234567');
    expect(normalizeIranPhone('9121234567')).toBe('+989121234567');
    expect(normalizeIranPhone('+989121234567')).toBe('+989121234567');
    expect(normalizeIranPhone(' 0912 123 4567 ')).toBe('+989121234567');
    expect(normalizeIranPhone('02112345678')).toBe('');
    expect(normalizeIranPhone('0912123456')).toBe('');
    expect(normalizeIranPhone('')).toBe('');
  });
});
