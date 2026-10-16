import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('simorgh-theme'); } catch { /* private mode may disable storage */ }
  });
});

test('the public route shows the Persian access gateway, not an unauthenticated manager dashboard', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/سیمرغ \| مدیریت یکپارچه عملیات/);
  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('.ops-live-gateway')).toBeVisible();
  await expect(page.locator('#app-boot-screen')).toHaveCount(0);
  await expect(page.locator('.portal')).toHaveCount(0);
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);
  await expect(page.locator('.sim-preview-palette')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /از مزرعه تا تصمیم/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /ورود مدیر و اعضا/ })).toBeVisible();
  await expect(page.locator('.ops-live-gateway-feature')).toHaveCount(4);
  await expect(page.locator('.ops-live-gateway-stage')).toHaveCount(5);
  await expect(page.locator('.ops-live-sidebar')).toHaveCount(0);
  await expect(page.locator('.ops-live-stat')).toHaveCount(0);
  await expect(page.locator('.ops-live-quick-card')).toHaveCount(0);

  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('provisioned members can open secure sign-in without public self-registration', async ({ page }) => {
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);

  await page.getByRole('button', { name: 'ورود مدیر و اعضا' }).click();
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ورود به سیمرغ' })).toBeVisible();
  await expect(page.getByLabel('ایمیل')).toBeVisible();
  await expect(page.getByLabel('گذرواژه', { exact: true })).toBeVisible();
  await expect(page.getByText('ثبت‌نام عمومی غیرفعال است')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ورود به فضای کار' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'بستن ورود' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);
});

test('a blocked JavaScript bundle shows a recovery state instead of a black page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Run the startup failure simulation once.');
  await page.route(/\/simorgh\/assets\/.*\.js(?:\?.*)?$/, route => route.abort());
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app-boot-screen')).toHaveClass(/has-error/, { timeout: 12_000 });
  await expect(page.getByRole('alert')).toContainText('برنامه بارگذاری نشد');
  await expect(page.getByRole('button', { name: 'بارگذاری دوباره' })).toBeVisible();
});

test('gateway dark/light themes are readable and the sign-in action remains reachable', async ({ page }) => {
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'فعال‌کردن حالت روشن' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.ops-live-gateway')).toBeVisible();
  await page.getByRole('button', { name: 'فعال‌کردن حالت تاریک' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /ورود مدیر و اعضا/ }).click();
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await page.getByRole('button', { name: 'بستن ورود' }).click();
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);
  await expect(page.locator('.ops-live-gateway')).toBeVisible();
});

test('anonymous users cannot navigate into a manager module by directly opening a route', async ({ page }) => {
  await page.goto('/simorgh/app/farm-sites', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.ops-live-gateway')).toBeVisible();
  await expect(page.getByRole('heading', { name: /از مزرعه تا تصمیم/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'مزارع و واحدها' })).toHaveCount(0);
  await expect(page.locator('.tower-geo-panel')).toHaveCount(0);
});
