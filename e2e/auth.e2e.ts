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
  await expect(page.getByText(/ثبت‌نام عمومی غیرفعال است/)).toBeVisible();
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
  await expect(page.getByText(/ثبت‌نام عمومی غیرفعال است/)).toBeVisible();
  await page.getByRole('button', { name: 'بازگشت به ورود' }).click();
  await expect(page.getByRole('heading', { name: 'ورود به مدار' })).toBeVisible();
});
