import { expect, test } from '@playwright/test';

const user = {
  id: '00000000-0000-4000-8000-000000000901',
  username: 'owner_test',
  phone: '+989120000000',
  full_name: 'مالک آزمایشی مدار',
};
const membership = {
  id: '00000000-0000-4000-8000-000000000902',
  company_id: '00000000-0000-4000-8000-000000000903',
  user_id: user.id,
  role: 'owner',
  active: true,
  customer_id: null,
  supplier_id: null,
  company: { name: 'مزرعه آزمایشی' },
};

test('the app opens a username-and-password sign-in without an email field', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, memberships: [] }),
  }));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page).toHaveTitle(/مدار \| مدیریت یکپارچه مزرعه و عملیات/);
  await expect(page).toHaveURL(/\/simorgh\/app\/command$/);
  await expect(page.locator('#app-boot-screen')).toHaveCount(0);
  await expect(page.locator('.simorgh-signin-layer')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ورود به مدار' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'ساخت حساب و فضای کاری' })).toBeVisible();
  await expect(page.locator('.portal')).toHaveCount(0);
  await expect(page.locator('.sim-preview-palette')).toHaveCount(0);

  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('signup creates a workspace using only a username and password', async ({ page }) => {
  let authenticated = false;
  let signupBody: Record<string, unknown> | undefined;
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(authenticated ? { user, memberships: [membership] } : { user: null, memberships: [] }),
  }));
  await page.route('**/api/workspace/memberships', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ memberships: authenticated ? [membership] : [] }),
  }));
  await page.route('**/api/auth/signup', async route => {
    signupBody = route.request().postDataJSON() as Record<string, unknown>;
    authenticated = true;
    await route.fulfill({
      status: 201, contentType: 'application/json',
      headers: { 'cache-control': 'no-store', 'set-cookie': 'medar_session=test-only; Path=/; HttpOnly; Secure; SameSite=None' },
      body: JSON.stringify({ user, companyId: membership.company_id, memberships: [membership] }),
    });
  });
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'ساخت حساب و فضای کاری' }).click();
  await expect(page).toHaveURL(/#signup$/);
  await expect(page.getByRole('heading', { name: 'ساخت حساب و فضای کاری' })).toBeVisible();
  for (const extraField of ['نام و نام خانوادگی', 'شماره موبایل', 'کد دعوت', 'تکرار گذرواژه']) await expect(page.getByLabel(extraField)).toHaveCount(0);
  await page.getByLabel('نام کاربری').fill('owner_test');
  await page.getByLabel('گذرواژه', { exact: true }).fill('Strong-test-pass-2026');
  await page.getByRole('button', { name: 'ساخت حساب و فضای کاری', exact: true }).click();
  await expect.poll(() => signupBody).toEqual({ username: 'owner_test', password: 'Strong-test-pass-2026' });
  await expect(page.locator('.app-frame')).toBeVisible();

  const operationalThemeToggle = page.getByRole('button', { name: 'تغییر حالت نمایش' });
  await expect(operationalThemeToggle).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(operationalThemeToggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('simorgh-theme'))).toBe('light');
  await expect.poll(() => page.locator('.app-frame').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(244, 247, 242)');
  await operationalThemeToggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'تغییر حالت نمایش' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('simorgh-theme'))).toBe('dark');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-frame')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'تغییر حالت نمایش' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('simorgh-theme'))).toBe('light');
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
