import { expect, test } from '@playwright/test';

test('public demo is navigable, searchable and clearly read-only', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/health', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, database: true, service: 'medar-api' }),
  }));
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: null, memberships: [] }),
  }));
  await page.goto('/simorgh/demo', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.demo-workspace')).toBeVisible();
  await expect(page.locator('.demo-preview-notice')).toContainText('داده‌های این صفحه نمونه هستند');
  await expect(page.getByRole('heading', { name: 'عملیات، در یک نگاه.' })).toBeVisible();
  await expect(page.locator('.demo-stat-card')).toHaveCount(4);
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);

  const enableLightMode = page.getByRole('button', { name: 'تغییر حالت نمایش' });
  await expect(enableLightMode).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'تغییر حالت نمایش' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('simorgh-theme'))).toBe('light');
  const lightPalette = await page.evaluate(() => ({
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    noticeTitle: getComputedStyle(document.querySelector('.demo-preview-notice b')!).color,
    metricText: getComputedStyle(document.querySelector('.demo-stat-value')!).color,
  }));
  expect(lightPalette.bodyBackground).toBe('rgb(243, 236, 230)');
  expect(lightPalette.noticeTitle).not.toBe(lightPalette.bodyBackground);
  expect(lightPalette.metricText).not.toBe(lightPalette.bodyBackground);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.demo-workspace')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'تغییر حالت نمایش' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('simorgh-theme'))).toBe('dark');
  const operationalEntry = page.getByRole('link', { name: 'ورود به فضای عملیاتی صحرا' });
  await expect(operationalEntry).toBeVisible();
  await expect(operationalEntry).toHaveAttribute('href', 'https://medar-ops.dengxiao445.workers.dev/app/command');

  if (await page.locator('.demo-menu-button').isVisible()) {
    await page.locator('.demo-menu-button').click();
  }
  await page.locator('.demo-sidebar .demo-nav-item').filter({ hasText: /^سفارش‌ها$/ }).click();
  await expect(page.getByRole('heading', { name: 'سفارش‌ها', exact: true })).toBeVisible();
  await page.locator('.demo-search').click();
  await page.locator('.demo-search').click();
  await page.getByRole('textbox', { name: 'جست‌وجو در داده‌های نمونه' }).fill('MD-2408');
  await expect(page.locator('.demo-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.demo-table tbody tr')).toContainText('MD-2408');

  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('sahra-public-demo.png'), fullPage: true });
});

test('mobile demo has four bottom navigation items, all key modules, and working shortcuts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/health', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, database: true, service: 'medar-api' }),
  }));
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user: null, memberships: [] }),
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/simorgh/demo', { waitUntil: 'domcontentloaded' });
  const bottomNav = page.locator('.demo-mobile-bottom-nav');
  await expect(bottomNav).toBeVisible();
  await expect(bottomNav.locator('button')).toHaveCount(4);
  await expect(page.locator('.demo-quick-access')).toBeVisible();
  await expect(page.locator('.demo-quick-action')).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'ورود به فضای عملیاتی صحرا' })).toBeVisible();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const lightMobileDimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(lightMobileDimensions.document).toBeLessThanOrEqual(lightMobileDimensions.viewport);
  expect(lightMobileDimensions.body).toBeLessThanOrEqual(lightMobileDimensions.viewport);
  await page.getByRole('button', { name: 'تغییر حالت نمایش' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'تغییر حالت نمایش' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await bottomNav.getByRole('button', { name: 'سفارش‌ها', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'سفارش‌ها', exact: true })).toBeVisible();
  await bottomNav.getByRole('button', { name: 'نمای کلی', exact: true }).click();
  await page.locator('.demo-quick-action').filter({ hasText: 'تولید و مزرعه' }).click();
  await expect(page.getByRole('heading', { name: 'سایت‌های مزرعه', exact: true })).toBeVisible();
  await bottomNav.getByRole('button', { name: 'عملیات', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'وظایف عملیاتی', exact: true })).toBeVisible();
  await bottomNav.getByRole('button', { name: 'ماژول‌ها' }).click();
  await expect(page.locator('.demo-sidebar')).toHaveClass(/is-open/);
  await expect(page.locator('.demo-nav')).toContainText('مالی و تسویه');
  await expect(page.locator('.demo-nav')).toContainText('قراردادهای مشارکت');
  await page.locator('.demo-nav-item').filter({ hasText: 'مشتریان' }).click();
  await expect(page.getByRole('heading', { name: 'مشتریان', exact: true })).toBeVisible();
  await expect(page.locator('.demo-table tbody tr')).toHaveCount(3);
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.body).toBeLessThanOrEqual(sizes.viewport);
  expect(errors).toEqual([]);
});
