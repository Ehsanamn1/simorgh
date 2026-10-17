import { HttpError } from './http';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL?.trim() || '').replace(/\/$/, '');
export const isApiConfigured = import.meta.env.VITE_DISABLE_API_UI !== 'true';

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(apiUrl(path), {
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
