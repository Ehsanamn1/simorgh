import { expect, test, type Page } from '@playwright/test';

const projectUrl = 'https://aoxerjimfiwusidaparx.supabase.co';
const userId = '00000000-0000-4000-8000-000000000011';
const companyId = '00000000-0000-4000-8000-000000000022';
const supplierId = '00000000-0000-4000-8000-000000000033';

async function installIsolatedSession(page: Page, role: 'owner' | 'supplier') {
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
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: role + '@example.test',
        email_confirmed_at: new Date().toISOString(),
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { full_name: role === 'owner' ? 'مالک تست سیمرغ' : 'تأمین‌کننده تست سیمرغ' },
        created_at: new Date().toISOString(),
      },
    },
  });

  // Intercept every database request. These are browser-only fixtures, never real Supabase rows.
  await page.route(projectUrl + '/rest/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split('/').pop() ?? '';
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
          company_id: companyId,
          user_id: userId,
          role,
          customer_id: null,
          supplier_id: role === 'supplier' ? supplierId : null,
          active: true,
          companies: { name: 'شبکه سیمرغ' },
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

test('manager workspace opens operational modules from isolated fixtures without creating database rows', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installIsolatedSession(page, 'owner');

  const paths = [
    { path: 'farm-sites', title: 'سایت‌های مزرعه' },
    { path: 'flock-cycles', title: 'چرخه‌های گله' },
    { path: 'production-batches', title: 'بچ‌های تولید' },
    { path: 'daily-production', title: 'ثبت روزانه تولید' },
    { path: 'task-templates', title: 'دستورالعمل‌های کاری' },
    { path: 'operational-tasks', title: 'وظایف عملیاتی' },
    { path: 'incidents', title: 'رخدادها و مغایرت‌ها' },
    { path: 'partnership-agreements', title: 'قراردادهای مشارکت' },
    { path: 'partner-finance', title: 'دفتر مالی شریک' },
    { path: 'partner-settlements', title: 'دوره‌ها و تسویه شریک' },
  ];
  await page.goto('/simorgh/app/farm-sites', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'سایت‌های مزرعه' })).toBeVisible();
  await expect(page.getByText('هنوز رکوردی وجود ندارد')).toBeVisible();

  for (const item of paths.slice(1)) {
    await page.goto('/simorgh/app/' + item.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: item.title })).toBeVisible();
    await expect(page.getByText('هنوز رکوردی وجود ندارد')).toBeVisible();
  }
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(pageErrors).toEqual([]);
});

test('supplier workspace shows task controls while keeping manager-only setup out of the supplier menu', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installIsolatedSession(page, 'supplier');
  await page.goto('/simorgh/app/operational-tasks', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'وظایف عملیاتی' })).toBeVisible();
  await expect(page.getByRole('link', { name: /وظایف عملیاتی/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /دستورالعمل‌های کاری/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /دوره‌های تسویه/ })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
