import { expect, test } from '@playwright/test';

test('Madar public workspace stays within mobile, tablet and desktop viewports', async ({ page }) => {
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

  await page.goto('/simorgh/demo', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.demo-workspace')).toBeVisible();

  for (const width of [320, 360, 375, 390, 414, 430, 640, 768, 1024, 1365]) {
    await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 });
    await expect(page.locator('.demo-workspace')).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document, `document horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.body, `body horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const bottomNav = page.locator('.demo-mobile-bottom-nav');
  await expect(bottomNav).toBeVisible();
  await expect(bottomNav.locator('button')).toHaveCount(4);
  await bottomNav.getByRole('button', { name: 'سفارش‌ها', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'سفارش‌ها', exact: true })).toBeVisible();
  await bottomNav.getByRole('button', { name: 'نمای کلی', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'عملیات، در یک نگاه.' })).toBeVisible();
  await expect(errors).toEqual([]);
});
