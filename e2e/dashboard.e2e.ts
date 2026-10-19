import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, memberships: [] }),
  }));
});

test('the default route is a secure Persian entry, not a clickable dashboard preview', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/مدار \| مدیریت یکپارچه مزرعه و عملیات/);
  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.locator('.ops-live-app, .ops-live-bottom-nav, .app-frame')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'ورود به مدار' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ساخت حساب و فضای کاری' })).toHaveCount(0);
  await expect(page.getByText(/ثبت‌نام عمومی غیرفعال است/)).toBeVisible();
  await expect(page.locator('.portal-preview')).toHaveCount(0);
  await expect(page.locator('.sim-preview-palette')).toHaveCount(0);
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('medar-secure-entry.png'), fullPage: true });
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('secure entry remains usable on desktop and mobile with no horizontal overflow', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.locator('.ops-live-app, .ops-live-bottom-nav, .app-frame')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'ورود به مدار' })).toBeVisible();
  await expect(page.getByLabel('نام کاربری')).toBeVisible();
  await expect(page.locator('#simorgh-signin-email')).toHaveCount(0);
  await expect(page.locator('#simorgh-signin-password')).toBeVisible();

  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);

  if (viewportWidth <= 640) {
    await expect(page.locator('.simorgh-signin-form-card')).toBeVisible();
    await expect(page.locator('.simorgh-signin-brand')).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test('secure entry stays within the viewport at narrow and tablet breakpoints', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });

  for (const width of [320, 360, 375, 414, 640, 768, 1024, 1365]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ورود به مدار' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document, `document overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.body, `body overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
  }

  expect(errors).toEqual([]);
});
