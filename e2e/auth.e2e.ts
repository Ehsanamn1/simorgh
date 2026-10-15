import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('simorgh-theme'); } catch { /* storage may be restricted */ }
  });
});

test('the operational workspace opens directly in Persian without login or design-only controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/سیمرغ \| مدیریت یکپارچه‌ی مزرعه و عملیات/);
  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('.sim-workspace-app')).toBeVisible();
  await expect(page.locator('#app-boot-screen')).toHaveCount(0);
  await expect(page.locator('.portal')).toHaveCount(0);
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);
  await expect(page.locator('.sim-workspace-sidebar')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'مرکز فرمان شبکه' })).toBeVisible();
  await expect(page.locator('.sim-workspace-goal')).toHaveCount(4);
  await expect(page.locator('.sim-workspace-quick-card')).toHaveCount(4);
  await expect(page.locator('.sim-workspace-palette')).toHaveCount(0);
  await expect(page.locator('.sim-workspace-role-switch')).toHaveCount(0);

  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('a blocked application bundle shows a recovery screen rather than a blank black page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Run the startup failure simulation once.');
  await page.route(/\/simorgh\/assets\/.*\.js(?:\?.*)?$/, route => route.abort());
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app-boot-screen')).toHaveClass(/has-error/, { timeout: 12_000 });
  await expect(page.getByRole('alert')).toContainText('برنامه بارگذاری نشد');
  await expect(page.getByRole('button', { name: 'بارگذاری دوباره' })).toBeVisible();
});

test('theme switch persists and quick-access cards navigate to operational modules', async ({ page }) => {
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'فعال‌کردن حالت روشن' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'فعال‌کردن حالت تاریک' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.locator('.sim-workspace-quick-access').getByRole('button', { name: /انبار و خرید/ }).click();
  await expect(page.getByRole('heading', { name: 'انبار و ثبت خرید', level: 1 })).toBeVisible();

  await page.locator('.sim-workspace-sidebar').getByRole('button', { name: 'نقشه و راهنما' }).click();
  await expect(page.getByRole('heading', { name: 'نقشه‌ی راهنمای شبکه' })).toBeVisible();
  await expect(page.getByTitle('نقشه جغرافیایی ایران برای راهنمای شبکه')).toBeVisible();
  await expect(page.getByText('نقطه‌ی واقعی برای نمایش موجود نیست')).toBeVisible();
});
