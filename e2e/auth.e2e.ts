import { expect, test } from '@playwright/test';




test('the app opens a username-and-password sign-in without an email field', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, memberships: [] }),
  }));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/صحرا \| مدیریت یکپارچه مزرعه و عملیات/);
  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('#app-boot-screen')).toHaveCount(0);
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ورود به صحرا' })).toBeVisible();
  await expect(page.getByLabel('نام کاربری')).toBeVisible();
  await expect(page.getByLabel('گذرواژه', { exact: true })).toBeVisible();
  const signInThemeToggle = page.getByRole('button', { name: 'تغییر حالت نمایش' });
  await expect(signInThemeToggle).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(signInThemeToggle).toHaveAttribute('aria-pressed', 'true');
  await signInThemeToggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'تغییر حالت نمایش' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'تغییر حالت نمایش' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#simorgh-signin-email')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ساخت حساب و فضای کاری' })).toHaveCount(0);
  await expect(page.getByText(/ثبت‌نام عمومی غیرفعال است/)).toBeVisible();
  await expect(page.locator('.portal')).toHaveCount(0);
  await expect(page.locator('.sim-preview-palette')).toHaveCount(0);

  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('public signup and invitation-code access are disabled; owners provision accounts', async ({ page }) => {
  let signupRequests = 0;
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, memberships: [] }),
  }));
  await page.route('**/api/auth/signup', async route => {
    signupRequests += 1;
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'ثبت‌نام عمومی غیرفعال است.' }) });
  });

  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'ورود به صحرا' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ساخت حساب و فضای کاری' })).toHaveCount(0);
  await expect(page.getByText(/ثبت‌نام عمومی غیرفعال است/)).toBeVisible();

  await page.goto('/simorgh/app/command#signup', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ورود به صحرا' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ساخت حساب و فضای کاری' })).toHaveCount(0);
  await expect(page.getByText(/ثبت‌نام عمومی غیرفعال است/)).toBeVisible();
  expect(signupRequests).toBe(0);
});

test('login accepts a username and renders server errors', async ({ page }) => {
  let loginBody: Record<string, unknown> | undefined;
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, memberships: [] }),
  }));
  await page.route('**/api/auth/login', async route => {
    loginBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'نام کاربری یا رمز عبور نادرست است.' }),
    });
  });
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('نام کاربری').fill('missing_user');
  await page.getByLabel('گذرواژه', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'ورود به فضای کار' }).click();
  await expect(page.getByRole('alert')).toContainText('نام کاربری یا رمز عبور نادرست است');
  expect(loginBody).toEqual({ username: 'missing_user', password: 'incorrect-password' });
  expect(loginBody).not.toHaveProperty('email');
});
 
test('a blocked JavaScript bundle shows a recovery state instead of a black page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Run the startup failure simulation once.');
  await page.route(/\/simorgh\/assets\/.*\.js(?:\?.*)?$/, route => route.abort());
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app-boot-screen')).toHaveClass(/has-error/, { timeout: 12_000 });
  await expect(page.getByRole('alert')).toContainText('برنامه بارگذاری نشد');
  await expect(page.getByRole('button', { name: 'بارگذاری دوباره' })).toBeVisible();
});
