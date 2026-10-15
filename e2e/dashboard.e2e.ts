import { expect, test } from '@playwright/test';

const projectUrl = 'https://aoxerjimfiwusidaparx.supabase.co';
const userId = '00000000-0000-4000-8000-000000000011';
const companyId = '00000000-0000-4000-8000-000000000022';

test('owner command center loads, remains within the viewport, and quick actions navigate', async ({ page }, testInfo) => {
  // All records in this test are intercepted browser fixtures. No production row is inserted or modified.
  const now = Math.floor(Date.now() / 1000);
  await page.addInitScript(({ storageKey, session }) => {
    window.localStorage.setItem(storageKey, JSON.stringify(session));
  }, {
    storageKey: 'sb-aoxerjimfiwusidaparx-auth-token',
    session: {
      access_token: 'simorgh-e2e-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: 'simorgh-e2e-refresh-token',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'owner@example.test',
        email_confirmed_at: new Date().toISOString(),
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { full_name: 'مالک آزمایشی سیمرغ' },
        created_at: new Date().toISOString(),
      },
    },
  });

  await page.route(`${projectUrl}/rest/v1/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const relation = url.pathname.split('/').pop();

    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,HEAD,OPTIONS,POST,PATCH,DELETE,PUT',
      'content-type': 'application/json',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders, body: '' });
      return;
    }

    if (relation === 'memberships') {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-range': '0-0/1' },
        body: JSON.stringify([{
          id: '00000000-0000-4000-8000-000000000033',
          company_id: companyId,
          user_id: userId,
          role: 'owner',
          customer_id: null,
          supplier_id: null,
          active: true,
          companies: { name: 'شبکه سیمرغ' },
        }]),
      });
      return;
    }

    if (request.method() === 'HEAD') {
      const count = relation === 'customers' ? 5
        : relation === 'suppliers' ? 3
        : relation === 'shipments' ? 2
        : relation === 'capacity_commitments' ? 4
        : 1;
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-range': `*/${count}` },
        body: '',
      });
      return;
    }

    if (relation === 'orders') {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, 'content-range': '0-0/1' },
        body: JSON.stringify([{
          id: '00000000-0000-4000-8000-000000000044',
          reference: 'SO-261015-TEST01',
          status: 'submitted',
          requested_delivery: '2026-10-16',
          created_at: new Date().toISOString(),
          customers: { name: 'خریدار آزمایشی' },
        }]),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: { ...corsHeaders, 'content-range': '*/0' },
      body: '[]',
    });
  });

  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'مرکز فرمان شبکه' })).toBeVisible();
  await expect(page.getByText('SO-261015-TEST01')).toBeVisible();
  await expect(page.getByText('خریدار آزمایشی')).toBeVisible();
  await expect(page.getByRole('link', { name: /ثبت مشتریان واقعی/ })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('owner-command-center.png'), fullPage: true });

  await page.getByRole('link', { name: /ثبت مشتریان واقعی/ }).click();
  await expect(page.getByRole('heading', { name: 'مشتریان' })).toBeVisible();
});
