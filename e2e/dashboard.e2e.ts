import { expect, test } from '@playwright/test';

test('public access gateway renders the real Simorgh product identity and linked operations flow', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('.ops-live-gateway')).toBeVisible();
  await expect(page.locator('.ops-live-header')).toBeVisible();
  await expect(page.getByRole('heading', { name: /از مزرعه تا تصمیم/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /ورود مدیر و اعضا/ })).toBeVisible();
  await expect(page.locator('.ops-live-gateway-feature')).toHaveCount(4);
  await expect(page.locator('.ops-live-gateway-stage')).toHaveCount(5);
  await expect(page.getByText('نقشه و اهداف در فضای مدیریتی')).toBeVisible();
  await expect(page.locator('.ops-live-sidebar')).toHaveCount(0);
  await expect(page.locator('.ops-live-stat')).toHaveCount(0);
  await expect(page.locator('.ops-live-quick-card')).toHaveCount(0);
  await expect(page.locator('.sim-preview-palette')).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath('simorgh-access-gateway-viewport.png') });
  await page.screenshot({ path: testInfo.outputPath('simorgh-access-gateway-full.png'), fullPage: true });

  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    pageHeight: document.documentElement.scrollHeight,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.pageHeight).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the access gateway remains usable at desktop and mobile widths', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.ops-live-gateway')).toBeVisible();
  await expect(page.locator('.ops-live-gateway-footer')).toBeVisible();
  await expect(page.locator('.ops-live-gateway-feature')).toHaveCount(4);
  if (viewportWidth <= 640) {
    const featurePositions = await page.locator('.ops-live-gateway-feature').evaluateAll(elements =>
      elements.slice(0, 2).map(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width };
      }),
    );
    expect(featurePositions[0].top).toBeLessThan(featurePositions[1].top);
    expect(Math.abs(featurePositions[0].left - featurePositions[1].left)).toBeLessThan(2);
    expect(featurePositions[0].width).toBeGreaterThan(200);
  }

  await page.getByRole('button', { name: 'فعال‌کردن حالت روشن' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.ops-live-gateway')).toBeVisible();
  await page.getByRole('button', { name: 'فعال‌کردن حالت تاریک' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: /ورود مدیر و اعضا/ }).click();
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ورود به سیمرغ' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.simorgh-signin-layer')).toHaveCount(0);

  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
});
