import { expect, test } from '@playwright/test';

test('the operations control tower has real-data placeholders, map, goals and quick access', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('.ops-live-header')).toBeVisible();
  await expect(page.locator('.ops-live-sidebar')).toBeVisible();
  await expect(page.locator('.ops-live-stat')).toHaveCount(4);
  await expect(page.locator('.ops-live-stat strong')).toHaveText(['—', '—', '—', '—']);
  await expect(page.locator('.ops-live-quick-card')).toHaveCount(5);
  await expect(page.locator('.ops-live-map-frame iframe')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'مرکز فرمان شبکه' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'اهداف و مسیر اجرا' })).toBeVisible();
  await expect(page.locator('.sim-preview-palette')).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath('simorgh-control-tower-desktop.png') });
  await page.screenshot({ path: testInfo.outputPath('simorgh-control-tower-full.png'), fullPage: true });

  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('role-agnostic guest shell is navigable on desktop and mobile; mobile nav has exactly four items', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });

  if (viewportWidth <= 850) {
    await expect(page.locator('.ops-live-bottom-nav')).toBeVisible();
    await expect(page.locator('.ops-live-bottom-nav button')).toHaveCount(4);
    await page.getByRole('button', { name: 'بازکردن منو' }).click();
    await expect(page.locator('.ops-live-sidebar.open')).toBeVisible();
    await page.locator('.ops-live-sidebar').getByRole('button', { name: 'انبار و خرید' }).click();
    await expect(page.getByRole('heading', { name: 'انبار و خرید', level: 1 })).toBeVisible();
    await page.locator('.ops-live-bottom-nav').getByRole('button', { name: 'نقشه' }).click();
  } else {
    await expect(page.locator('.ops-live-bottom-nav')).toBeHidden();
    await page.locator('.ops-live-sidebar').getByRole('button', { name: 'انبار و خرید' }).click();
    await expect(page.getByRole('heading', { name: 'انبار و خرید', level: 1 })).toBeVisible();
    await page.locator('.ops-live-sidebar').getByRole('button', { name: 'نقشه و راهنما' }).click();
  }

  await expect(page.getByRole('heading', { name: 'نقشه و راهنما', level: 1 })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
});
