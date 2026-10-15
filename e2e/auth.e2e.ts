import { expect, test } from '@playwright/test';

test('public entry is a role-based portal and keeps sign-in off the public landing page', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/سیمرغ/);
  await expect(page.locator('.portal-hero h1')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'برای هر نقش، فضای خودش' })).toBeVisible();
  for (const roleName of [/مدیر و مالک شبکه/, /تأمین‌کننده و شریک مزرعه/, /راننده و پیمانکار حمل/, /مشتری و خریدار عمده/]) {
    await expect(page.getByRole('button', { name: roleName })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: /ورود اعضای مجاز/ })).toBeVisible();
  await expect(page.locator('input[type="password"], input[type="email"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /ثبت‌نام|ورود امن|ورود به سیمرغ/ })).toHaveCount(0);
  await expect(page.getByText('نقش با انتخاب کارت فعال نمی‌شود.')).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('workspace-portal-viewport.png') });
  await page.screenshot({ path: testInfo.outputPath('workspace-portal.png'), fullPage: true });
});

test('role selection stays a non-operational preview', async ({ page }) => {
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  const supplier = page.getByRole('button', { name: /تأمین‌کننده و شریک مزرعه/ });
  await supplier.click();
  await expect(supplier).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'نمایش ساختار پنل' }).click();
  await expect(page.getByRole('heading', { name: 'فضای تأمین و مزرعه' })).toBeVisible();
  await expect(page.getByText('نمای ساختاری، نه پنل عملیاتی')).toBeVisible();
  await expect(page.getByText(/هیچ رکورد خصوصی بارگذاری یا قابل ویرایش نیست/)).toBeVisible();
  await expect(page.locator('.portal-capability').getByText('ظرفیت تولید', { exact: true })).toBeVisible();
});

test('direct navigation to a protected route requires sign-in and never grants a role', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.getByLabel('ایمیل سازمانی')).toBeVisible();
  await expect(page.getByLabel('گذرواژه')).toBeVisible();
  await expect(page.getByText(/ثبت‌نام عمومی در این سامانه فعال نیست/)).toBeVisible();
  await expect(page.locator('.app-frame')).toHaveCount(0);
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
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
  await page.getByRole('button', { name: /ورود اعضای مجاز/ }).click();
  await page.getByLabel('ایمیل سازمانی').fill('invited-owner@example.test');
  await page.getByLabel('گذرواژه').fill('test-only-password');
  await page.getByRole('button', { name: /ورود به سیمرغ/ }).click();
  await expect(page.locator('.app-frame')).toBeVisible();
  await expect(page.getByRole('heading', { name: /مرکز فرمان شبکه/ })).toBeVisible();
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /دسترسی کاربران/ })).toBeVisible();
  expect(errors).toEqual([]);
});
