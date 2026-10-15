import { describe, expect, it } from 'vitest';
import { moneyFa, orderLabel, roleLabel } from '../lib/format';

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
});
