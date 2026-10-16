/**
 * Normalize Iranian mobile numbers for profile storage.
 * Returns E.164 (+98...) or an empty string when the input is invalid.
 */
export function normalizeIranPhone(value: string): string {
  const digits = value.trim().replace(/[\s()-]/g, '');
  if (/^09\d{9}$/.test(digits)) return '+98' + digits.slice(1);
  if (/^9\d{9}$/.test(digits)) return '+98' + digits;
  if (/^\+989\d{9}$/.test(digits)) return digits;
  return '';
}
