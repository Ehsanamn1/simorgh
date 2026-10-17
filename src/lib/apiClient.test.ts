import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './apiClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API error handling', () => {
  it('does not mislabel a non-JSON server error as an unconfigured host', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Internal Server Error', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=UTF-8' },
    })));

    await expect(api.post('/api/auth/signup', { username: 'owner_test' })).rejects.toMatchObject({
      name: 'HttpError',
      status: 500,
      message: 'سرویس مدار هنگام انجام درخواست دچار خطا شد؛ چند لحظه بعد دوباره تلاش کن.',
    });
  });

  it('preserves a useful JSON rate-limit message returned by the registration API', async () => {
    const message = 'تلاش‌های ثبت‌نام از این اتصال بیش از حد است؛ ۱۵ دقیقه دیگر دوباره امتحان کن.';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(api.post('/api/auth/signup', { username: 'owner_test' })).rejects.toMatchObject({
      name: 'HttpError',
      status: 429,
      message,
    });
  });
});
