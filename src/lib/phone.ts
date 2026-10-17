/**
 * Normalize Iranian mobile numbers for profile storage.
 * Returns E.164 (+98...) or an empty string when the input is invalid.
 */
export function normalizeIranPhone(value: string): string {
  const ascii = value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  const digits = ascii.trim().replace(/[\s()-]/g, '');
  if (/^09\d{9}$/.test(digits)) return '+98' + digits.slice(1);
  if (/^9\d{9}$/.test(digits)) return '+98' + digits;
  if (/^\+989\d{9}$/.test(digits)) return digits;
  if (/^00989\d{9}$/.test(digits)) return '+' + digits.slice(2);
  return '';
}
