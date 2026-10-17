import { Capacitor } from '@capacitor/core';

/**
 * Shared runtime contract for browser and native clients.
 *
 * Production web may use its same-origin Worker URL. Native builds must embed
 * the canonical authenticated Worker URL at build time; relative capacitor://
 * requests would otherwise look like a valid app shell while never reaching
 * the real API.
 */
export const MEDAR_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '').replace(/\/$/, '');
export const MEDAR_NATIVE_CLIENT = Capacitor.isNativePlatform();
export const MEDAR_CLIENT_PLATFORM: 'web' | 'android' | 'ios' =
  MEDAR_NATIVE_CLIENT
    ? (Capacitor.getPlatform() === 'ios' ? 'ios' : 'android')
    : 'web';
export const MEDAR_APP_VERSION = import.meta.env.VITE_APP_VERSION?.trim() || '0.1.0';
export const MEDAR_API_CONFIGURATION_ERROR = MEDAR_NATIVE_CLIENT && !MEDAR_API_BASE_URL
  ? 'نسخه موبایل به آدرس مرکزی API مدار تنظیم نشده است. بسته را با MEDAR_OPS_API_BASE_URL بساز.'
  : null;

export function medarApiUrl(path: string): string {
  if (MEDAR_API_CONFIGURATION_ERROR) throw new Error(MEDAR_API_CONFIGURATION_ERROR);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${MEDAR_API_BASE_URL}${normalizedPath}`;
}

/** Stable, non-secret identifier used only to show the last-seen status of this client in the central panel. */
export function getMedarClientId(): string {
  const key = 'medar-client-id';
  try {
    const existing = window.localStorage.getItem(key);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
      return existing;
    }
    const generated = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : createUuidFromRandomBytes();
    window.localStorage.setItem(key, generated);
    return generated;
  } catch {
    return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : createUuidFromRandomBytes();
  }
}

function createUuidFromRandomBytes(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
