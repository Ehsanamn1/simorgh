import { expect, test } from '@playwright/test';

test('public entry is a role-based portal and never renders sign-in or registration forms', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/سیمرغ/);
  await expect(page.locator('.portal-hero h1')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'برای هر نقش، فضای خودش' })).toBeVisible();
  await expect(page.getByRole('button', { name: /مدیر و مالک شبکه/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /تأمین‌کننده و شریک مزرعه/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /راننده و پیمانکار حمل/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /مشتری و خریدار عمده/ })).toBeVisible();
  await expect(page.locator('input[type="password"], input[type="email"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /ثبت‌نام|ورود امن|ورود به سیمرغ/ })).toHaveCount(0);
  await expect(page.getByText('نقش با انتخاب کارت فعال نمی‌شود.')).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('workspace-portal.png'), fullPage: true });
});

test('role selection opens an explicit non-operational preview, not private data', async ({ page }) => {
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  const supplier = page.getByRole('button', { name: /تأمین‌کننده و شریک مزرعه/ });
  await supplier.click();
  await expect(supplier).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'نمایش ساختار پنل' }).click();
  await expect(page.getByRole('heading', { name: 'فضای تأمین و مزرعه' })).toBeVisible();
  await expect(page.getByText('نمای ساختاری، نه پنل عملیاتی')).toBeVisible();
  await expect(page.getByText(/هیچ رکورد خصوصی بارگذاری یا قابل ویرایش نیست/)).toBeVisible();
  await expect(page.locator('.portal-capability').getByText('ظرفیت تولید', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /بازگشت به انتخاب نقش/ }).click();
  await expect(page.getByRole('heading', { name: 'برای هر نقش، فضای خودش' })).toBeVisible();
});
