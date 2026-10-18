import { describe, expect, it } from 'vitest';
import { parseBankStatementCsv, parseBankStatementDate, normalizeBankDigits } from './bankStatement';

describe('bank statement CSV parser', () => {
  it('parses signed amounts, quoted CSV fields, and stable external transaction IDs', () => {
    const csv = [
      'transaction_id,date,amount,currency,description,counterparty,reference',
      'TXN-000001,2026-10-18,1250.50,IRR,"خرید, خوراک",فروشگاه,REF-12345',
      'TXN-000002,2026-10-18,-300,IRR,برداشت,بانک,REF-12346',
    ].join('\n');
    expect(parseBankStatementCsv(csv)).toEqual([
      {
        externalTransactionId: 'TXN-000001',
        bookedAt: '2026-10-18T00:00:00.000Z',
        amount: 1250.5, direction: 'incoming', currency: 'IRR', description: 'خرید, خوراک',
        counterparty: 'فروشگاه', reference: 'REF-12345',
      },
      {
        externalTransactionId: 'TXN-000002',
        bookedAt: '2026-10-18T00:00:00.000Z',
        amount: -300, direction: 'outgoing', currency: 'IRR', description: 'برداشت',
        counterparty: 'بانک', reference: 'REF-12346',
      },
    ]);
  });

  it('normalizes Persian digits and converts Jalali statement dates to Gregorian ISO', () => {
    expect(normalizeBankDigits('۱۴۰۵/۰۷/۲۶')).toBe('1405/07/26');
    expect(parseBankStatementDate('۱۴۰۵/۰۷/۲۶')).toBe('2026-10-18T00:00:00.000Z');
    const csv = [
      'شناسه تراکنش,تاریخ,مبلغ,شرح',
      'TRX000001,۱۴۰۵/۰۷/۲۶,۱۲۳٬۴۵۶,خرید خوراک',
    ].join('\n');
    expect(parseBankStatementCsv(csv)[0]).toMatchObject({
      externalTransactionId: 'TRX000001',
      bookedAt: '2026-10-18T00:00:00.000Z',
      amount: 123456,
      description: 'خرید خوراک',
      currency: 'IRR',
    });
  });

  it('supports debit and credit columns where debit is stored as a positive number', () => {
    const csv = [
      'transaction_id,date,debit,credit,description',
      'DEBIT-0001,2026-10-17,"1,250",,پرداخت خرید',
      'CREDIT-01,2026-10-17,,2000,دریافت',
    ].join('\n');
    expect(parseBankStatementCsv(csv).map(row => [row.amount, row.direction])).toEqual([[-1250, 'outgoing'], [2000, 'incoming']]);
  });

  it('rejects duplicate identifiers, missing identifiers, malformed dates, and unsupported empty statements', () => {
    const header = 'transaction_id,date,amount';
    expect(() => parseBankStatementCsv([header, 'DUPLICATE-1,2026-10-18,1', 'DUPLICATE-1,2026-10-19,2'].join('\n'))).toThrow(/تکراری/);
    expect(() => parseBankStatementCsv([header, ',2026-10-18,1'].join('\n'))).toThrow(/شناسه تراکنش/);
    expect(() => parseBankStatementCsv([header, 'TXN000001,not-a-date,1'].join('\n'))).toThrow(/تاریخ/);
    expect(() => parseBankStatementCsv(header)).toThrow(/دست‌کم یک تراکنش/);
  });
});
