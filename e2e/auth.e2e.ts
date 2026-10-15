import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('simorgh-theme'); } catch { /* private mode may disable storage */ }
  });
});

test('the app opens the Persian operational workspace with no sign-in page or preview-role selector', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/سیمرغ \| مدیریت یکپارچه عملیات/);
  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('.ops-live-app')).toBeVisible();
  await expect(page.locator('#app-boot-screen')).toHaveCount(0);
  await expect(page.locator('.portal')).toHaveCount(0);
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);
  await expect(page.locator('.sim-preview-palette')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'مرکز فرمان شبکه' })).toBeVisible();
  await expect(page.getByText('دسترسی سریع')).toBeVisible();
  await expect(page.locator('.ops-live-quick-card')).toHaveCount(4);
  await expect(page.locator('.ops-live-status')).toContainText('داده‌های شرکت در انتظار فعال‌سازی حساب مالک');

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

test('dark and light themes work, and the four quick-access cards navigate to their modules', async ({ page }) => {
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'فعال‌کردن حالت روشن' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'فعال‌کردن حالت تاریک' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: /مدیریت سفارش‌ها/ }).click();
  await expect(page).toHaveURL(/module=orders/);
  await expect(page.getByRole('heading', { name: 'سفارش‌ها', level: 1 })).toBeVisible();
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);
});

test('map module contains a real geographic guide and no invented shipment marker', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  if (viewportWidth <= 850) {
    await page.locator('.ops-live-bottom-nav').getByRole('button', { name: 'نقشه' }).click();
  } else {
    await page.locator('.ops-live-sidebar').getByRole('button', { name: 'نقشه و راهنما' }).click();
  }
  await expect(page.getByRole('heading', { name: 'نقشه و راهنما', level: 1 })).toBeVisible();
  await expect(page.getByTitle('نقشه جغرافیایی ایران')).toBeVisible();
  await expect(page.getByText('نقطه‌ی عملیاتی ثبت نشده')).toBeVisible();
});
