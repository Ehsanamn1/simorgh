import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('simorgh-theme');
    } catch {
      // Private mode may disable storage.
    }
  });
});

test('the app opens a Persian, secure sign-in instead of a role preview', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/مدار \| مدیریت یکپارچه مزرعه و عملیات/);
  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('#app-boot-screen')).toHaveCount(0);
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.locator('.ops-live-app, .ops-live-bottom-nav, .app-frame')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'ورود به مدار' })).toBeVisible();
  await expect(page.getByLabel('ایمیل')).toBeVisible();
  await expect(page.getByLabel('گذرواژه', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ساخت حساب و فضای کاری' })).toBeVisible();
  await expect(page.locator('.portal')).toHaveCount(0);
  await expect(page.locator('.sim-preview-palette')).toHaveCount(0);

  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('a blocked JavaScript bundle shows a recovery state instead of a black page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Run the startup failure simulation once.');
  await page.route(/\/simorgh\/assets\/.*\.js(?:\?.*)?$/, route => route.abort());
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app-boot-screen')).toHaveClass(/has-error/, { timeout: 12_000 });
  await expect(page.getByRole('alert')).toContainText('برنامه بارگذاری نشد');
  await expect(page.getByRole('button', { name: 'بارگذاری دوباره' })).toBeVisible();
});

test('password recovery opens without exposing a public registration path', async ({ page }) => {
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'گذرواژه‌ات را فراموش کرده‌ای؟' }).click();
  await expect(page.getByRole('heading', { name: 'بازیابی گذرواژه' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ارسال لینک بازیابی' })).toBeVisible();
  await page.getByRole('button', { name: 'بازگشت به ورود' }).click();
  await expect(page.getByRole('heading', { name: 'ورود به مدار' })).toBeVisible();
});


test('company signup sends validated details to Supabase and handles email confirmation', async ({ page }) => {
  const signupPayloads: Record<string, unknown>[] = [];
  await page.route('**/auth/v1/signup**', async route => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    signupPayloads.push(payload);
    const userMetadata = (payload.data ?? {}) as Record<string, unknown>;
    const userId = '00000000-0000-4000-8000-000000000901';
    const timestamp = new Date().toISOString();
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: String(payload.email),
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: userMetadata,
        identities: [{
          identity_id: userId, id: userId, user_id: userId,
          identity_data: { email: String(payload.email) },
          provider: 'email', created_at: timestamp, updated_at: timestamp,
        }],
        created_at: timestamp,
      }),
    });
  });

  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'ساخت حساب و فضای کاری' }).click();
  await expect(page).toHaveURL(/#signup$/);
  await expect(page.getByRole('heading', { name: 'ساخت حساب و فضای کاری' })).toBeVisible();
  await page.getByLabel('نام و نام خانوادگی').fill('مالک آزمایشی');
  await page.getByLabel('نام مزرعه یا مجموعه').fill('مزرعه آزمایشی');
  await page.locator('#simorgh-signin-phone').fill('09120000000');
  await page.getByLabel('ایمیل').fill('owner@example.test');
  await page.getByLabel('گذرواژه', { exact: true }).fill('Test-password-2026');
  await page.getByLabel('تکرار گذرواژه').fill('Test-password-2026');
  await page.getByRole('button', { name: 'ساخت حساب و فضای کاری', exact: true }).click();

  await expect(page.getByRole('status')).toContainText('اگر این ایمیل قابل ثبت‌نام باشد');
  expect(signupPayloads).toHaveLength(1);
  expect(signupPayloads[0].email).toBe('owner@example.test');
  expect(signupPayloads[0].data).toMatchObject({
    full_name: 'مالک آزمایشی',
    organization_name: 'مزرعه آزمایشی',
    phone: '09120000000',
    signup_workspace_pending: true,
  });
  expect(signupPayloads[0].emailRedirectTo).toContain('/simorgh/app/command');
});
