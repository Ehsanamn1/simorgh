import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('simorgh-theme'); } catch { /* no-op in restricted storage contexts */ }
  });
});

test('app-first guest entry opens the Obsidian workspace without a login or signup screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/سیمرغ \| Obsidian Intelligence/);
  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('.sim-preview-app')).toBeVisible();
  await expect(page.locator('#app-boot-screen')).toHaveCount(0);
  await expect(page.locator('.portal')).toHaveCount(0);
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);
  await expect(page.locator('.sim-preview-sidebar')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'مرکز فرمان شبکه' })).toBeVisible();
  await expect(page.getByText(/هیچ سری داده‌ای به‌صورت نمایشی رسم نشده است/)).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('theme switch persists and the mobile role previews are navigable without granting access', async ({ page }) => {
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'فعال‌کردن حالت روشن' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'فعال‌کردن حالت تاریک' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('group', { name: 'پیش‌نمایش فضای کاری' }).getByRole('button', { name: 'مزرعه' }).click();
  await expect(page.getByRole('heading', { name: 'کارهای امروز مزرعه' })).toBeVisible();
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);

  await page.getByRole('group', { name: 'پیش‌نمایش فضای کاری' }).getByRole('button', { name: 'مشتری' }).click();
  await expect(page.getByRole('heading', { name: 'خرید سازمانی' })).toBeVisible();
  await expect(page.getByText(/هیچ تصویر، قیمت یا موجودی فرضی نشان داده نمی‌شود/)).toBeVisible();
});

test('the map help page shows geographic context but no fabricated shipment coordinates', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  if (viewportWidth <= 700) {
    await page.locator('.sim-preview-bottom-nav').getByRole('button', { name: 'نقشه' }).click();
  } else {
    await page.locator('.sim-preview-sidebar').getByRole('button', { name: 'نقشه و راهنما' }).click();
  }
  await expect(page.getByRole('heading', { name: 'نقشه‌ی راهنمای شبکه' })).toBeVisible();
  await expect(page.getByTitle('نقشه جغرافیایی ایران برای راهنمای شبکه')).toBeVisible();
  await expect(page.getByText('نقطه‌ی واقعی برای نمایش موجود نیست')).toBeVisible();
});
