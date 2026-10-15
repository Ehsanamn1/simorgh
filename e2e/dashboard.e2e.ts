import { expect, test } from '@playwright/test';

test('the Persian operations command center opens with no fabricated KPI values', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('.sim-workspace-masthead')).toBeVisible();
  await expect(page.locator('.sim-workspace-palette')).toHaveCount(0);
  await expect(page.locator('.sim-workspace-sidebar')).toBeVisible();
  await expect(page.locator('.sim-workspace-metric')).toHaveCount(4);
  await expect(page.locator('.sim-workspace-metric strong')).toHaveText(['—', '—', '—', '—']);
  await expect(page.locator('.sim-workspace-goal')).toHaveCount(4);
  await expect(page.locator('.sim-workspace-quick-card')).toHaveCount(4);
  await expect(page.locator('.sim-workspace-map-frame iframe')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'مرکز فرمان شبکه' })).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('simorgh-operations-command-center-desktop.png') });
  await page.screenshot({ path: testInfo.outputPath('simorgh-operations-command-center-full.png'), fullPage: true });

  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('operational navigation works on desktop, tablet and mobile', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });

  if (viewportWidth <= 700) {
    await expect(page.locator('.sim-workspace-bottom-nav')).toBeVisible();
    await expect(page.locator('.sim-workspace-bottom-nav button')).toHaveCount(4);
    await page.getByRole('button', { name: /بازکردن منو/ }).click();
    await expect(page.locator('.sim-workspace-sidebar.open')).toBeVisible();
    await page.locator('.sim-workspace-sidebar').getByRole('button', { name: 'انبار و ثبت خرید' }).click();
    await expect(page.getByRole('heading', { name: 'انبار و ثبت خرید', level: 1 })).toBeVisible();
    await page.locator('.sim-workspace-bottom-nav').getByRole('button', { name: 'نقشه' }).click();
  } else {
    await expect(page.locator('.sim-workspace-bottom-nav')).toBeHidden();
    await page.locator('.sim-workspace-sidebar').getByRole('button', { name: 'انبار و ثبت خرید' }).click();
    await expect(page.getByRole('heading', { name: 'انبار و ثبت خرید', level: 1 })).toBeVisible();
    await page.locator('.sim-workspace-sidebar').getByRole('button', { name: 'نقشه و راهنما' }).click();
  }
  await expect(page.getByRole('heading', { name: 'نقشه‌ی راهنمای شبکه' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
});
