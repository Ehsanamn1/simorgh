import { expect, test, type Page } from '@playwright/test';

const projectUrl = 'https://aoxerjimfiwusidaparx.supabase.co';
const userId = '00000000-0000-4000-8000-000000000011';
const companyId = '00000000-0000-4000-8000-000000000022';
const supplierId = '00000000-0000-4000-8000-000000000033';
const customerId = '00000000-0000-4000-8000-000000000055';

async function installIsolatedSession(page: Page, role: 'owner' | 'supplier' | 'driver' | 'customer') {
  const now = Math.floor(Date.now() / 1000);
  await page.addInitScript(({ storageKey, session }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(session));
  }, {
    storageKey: 'sb-aoxerjimfiwusidaparx-auth-token',
    session: {
      access_token: 'simorgh-isolated-e2e-access-token',
      token_type: 'bearer',
      expires_in: 60 * 60 * 24 * 365,
      expires_at: now + 60 * 60 * 24 * 365,
      refresh_token: 'simorgh-isolated-e2e-refresh-token',
      user: {
        id: userId, aud: 'authenticated', role: 'authenticated',
        email: role + '@example.test', email_confirmed_at: new Date().toISOString(),
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { full_name: role === 'owner' ? 'مالک تست سیمرغ' : role === 'supplier' ? 'تأمین‌کننده تست سیمرغ' : role === 'driver' ? 'راننده تست سیمرغ' : 'مشتری تست سیمرغ' },
        created_at: new Date().toISOString(),
      },
    },
  });

  // Browser-only responses: no test rows are written to the production database.
  await page.route(projectUrl + '/rest/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split('/').pop() || '';
    const headers: Record<string, string> = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,HEAD,OPTIONS,POST,PATCH,DELETE,PUT',
      'content-type': 'application/json',
      'cache-control': 'no-store',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers, body: '' });
      return;
    }
    if (table === 'memberships') {
      await route.fulfill({
        status: 200,
        headers: { ...headers, 'content-range': '0-0/1' },
        body: JSON.stringify([{
          id: '00000000-0000-4000-8000-000000000044',
          company_id: companyId, user_id: userId, role,
          customer_id: role === 'customer' ? customerId : null, supplier_id: role === 'supplier' ? supplierId : null,
          active: true, companies: { name: 'شبکه سیمرغ' },
        }]),
      });
      return;
    }
    if (request.method() === 'HEAD') {
      await route.fulfill({ status: 200, headers: { ...headers, 'content-range': '*/0' }, body: '' });
      return;
    }
    await route.fulfill({ status: 200, headers: { ...headers, 'content-range': '*/0' }, body: '[]' });
  });
}

test('manager workspace retains operations and captures a real rendered control-tower screen', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /مرکز فرمان شبکه/ })).toBeVisible();
  await expect(page.locator('.side-nav').getByRole('link', { name: /سفارش‌ها/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('manager-control-tower-viewport.png') });
  await page.screenshot({ path: testInfo.outputPath('manager-control-tower.png'), fullPage: true });

  const paths = [
    ['farm-sites', 'مزارع و واحدها'],
    ['flock-cycles', 'چرخه‌های پرورش'],
    ['production-batches', 'دوره‌ها و بچ‌های تولید'],
    ['daily-production', 'گزارش روزانه'],
    ['task-templates', 'دستورالعمل‌های کاری'],
    ['operational-tasks', 'وظایف عملیاتی'],
    ['incidents', 'رخدادها و مغایرت‌ها'],
    ['partnership-agreements', 'قراردادهای مشارکت'],
    ['partner-finance', 'دفتر مالی شریک'],
    ['partner-settlements', 'دوره‌ها و تسویه شریک'],
  ];
  for (const [path, title] of paths) {
    await page.goto('/simorgh/app/' + path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('manager forms support generic farm types, species, production and daily records', async ({ page }) => {
  await installIsolatedSession(page, 'owner');

  await page.goto('/simorgh/app/farm-sites', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'مزارع و واحدها' })).toBeVisible();
  await page.getByRole('button', { name: 'ثبت رکورد', exact: true }).click();
  const farmType = page.locator('#ops-farm_type');
  await expect(farmType).toBeVisible();
  for (const kind of ['crop', 'livestock', 'poultry', 'dairy', 'aquaculture', 'greenhouse', 'orchard', 'apiary', 'other']) {
    await expect(farmType.locator('option[value="' + kind + '"]')).toHaveCount(1);
  }
  await expect(page.locator('#ops-province')).toBeVisible();
  await page.getByRole('button', { name: 'بستن' }).click();

  await page.goto('/simorgh/app/flock-cycles', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'چرخه‌های پرورش' })).toBeVisible();
  await page.getByRole('button', { name: 'ثبت رکورد', exact: true }).click();
  await expect(page.locator('#ops-species')).toHaveValue('عمومی');
  await expect(page.locator('#ops-initial_count')).toBeVisible();
  await expect(page.locator('#ops-initial_bird_count')).toHaveCount(0);
  await page.getByRole('button', { name: 'بستن' }).click();

  await page.goto('/simorgh/app/production-batches', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'دوره‌ها و بچ‌های تولید' })).toBeVisible();
  await page.getByRole('button', { name: 'ثبت رکورد', exact: true }).click();
  const productionKind = page.locator('#ops-production_kind');
  for (const kind of ['crop', 'livestock', 'poultry', 'dairy', 'aquaculture', 'honey', 'forestry', 'greenhouse', 'orchard', 'other']) {
    await expect(productionKind.locator('option[value="' + kind + '"]')).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'بستن' }).click();

  await page.goto('/simorgh/app/daily-production', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'گزارش روزانه' })).toBeVisible();
  await page.getByRole('button', { name: 'ثبت رکورد', exact: true }).click();
  await expect(page.locator('#ops-input_name')).toBeVisible();
  await expect(page.locator('#ops-input_quantity')).toBeVisible();
  await expect(page.locator('#ops-input_unit')).toHaveValue('کیلوگرم');
  await expect(page.locator('#ops-loss_count')).toBeVisible();
  await expect(page.locator('#ops-produced_quantity')).toBeVisible();
  await expect(page.locator('#ops-rejected_quantity')).toBeVisible();
  await expect(page.locator('#ops-eggs_collected')).toHaveCount(0);
  await expect(page.locator('#ops-mortality_count')).toHaveCount(0);
});

test('supplier workspace keeps manager-only routes out of the allowed menu', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installIsolatedSession(page, 'supplier');
  await page.goto('/simorgh/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'وظایف عملیاتی' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('supplier-task-workspace-viewport.png') });
  await page.screenshot({ path: testInfo.outputPath('supplier-task-workspace.png'), fullPage: true });
  await expect(page.getByRole('link', { name: /وظایف عملیاتی/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /دستورالعمل‌های کاری/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /دسترسی کاربران/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /دوره‌های تسویه/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('manager bottom navigation stays manager-specific on mobile and tablet', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /مرکز فرمان شبکه/ })).toBeVisible();
  const mobileNav = page.locator('.mobile-workspace-nav');
  if (viewportWidth <= 860) {
    await expect(mobileNav).toBeVisible();
    for (const label of ['نمای کلی', 'سفارش‌ها', 'ارسال‌ها']) {
      await expect(mobileNav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(mobileNav.getByRole('button', { name: 'بازکردن منوی کامل' })).toBeVisible();
    await expect(mobileNav.locator('a,button')).toHaveCount(4);
    await expect(mobileNav.getByRole('link', { name: 'مالی', exact: true })).toHaveCount(0);
    await expect(mobileNav.getByRole('link', { name: 'وظایف', exact: true })).toHaveCount(0);
    await expect(mobileNav.getByRole('link', { name: 'دفتر شریک', exact: true })).toHaveCount(0);
  } else {
    await expect(mobileNav).toBeHidden();
  }
});
test('mobile navigation is role-specific and only mirrors permitted real routes', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  await installIsolatedSession(page, 'supplier');
  await page.goto('/simorgh/app/operational-tasks', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'وظایف عملیاتی' })).toBeVisible();

  const mobileNav = page.locator('.mobile-workspace-nav');
  if (viewportWidth <= 860) {
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'وظایف' })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'ثبت تولید' })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'ظرفیت' })).toBeVisible();
    await expect(mobileNav.getByRole('button', { name: 'بازکردن منوی کامل' })).toBeVisible();
    await expect(mobileNav.locator('a,button')).toHaveCount(4);
    await expect(mobileNav.getByRole('link', { name: 'دفتر شریک' })).toHaveCount(0);
    await expect(mobileNav.getByRole('link', { name: /دسترسی کاربران/ })).toHaveCount(0);
  } else {
    await expect(mobileNav).toBeHidden();
  }
});

 
test('customer lands in their authorized catalogue and sees customer-specific mobile navigation', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installIsolatedSession(page, 'customer');
  await page.goto('/simorgh/app', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/simorgh\/app\/catalog$/);
  await expect(page.getByRole('heading', { name: 'کاتالوگ اختصاصی شما' })).toBeVisible();
  await expect(page.locator('.side-nav').getByRole('link', { name: 'خرید سازمانی' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('customer-catalog-viewport.png') });
  if (viewportWidth <= 860) {
    const nav = page.locator('.mobile-workspace-nav');
    await expect(nav).toBeVisible();
    for (const label of ['خرید', 'سفارش‌های من', 'حساب']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('button', { name: 'بازکردن منوی کامل' })).toBeVisible();
    await expect(nav.locator('a,button')).toHaveCount(4);
    await expect(nav.getByRole('link', { name: 'مالی', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'وظایف', exact: true })).toHaveCount(0);
  } else {
    await expect(page.locator('.mobile-workspace-nav')).toBeHidden();
  }
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('driver lands in assigned shipments and does not get customer or manager navigation', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installIsolatedSession(page, 'driver');
  await page.goto('/simorgh/app', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/simorgh\/app\/driver-work$/);
  await expect(page.getByRole('heading', { name: 'محموله‌های من' })).toBeVisible();
  await expect(page.locator('.side-nav').getByRole('link', { name: 'محموله‌های من' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('driver-shipments-viewport.png') });
  if (viewportWidth <= 860) {
    const nav = page.locator('.mobile-workspace-nav');
    await expect(nav).toBeVisible();
    for (const label of ['محموله‌ها', 'نقشه', 'مدرک']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('button', { name: 'بازکردن منوی کامل' })).toBeVisible();
    await expect(nav.locator('a,button')).toHaveCount(4);
    await expect(nav.getByRole('link', { name: 'خرید', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'وظایف', exact: true })).toHaveCount(0);
  } else {
    await expect(page.locator('.mobile-workspace-nav')).toBeHidden();
  }
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});
