import { expect, test } from '@playwright/test';

test('app-first entry opens a secure mobile workspace without public marketing or registration', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/سیمرغ/);
  await expect(page).toHaveURL(/\/simorgh\/app\/command/);
  await expect(page.locator('.portal')).toHaveCount(0);
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.getByLabel('ایمیل')).toBeVisible();
  await expect(page.getByLabel('گذرواژه')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'ایجاد حساب' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /ورود \/ ثبت‌نام/ })).toHaveCount(0);
  await expect(page.getByText(/ثبت‌نام عمومی غیرفعال است/)).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(pageErrors).toEqual([]);
});

test('direct navigation opens the secure app gate and does not grant an operating role', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.mobile-access-screen')).toBeVisible();
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.getByLabel('ایمیل')).toBeVisible();
  await expect(page.getByLabel('گذرواژه')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'ایجاد حساب' })).toHaveCount(0);
  await expect(page.locator('.app-frame')).toHaveCount(0);
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('invited user can sign in through Supabase and then receives only membership-backed access', async ({ page }) => {
  const authBase = 'https://aoxerjimfiwusidaparx.supabase.co';
  const userId = '00000000-0000-4000-8000-000000000011';
  const companyId = '00000000-0000-4000-8000-000000000022';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.route(authBase + '/auth/v1/token*', async route => {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,HEAD,OPTIONS,POST,PATCH,DELETE,PUT',
      'content-type': 'application/json',
      'cache-control': 'no-store',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers, body: '' });
      return;
    }
    await route.fulfill({
      status: 200,
      headers,
      body: JSON.stringify({
        access_token: 'simorgh-auth-e2e-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'simorgh-auth-e2e-refresh-token',
        user: {
          id: userId, aud: 'authenticated', role: 'authenticated',
          email: 'invited-owner@example.test',
          email_confirmed_at: new Date().toISOString(),
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: { full_name: 'مالک آزمایشی' },
          created_at: new Date().toISOString(),
        },
      }),
    });
  });

  await page.route(authBase + '/rest/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split('/').pop() || '';
    const headers: Record<string, string> = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,HEAD,OPTIONS,POST,PATCH,DELETE,PUT',
      'content-type': 'application/json',
      'cache-control': 'no-store',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers, body: '' });
      return;
    }
    if (table === 'memberships') {
      await route.fulfill({
        status: 200,
        headers: { ...headers, 'content-range': '0-0/1' },
        body: JSON.stringify([{
          id: '00000000-0000-4000-8000-000000000044',
          company_id: companyId, user_id: userId, role: 'owner',
          customer_id: null, supplier_id: null, active: true,
          companies: { name: 'شبکه سیمرغ' },
        }]),
      });
      return;
    }
    if (request.method() === 'HEAD') {
      await route.fulfill({ status: 200, headers: { ...headers, 'content-range': '*/0' }, body: '' });
      return;
    }
    await route.fulfill({ status: 200, headers: { ...headers, 'content-range': '*/0' }, body: '[]' });
  });

  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('ایمیل').fill('invited-owner@example.test');
  await page.getByLabel('گذرواژه').fill('test-only-password');
  await page.getByRole('button', { name: /ورود به فضای کار/ }).click();
  await expect(page.locator('.app-frame')).toBeVisible();
  await expect(page.getByRole('heading', { name: /مرکز فرمان شبکه/ })).toBeVisible();
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /دسترسی کاربران/ })).toBeVisible();
  await page.getByRole('button', { name: 'فعال‌کردن حالت روشن' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'فعال‌کردن حالت تاریک' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});
