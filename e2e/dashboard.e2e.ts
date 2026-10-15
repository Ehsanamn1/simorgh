import { expect, test } from '@playwright/test';

test('workspace entry is app-first and never exposes public role previews', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('.portal')).toHaveCount(0);
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'ایجاد حساب' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /مدیر و مالک شبکه/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /تأمین‌کننده و شریک مزرعه/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /راننده و پیمانکار حمل/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /مشتری و خریدار عمده/ })).toHaveCount(0);
  await expect(page.getByText(/ثبت‌نام عمومی غیرفعال است/)).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});
