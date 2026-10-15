import { expect, test } from '@playwright/test';

test('authentication entry is readable, responsive, and has usable controls', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/سیمرغ/);
  await expect(page.getByRole('heading', { name: 'ورود به سیمرغ' })).toBeVisible();
  await expect(page.getByLabel('ایمیل سازمانی')).toBeVisible();
  await expect(page.getByLabel('رمز عبور')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ورود امن' })).toBeVisible();

  const layout = await page.evaluate(() => {
    const form = document.querySelector<HTMLElement>('.auth-form-wrap');
    const input = document.querySelector<HTMLInputElement>('.auth-fields input');
    const submit = document.querySelector<HTMLElement>('.auth-submit');
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      formWidth: form?.getBoundingClientRect().width ?? 0,
      inputHeight: input?.getBoundingClientRect().height ?? 0,
      submitHeight: submit?.getBoundingClientRect().height ?? 0,
      headingFontSize: Number.parseFloat(getComputedStyle(document.querySelector('.auth-form-wrap h2')!).fontSize),
    };
  });

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.formWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.inputHeight).toBeGreaterThanOrEqual(44);
  expect(layout.submitHeight).toBeGreaterThanOrEqual(44);
  expect(layout.headingFontSize).toBeGreaterThanOrEqual(22);
  expect(pageErrors).toEqual([]);

  await page.screenshot({ path: testInfo.outputPath('auth-entry.png'), fullPage: true });
});

test('signup and password recovery modes work without submitting external requests', async ({ page }) => {
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'ثبت‌نام' }).click();
  await expect(page.getByRole('heading', { name: 'ساخت حساب کاربری' })).toBeVisible();
  await expect(page.getByLabel('نام و نام خانوادگی')).toBeVisible();
  await expect(page.getByLabel('رمز عبور')).toBeVisible();

  await page.getByRole('button', { name: 'بازگشت به ورود' }).click();
  await expect(page.getByRole('heading', { name: 'ورود به سیمرغ' })).toBeVisible();

  await page.getByRole('button', { name: 'رمز عبور را فراموش کرده‌ام' }).click();
  await expect(page.getByRole('heading', { name: 'بازیابی رمز عبور' })).toBeVisible();
  await expect(page.getByLabel('ایمیل سازمانی')).toBeVisible();
  await expect(page.getByLabel('رمز عبور')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ارسال لینک بازیابی' })).toBeVisible();
});
