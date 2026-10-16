import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('simorgh-theme'); } catch { /* Private mode may disable storage. */ }
  });
});

test('the app opens a Persian username sign-in instead of a role preview', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/مدار \| مدیریت یکپارچه مزرعه و عملیات/);
  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('#app-boot-screen')).toHaveCount(0);
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.locator('.ops-live-app, .ops-live-bottom-nav, .app-frame')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'ورود به مدار' })).toBeVisible();
  await expect(page.getByLabel('نام کاربری')).toBeVisible();
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

test('password recovery is not advertised without a verified recovery channel', async ({ page }) => {
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'گذرواژه‌ات را فراموش کرده‌ای؟' })).toHaveCount(0);
  await expect(page.getByLabel('نام کاربری')).toBeVisible();
  await expect(page.getByLabel('گذرواژه', { exact: true })).toBeVisible();
});

test('signup submits username, profile, Iranian mobile, password and requested role to the Medar API', async ({ page }) => {
  const signupPayloads: Record<string, unknown>[] = [];
  let registered = false;
  const user = { id: '00000000-0000-4000-8000-000000000901', username: 'owner_test', phone: '+989120000000', displayName: 'Ehsan Test', requestedRole: 'supplier' };

  await page.route('**/api/auth/me', async route => {
    if (!registered) {
      await route.fulfill({ status: 401, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'No session' }) });
      return;
    }
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user }) });
  });
  await page.route('**/api/workspace/memberships', route => route.fulfill({
    status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memberships: [], accessRequests: [] }),
  }));
  await page.route('**/api/auth/signup', async route => {
    signupPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    registered = true;
    await route.fulfill({ status: 201, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user }) });
  });

  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'ساخت حساب و فضای کاری' }).click();
  await expect(page).toHaveURL(/#signup$/);
  await expect(page.getByRole('heading', { name: 'ساخت حساب و فضای کاری' })).toBeVisible();
  await page.locator('#simorgh-signin-phone').fill('۰۹۱۲۰۰۰۰۰۰۰');
  await page.locator('#simorgh-signin-fullname').fill('Ehsan Test');
  await page.locator('#simorgh-signin-organization').fill('مجموعه آزمایشی');
  await page.getByLabel('نام کاربری').fill('owner_test');
  await page.getByLabel('گذرواژه', { exact: true }).fill('Test-password-2026');
  await page.getByLabel('تکرار گذرواژه').fill('Test-password-2026');
  await page.locator('#simorgh-signin-role').selectOption('supplier');
  await page.getByRole('button', { name: 'ساخت حساب و فضای کاری', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'درخواست فضای کاری' })).toBeVisible({ timeout: 15_000 });
  expect(signupPayloads).toHaveLength(1);
  expect(signupPayloads[0]).toMatchObject({
    username: 'owner_test',
    phone: '+989120000000',
    requestedRole: 'supplier',
    displayName: 'Ehsan Test',
    organizationName: 'مجموعه آزمایشی',
  });
  expect(signupPayloads[0]).not.toHaveProperty('email');
  expect(signupPayloads[0]).toHaveProperty('password', 'Test-password-2026');
});
