import { expect, test } from '@playwright/test';

test('the actual app-first workspace matches the Obsidian direction and has no fabricated KPI values', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('.sim-preview-masthead')).toBeVisible();
  await expect(page.locator('.sim-preview-palette .sim-preview-swatch')).toHaveCount(11);
  await expect(page.locator('.sim-preview-sidebar')).toBeVisible();
  await expect(page.locator('.sim-preview-metric')).toHaveCount(4);
  await expect(page.locator('.sim-preview-metric strong')).toHaveText(['—', '—', '—', '—']);
  await expect(page.locator('.sim-preview-map-frame iframe')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'مرکز فرمان شبکه' })).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('simorgh-obsidian-command-tower-viewport.png') });
  await page.screenshot({ path: testInfo.outputPath('simorgh-obsidian-command-tower-full.png'), fullPage: true });

  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('preview navigation opens real page structures on desktop, tablet and mobile', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });

  if (viewportWidth <= 700) {
    await expect(page.locator('.sim-preview-bottom-nav')).toBeVisible();
    await page.getByRole('button', { name: /بازکردن منو/ }).click();
    await expect(page.locator('.sim-preview-sidebar.open')).toBeVisible();
    await page.locator('.sim-preview-sidebar').getByRole('button', { name: 'انبار و ثبت خرید' }).click();
    await expect(page.getByRole('heading', { name: 'انبار و ثبت خرید' })).toBeVisible();
  } else {
    await expect(page.locator('.sim-preview-bottom-nav')).toBeHidden();
    await page.locator('.sim-preview-sidebar').getByRole('button', { name: 'انبار و ثبت خرید' }).click();
    await expect(page.getByRole('heading', { name: 'انبار و ثبت خرید' })).toBeVisible();
  }

  await page.getByRole('button', { name: 'نقشه و راهنما' }).click();
  await expect(page.getByRole('heading', { name: 'نقشه‌ی راهنمای شبکه' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
});
