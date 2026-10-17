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

  if (await page.locator('.demo-menu-button').isVisible()) {
    await page.locator('.demo-menu-button').click();
  }
  await page.getByRole('button', { name: 'سفارش‌ها', exact: true }).click();
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
  await page.screenshot({ path: testInfo.outputPath('medar-public-demo.png'), fullPage: true });
});
