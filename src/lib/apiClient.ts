import { HttpError } from './http';
import { medarApiUrl, MEDAR_API_CONFIGURATION_ERROR } from './runtimeConfig';

export const isApiConfigured = import.meta.env.VITE_DISABLE_API_UI !== 'true' && !MEDAR_API_CONFIGURATION_ERROR;

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    if (!response.ok) {
      const message = response.status >= 500
        ? 'سرویس مدار هنگام انجام درخواست دچار خطا شد؛ چند لحظه بعد دوباره تلاش کن.'
        : `پاسخ معتبر از سرویس مدار دریافت نشد (HTTP ${response.status}).`;
      throw new HttpError(response.status, message);
    }
    throw new HttpError(502, 'پاسخ API مدار معتبر نیست؛ میزبان عملیاتی باید پاسخ JSON برگرداند.');
  }
  try {
    return await response.json();
  } catch {
    throw new HttpError(502, 'پاسخ API مدار معتبر نیست.');
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(medarApiUrl(path), {
    ...init,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  const payload = await parseResponse(response);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String((payload as { message: unknown }).message)
      : `درخواست با خطای ${response.status} روبه‌رو شد.`;
    throw new HttpError(response.status, message);
  }
  return payload as T;
}

export const api = {
  get<T>(path: string, init?: RequestInit) {
    return apiRequest<T>(path, { ...init, method: 'GET' });
  },
  post<T>(path: string, body?: unknown, init?: RequestInit) {
    return apiRequest<T>(path, {
      ...init,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  put<T>(path: string, body?: unknown, init?: RequestInit) {
    return apiRequest<T>(path, {
      ...init,
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
};
