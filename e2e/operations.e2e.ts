import { expect, test, type Page } from '@playwright/test';

const companyId = '00000000-0000-4000-8000-000000000022';

async function installIsolatedSession(page: Page, role: 'owner' | 'supplier' | 'driver' | 'customer' | 'unprovisioned') {
  const userId = '00000000-0000-4000-8000-000000000011';
  const companyId = '00000000-0000-4000-8000-000000000022';
  const supplierId = '00000000-0000-4000-8000-000000000033';
  const customerId = '00000000-0000-4000-8000-000000000055';
  const fullName = role === 'owner' ? 'مالک آزمایشی مدار' : role === 'supplier' ? 'تأمین‌کننده آزمایشی مدار' : role === 'driver' ? 'راننده آزمایشی مدار' : role === 'unprovisioned' ? 'کاربر بدون عضویت مدار' : 'مشتری آزمایشی مدار';
  const username = role + '_test';
  const user = { id: userId, username, phone: '+989120000011', full_name: fullName };
  const memberships = role === 'unprovisioned' ? [] : [{
    id: '00000000-0000-4000-8000-000000000044',
    company_id: companyId, user_id: userId, role,
    customer_id: role === 'customer' ? customerId : null,
    supplier_id: role === 'supplier' ? supplierId : null,
    active: true,
    company: { name: 'شرکت آزمایشی مدار' },
  }];

  // The application session and workspace reads are simulated at the HTTP boundary.
  // Tests never write these identities or records to the live database.
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user, memberships }),
  }));
  await page.route('**/api/workspace/memberships', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ memberships }),
  }));
  await page.route('**/api/push/config**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ enabled: false, publicKey: null }),
  }));
  await page.route('**/api/notifications**', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notifications: [], summary: { total: 0, unread: 0 } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, updated: 0, notification: { readAt: new Date().toISOString() } }) });
  });

  // All business-data reads are isolated at the Worker API boundary; tests never write to a live database.
  await page.route('**/api/data/**', async route => {
    const table = new URL(route.request().url()).pathname.split('/').pop() || '';
    const payload = { data: [], count: 0, error: null, table };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(payload) });
  });

}

test('manager workspace retains operations and captures a real rendered control-tower screen', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  page.on('pageerror', error => errors.push(error.message));
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/home$/);
  await expect(page.getByRole('heading', { name: /سلام مالک آزمایشی مدار/ })).toBeVisible();
  await expect(page.locator('.workspace-home-hero')).toContainText('کنترل امروز کسب‌وکار');
  await expect(page.getByRole('heading', { name: 'بخش‌های پرکاربرد شما' })).toBeVisible();
  await expect(page.locator('.workspace-home-link')).toHaveCount(4);
  await expect(page.locator('.workspace-home-link').filter({ hasText: 'شبکه تأمین‌کنندگان' })).toBeVisible();
  await expect(page.locator('.workspace-home-link').filter({ hasText: 'دسترسی کاربران' })).toBeVisible();
  await expect(page.locator('.workspace-home-link').filter({ hasText: 'مرکز ارتباطات' })).toBeVisible();
  await expect(page.locator('.workspace-home-link').filter({ hasText: 'حمل‌ونقل و رانندگان' })).toBeVisible();
  await expect(page.locator('.nav-groups').getByRole('link', { name: /وظایف/ })).toBeVisible();
  await expect(page.locator('.workspace-home-section').filter({ hasText: 'موارد مهم و اقدام بعدی' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('manager-role-home-viewport.png') });
  await page.screenshot({ path: testInfo.outputPath('manager-role-home.png'), fullPage: true });

  const paths = [
    ['farm-sites', 'سایت‌های مزرعه'],
    ['flock-cycles', 'چرخه‌های کشت و پرورش'],
    ['production-batches', 'بچ‌های تولید'],
    ['daily-production', 'ثبت روزانه عملیات'],
    ['operational-tasks', 'وظایف عملیاتی'],
    ['incidents', 'رخدادها و مغایرت‌ها'],
  ];
  for (const [path, title] of paths) {
    await page.goto('/simorgh/app/' + path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    const homeLink = page.getByRole('link', { name: 'بازگشت به صفحه اصلی' });
    if (viewportWidth > 720) {
      await expect(homeLink).toBeVisible();
      await expect(homeLink).toHaveAttribute('href', /home$/);
      await homeLink.click();
    } else {
      await expect(homeLink).toBeHidden();
      await page.goto('/simorgh/app/home', { waitUntil: 'domcontentloaded' });
    }
    await expect(page).toHaveURL(/home$/);
    await expect(page.getByRole('heading', { name: /سلام مالک آزمایشی مدار/ })).toBeVisible();
  }
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('manager map shows every saved farm coordinate and allows marker selection', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  let sites = [
    { id: '00000000-0000-4000-8000-000000000101', name: 'مزرعه تهران', site_type: 'crop', city: 'تهران', province: 'تهران', latitude: 35.6892, longitude: 51.3890, license_expires_on: null, active: true },
    { id: '00000000-0000-4000-8000-000000000102', name: 'واحد کرمان', site_type: 'livestock', city: 'کرمان', province: 'کرمان', latitude: 30.2839, longitude: 57.0834, license_expires_on: null, active: true },
  ];
  await page.route('**/api/data/farm_sites', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify({ data: sites, count: sites.length, error: null }) });
  });

  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  const map = page.locator('.farm-map-panel');
  await expect(map.getByRole('heading', { name: 'نقشه‌ی عملیات و سایت‌ها' })).toBeVisible();
  await expect(map.locator('.iran-paper-illustration')).toHaveCount(0);
  await expect(map.locator('.farm-map-canvas iframe')).toBeVisible();
  await expect(map.locator('.farm-map-marker')).toHaveCount(2);
  await expect(map.locator('.farm-map-sites .farm-map-site')).toHaveCount(2);
  await expect(map.locator('.farm-map-marker.active .farm-map-marker-label')).toHaveText('مزرعه تهران');

  const markerPositions = await map.locator('.farm-map-marker').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }));
  expect(markerPositions[0].width).toBeGreaterThan(0);
  expect(markerPositions[1].width).toBeGreaterThan(0);
  expect(Math.abs(markerPositions[0].left - markerPositions[1].left)).toBeGreaterThan(10);
  expect(Math.abs(markerPositions[0].top - markerPositions[1].top)).toBeGreaterThan(10);
  const embedUrl = await map.locator('.farm-map-canvas iframe').getAttribute('src');
  expect(embedUrl).toContain('bbox=');
  expect(embedUrl).not.toContain('marker=');

  await map.getByRole('button', { name: 'انتخاب واحد کرمان' }).click();
  await expect(map.locator('.farm-map-marker.active .farm-map-marker-label')).toHaveText('واحد کرمان');
  await expect(map.locator('.farm-map-site.active b')).toHaveText('واحد کرمان');

  sites = [];
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(map.locator('.iran-paper-illustration')).toHaveCount(0);
  await expect(map.locator('.farm-map-sites-empty')).toHaveCount(0);
  await expect(map.locator('.empty-state')).toBeVisible();
});


test('operations map shows fresh driver GPS without inventing coordinates and hides stale points', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  const shipmentId = '00000000-0000-4000-8000-000000000211';
  const driverId = '00000000-0000-4000-8000-000000000212';
  let ageMs = 0;
  const shipment = {
    id: shipmentId,
    company_id: companyId,
    driver_user_id: driverId,
    stage: 'in_transit',
    vehicle: 'خاور GPS',
    planned_departure: new Date().toISOString(),
    order_id: '00000000-0000-4000-8000-000000000213',
  };
  await page.route('**/api/data/farm_sites', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], count: 0, error: null }) });
  });
  await page.route('**/api/data/shipments', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [shipment], count: 1, error: null }) });
  });
  await page.route('**/api/data/shipment_locations', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{
          id: '00000000-0000-4000-8000-000000000214',
          company_id: companyId,
          shipment_id: shipmentId,
          driver_user_id: driverId,
          latitude: 35.6892,
          longitude: 51.3890,
          accuracy_m: 12,
          captured_at: new Date(Date.now() - ageMs).toISOString(),
        }],
        count: 1,
        error: null,
      }),
    });
  });

  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  const map = page.locator('.farm-map-panel');
  await expect(map.getByRole('heading', { name: 'نقشه‌ی عملیات و سایت‌ها' })).toBeVisible();
  await expect(map.locator('.farm-map-driver-marker')).toHaveCount(1);
  await expect(map.getByRole('button', { name: /مأموریت خاور GPS/ })).toBeVisible();
  await expect(map.locator('.farm-map-fleet-list')).toContainText('خاور GPS');
  await expect(map.locator('.farm-map-canvas iframe')).toBeVisible();
  await expect(map.locator('.farm-map-canvas iframe')).toHaveAttribute('src', /bbox=/);
  await expect(map.locator('.farm-map-driver-marker')).toHaveCount(1);

  ageMs = 10 * 60 * 1000;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(map.locator('.farm-map-driver-marker')).toHaveCount(0);
  await expect(map.locator('.farm-map-fleet-list')).toContainText('آخرین نقطه قدیمی است');

  ageMs = -10 * 60 * 1000;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(map.locator('.farm-map-driver-marker')).toHaveCount(0);
  await expect(map.locator('.farm-map-fleet-list')).toContainText('زمان ثبت موقعیت نامعتبر است');
});

test('generic farm types and daily rejected quantities are validated before writes', async ({ page }) => {
  await installIsolatedSession(page, 'owner');

  await page.goto('/simorgh/app/products', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/simorgh/app/home');
  await expect(page.getByRole('heading', { name: 'کاتالوگ و مشخصات محصول' })).toHaveCount(0);

  await page.goto('/simorgh/app/farm-sites', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'سایت‌های مزرعه' })).toBeVisible();
  await page.getByRole('button', { name: 'ثبت رکورد', exact: true }).click();
  const siteType = page.locator('#ops-site_type');
  for (const kind of ['crop','livestock','poultry','dairy','aquaculture','greenhouse','orchard','apiary','processing','warehouse','distribution','mixed','other']) {
    await expect(siteType.locator('option[value="' + kind + '"]')).toHaveCount(1);
  }
  await expect(page.locator('#ops-latitude')).toHaveCount(0);
  await expect(page.locator('#ops-longitude')).toHaveCount(0);
  await expect(page.locator('#ops-province')).toBeVisible();
  await expect(page.locator('#ops-city')).toBeVisible();
  await expect(page.locator('#ops-address')).toBeVisible();
  await page.locator('.ops-modal').getByRole('button', { name: 'بستن' }).click();

  await page.goto('/simorgh/app/flock-cycles', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'چرخه‌های کشت و پرورش' })).toBeVisible();
  await page.getByRole('button', { name: 'ثبت رکورد', exact: true }).click();
  const cycleType = page.locator('#ops-cycle_type');
  await expect(cycleType).toHaveValue('mixed');
  for (const kind of ['crop','livestock','poultry','dairy','aquaculture','greenhouse','orchard','apiary','mixed','other']) {
    await expect(cycleType.locator('option[value="' + kind + '"]')).toHaveCount(1);
  }
  await page.locator('.ops-modal').getByRole('button', { name: 'بستن' }).click();

  await page.goto('/simorgh/app/production-batches', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'ثبت رکورد', exact: true }).click();
  const productionKind = page.locator('#ops-production_kind');
  for (const kind of ['farm_product','crop','livestock','poultry','dairy','eggs','meat','aquaculture','honey','forestry','greenhouse','orchard','input','feed','equipment','processed','service','other']) {
    await expect(productionKind.locator('option[value="' + kind + '"]')).toHaveCount(1);
  }
  await page.locator('.ops-modal').getByRole('button', { name: 'بستن' }).click();

  await page.route('**/api/data/production_batches', async route => {
    await route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ data: [{
        id: '00000000-0000-4000-8000-000000000066', company_id: companyId,
        batch_code: 'TEST-BATCH', status: 'planned', production_kind: 'crop', unit: 'کیلوگرم',
        farm_site_id: null, supplier_id: null, planned_quantity: 10, produced_quantity: 0,
        rejected_quantity: 0, quality_status: 'not_inspected',
      }], count: 1, error: null }),
    });
  });

  await page.goto('/simorgh/app/daily-production', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'ثبت رکورد', exact: true }).click();
  await expect(page.locator('#ops-rejected_quantity')).toBeVisible();
  await page.locator('#ops-batch_id').selectOption('00000000-0000-4000-8000-000000000066');
  await page.locator('#ops-produced_quantity').fill('10');
  await page.locator('#ops-rejected_quantity').fill('11');
  await page.locator('.ops-modal form').getByRole('button', { name: 'ثبت رکورد' }).click();
  await expect(page.getByText('مقدار مردودی باید صفر باشد یا از مقدار خروجی ثبت‌شده بیشتر نباشد.')).toBeVisible();
  await expect(page.locator('.ops-modal')).toBeVisible();
});

test('private supplier login establishes a session and role-scoped workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const user = { id: '00000000-0000-4000-8000-000000000011', username: 'supplier_ci_login', phone: '+989120000011', full_name: 'تأمین‌کننده آزمایشی' };
  const membership = {
    id: '00000000-0000-4000-8000-000000000044',
    company_id: companyId,
    user_id: user.id,
    role: 'supplier',
    customer_id: null,
    supplier_id: '00000000-0000-4000-8000-000000000033',
    active: true,
    company: { name: 'شرکت آزمایشی مدار' },
  };
  let signedIn = false;
  let loginPayload: Record<string, unknown> | null = null;
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user: signedIn ? user : null, memberships: signedIn ? [membership] : [] }),
  }));
  await page.route('**/api/auth/login', async route => {
    loginPayload = route.request().postDataJSON() as Record<string, unknown>;
    signedIn = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user, memberships: [membership] }) });
  });
  await page.route('**/api/workspace/my-module-permissions**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ companyId, permissions: { 'operational-tasks': true, capacity: true, 'partner-settlements': true, 'farm-sites': true, 'flock-cycles': true, 'production-batches': true, 'daily-production': true } }),
  }));
  await page.route('**/api/workspace/memberships', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ memberships: [membership] }),
  }));
  await page.route('**/api/push/config**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, publicKey: null }),
  }));
  await page.route('**/api/client/heartbeat', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }),
  }));
  await page.route('**/api/notifications**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ notifications: [], summary: { total: 0, unread: 0 }, ok: true, updated: 0 }),
  }));
  await page.route('**/api/data/**', async route => {
    const table = new URL(route.request().url()).pathname.split('/').pop() || '';
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify({ data: [], count: 0, error: null, table }) });
  });

  await page.goto('/simorgh/app/home', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'ورود به مدار' })).toBeVisible();
  await page.getByLabel('نام کاربری').fill('supplier_ci_login');
  await page.getByRole('textbox', { name: 'گذرواژه' }).fill('CI-supplier-login-password!');
  await page.getByRole('button', { name: 'ورود به فضای کار' }).click();
  await expect(page.locator('.app-frame')).toBeVisible();
  await expect(page.locator('.workspace-home')).toBeVisible();
  await expect(page.locator('.nav-groups').getByRole('link', { name: /کارهای واگذارشده/ })).toBeVisible();
  await expect(page.locator('.nav-groups').getByRole('link', { name: /دسترسی کاربران/ })).toHaveCount(0);
  expect(loginPayload).toMatchObject({ username: 'supplier_ci_login', password: 'CI-supplier-login-password!' });
});

test('accounts without a workspace cannot self-join; the owner provisions access', async ({ page }) => {
  await installIsolatedSession(page, 'unprovisioned');
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.waiting-screen')).toBeVisible();
  await expect(page.getByText(/برای دریافت دسترسی/)).toBeVisible();
  await expect(page.getByLabel('کد دعوت')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /پیوستن به مجموعه/ })).toHaveCount(0);
});

test('owner can create a supplier login and copy the one-time credentials', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  const supplierId = '00000000-0000-4000-8000-000000000033';
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/workspace/members?*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ members: [] }),
  }));
  await page.route('**/api/data/**', async route => {
    const table = new URL(route.request().url()).pathname.split('/').pop() || '';
    const data = table === 'suppliers' ? [{ id: supplierId, name: 'تأمین‌کننده محلی آزمایشی' }] : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, count: data.length, error: null, table }) });
  });
  await page.route('**/api/workspace/members/create', async route => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    expect(submitted).toMatchObject({
      companyId,
      fullName: 'تأمین‌کننده محلی',
      username: 'supplier_local',
      password: 'Local-Supplier-2026!',
      role: 'supplier',
      supplierId,
    });
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ member: { membership_id: '00000000-0000-4000-8000-000000000078', username: 'supplier_local', role: 'supplier', supplier_id: supplierId } }) });
  });
  await page.goto('/simorgh/app/members', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /تأمین‌کنندگان/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /رانندگان/ })).toBeVisible();
  await page.getByRole('button', { name: 'ساخت حساب' }).click();
  await page.getByLabel('نام و نام خانوادگی').fill('تأمین‌کننده محلی');
  await page.getByLabel('نام کاربری').fill('supplier_local');
  await page.getByLabel('رمز عبور اولیه').fill('Local-Supplier-2026!');
  await page.getByLabel('پرونده تأمین‌کننده (اختیاری)').selectOption(supplierId);
  await page.getByRole('button', { name: 'ساخت حساب و نمایش اطلاعات ورود' }).click();
  await expect(page.locator('.invite-code-panel')).toContainText('@supplier_local : Local-Supplier-2026!');
  await expect(page.getByRole('button', { name: 'کپی اطلاعات' })).toBeVisible();
  expect(submitted?.role).toBe('supplier');
});

test('member username field does not use an invalid HTML regex pattern', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.route('**/api/workspace/members?*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ members: [] }),
  }));
  await page.route('**/api/data/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], count: 0, error: null }),
  }));
  await page.goto('/simorgh/app/members', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /ساخت حساب جدید/ }).click();
  const username = page.getByLabel('نام کاربری');
  await expect(username).toBeVisible();
  expect(await username.getAttribute('pattern')).toBeNull();
  await username.fill('کاربر_تأمین');
  expect(await username.evaluate(element => (element as HTMLInputElement).checkValidity())).toBe(true);
  await page.getByLabel('رمز عبور اولیه').fill('CI-Form-Validation-Password-2026!');
  await expect(page.getByRole('button', { name: 'ساخت حساب و نمایش اطلاعات ورود' })).toBeEnabled();
});

test('owner can provision a supplier without a pre-existing supplier record', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.route('**/api/workspace/members?*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ members: [] }),
  }));
  await page.route('**/api/data/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], count: 0, error: null }),
  }));
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/workspace/members/create', async route => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    expect(submitted).toMatchObject({
      companyId, username: 'new_supplier_without_record', role: 'supplier',
      supplierId: null,
    });
    await route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({ member: {
        id: '00000000-0000-4000-8000-000000000081',
        username: 'new_supplier_without_record',
        full_name: 'new_supplier_without_record',
        membership_id: '00000000-0000-4000-8000-000000000082',
        company_id: companyId, role: 'supplier',
        supplier_id: '00000000-0000-4000-8000-000000000083',
      } }),
    });
  });
  await page.goto('/simorgh/app/members', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /ساخت حساب جدید/ }).click();
  await page.getByLabel('نام کاربری').fill('new_supplier_without_record');
  await page.getByLabel('رمز عبور اولیه').fill('Safe-New-Supplier-Password-2026!');
  await page.getByLabel('نقش کاربر').selectOption('supplier');
  await expect(page.getByLabel('پرونده تأمین‌کننده (اختیاری)')).toHaveValue('');
  await page.getByRole('button', { name: 'ساخت حساب و نمایش اطلاعات ورود' }).click();
  await expect(page.getByText(/حساب ساخته شد/)).toBeVisible();
  expect(submitted).not.toBeNull();
});

test('contextual help stays compact at the bottom-left and can be dismissed', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/members', { waitUntil: 'domcontentloaded' });
  const guide = page.locator('.medar-help-backdrop');
  await expect(guide).toHaveCount(0);
  await page.getByRole('button', { name: 'راهنمای این بخش' }).click();
  await expect(guide).toBeVisible();
  const bounds = await guide.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeLessThanOrEqual(16);
  expect(bounds!.width).toBeLessThanOrEqual(230);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);
  await guide.getByRole('button', { name: 'راهنمای کامل' }).click();
  const expandedStepCount = await guide.locator('.medar-help-steps li:visible').count();
  expect(expandedStepCount).toBeGreaterThan(2);
  await guide.getByRole('button', { name: 'کمتر' }).click();
  await guide.getByRole('button', { name: 'بستن راهنما' }).click();
  await expect(guide).toHaveCount(0);
});

test('contextual help expands on mobile without escaping the viewport and can close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/members', { waitUntil: 'domcontentloaded' });
  const guide = page.locator('.medar-help-backdrop');
  await expect(guide).toHaveCount(0);
  await page.getByRole('button', { name: 'راهنمای این بخش' }).click();
  await expect(guide).toBeVisible();
  const compact = await guide.boundingBox();
  expect(compact).not.toBeNull();
  expect(compact!.x).toBeLessThanOrEqual(10);
  expect(compact!.width).toBeLessThanOrEqual(205);
  expect(compact!.y + compact!.height).toBeLessThan(844 - 60);
  await guide.getByRole('button', { name: 'راهنمای کامل' }).click();
  await expect(guide.locator('.medar-help-steps li:visible')).toHaveCount(5);
  const expanded = await guide.locator('.medar-help-dialog').boundingBox();
  expect(expanded).not.toBeNull();
  expect(expanded!.x).toBeGreaterThanOrEqual(0);
  expect(expanded!.x + expanded!.width).toBeLessThanOrEqual(390);
  expect(expanded!.y).toBeGreaterThanOrEqual(0);
  await guide.getByRole('button', { name: 'بستن راهنما' }).click();
  await expect(guide).toHaveCount(0);
});

test('dedicated member account creation submits once and remains successful when related lists are unavailable', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.route('**/api/workspace/members?*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ members: [] }),
  }));
  await page.route('**/api/data/**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], count: 0, error: null }),
  }));
  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/workspace/members/create', async route => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({ member: {
        id: '00000000-0000-4000-8000-000000000066',
        username: 'staff_regression_203', full_name: 'عضو آزمایشی',
        membership_id: '00000000-0000-4000-8000-000000000067',
        company_id: companyId, role: 'staff',
      } }),
    });
  });
  await page.goto('/simorgh/app/members', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /ساخت حساب جدید/ }).click();
  await page.getByLabel(/نام کاربری/).fill('Staff_Regression_203');
  await page.getByLabel(/رمز عبور اولیه/).fill('Safe-Test-Password-203!');
  await page.getByLabel('نقش کاربر').selectOption('staff');
  await page.getByRole('button', { name: 'ساخت حساب و نمایش اطلاعات ورود' }).click();
  await expect(page.getByText(/حساب ساخته شد/)).toBeVisible();
  expect(submitted).toMatchObject({
    companyId,
    username: 'staff_regression_203',
    password: 'Safe-Test-Password-203!',
    role: 'staff',
  });
  await expect(page.locator('.invite-code-value')).toContainText('staff_regression_203');
});

test('owner access panel uses direct account creation without invitation codes', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.route('**/api/workspace/members?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ members: [] }) }));
  await page.goto('/simorgh/app/members', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /ساخت حساب جدید/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'کد دعوت' })).toHaveCount(0);
  await expect(page.locator('.invite-code-panel')).toHaveCount(0);
});

test('installed PWA opens the private workspace and updates route-aware offline shell cache', async ({ page }) => {
  const manifestResponse = await page.request.get('/simorgh/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json() as { start_url?: string; scope?: string; display?: string; lang?: string; dir?: string };
  expect(manifest.start_url).toBe('./app/home');
  expect(manifest.scope).toBe('./');
  expect(manifest.display).toBe('standalone');
  expect(manifest.lang).toBe('fa');
  expect(manifest.dir).toBe('rtl');

  const workerResponse = await page.request.get('/simorgh/sw.js');
  expect(workerResponse.ok()).toBe(true);
  const workerSource = await workerResponse.text();
  expect(workerSource).toMatch(/const CACHE_NAME = 'medar-shell-v\d+';/);
  expect(workerSource).toContain('cache.put(navigationKey, response.clone())');
  expect(workerSource).toContain('cache.match(navigationKey)');
  expect(workerSource).toContain("if (!isLocal(url) || isSensitiveAPI(url)) return");
});

test('desktop sidebar groups and module links use compact spacing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/home', { waitUntil: 'domcontentloaded' });
  const groups = page.locator('.app-sidebar .nav-groups');
  await expect(groups).toBeVisible();
  const gap = await groups.evaluate(element => Number.parseFloat(getComputedStyle(element).rowGap));
  expect(gap).toBeLessThanOrEqual(2);
  const summary = page.locator('.app-sidebar .nav-group > summary').first();
  await expect(summary).toBeVisible();
  const summaryHeight = await summary.evaluate(element => element.getBoundingClientRect().height);
  expect(summaryHeight).toBeLessThanOrEqual(31);
  const link = page.locator('.app-sidebar .side-nav a').first();
  const linkHeight = await link.evaluate(element => element.getBoundingClientRect().height);
  expect(linkHeight).toBeLessThanOrEqual(30);
  const groupBoxes = await groups.locator(':scope > .nav-group').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height, open: (element as HTMLDetailsElement).open };
  }));
  expect(groupBoxes.length).toBeGreaterThanOrEqual(2);
  for (const box of groupBoxes.filter(box => !box.open)) expect(box.height).toBeLessThanOrEqual(42);
  for (let i = 1; i < groupBoxes.length; i++) {
    expect(groupBoxes[i].top - groupBoxes[i - 1].bottom).toBeLessThanOrEqual(4);
  }
});

test('mobile workspace drawer groups stay compact and do not stretch to fill the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/home', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'بازکردن منو' }).click();
  const sidebar = page.locator('.app-sidebar');
  await expect(sidebar).toHaveClass(/open/);
  const groups = sidebar.locator('.nav-tools-box .nav-groups');
  await expect(groups).toBeVisible();
  const layout = await groups.evaluate(element => {
    const style = getComputedStyle(element);
    const boxes = Array.from(element.querySelectorAll(':scope > .nav-group')).map(node => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height, open: (node as HTMLDetailsElement).open };
    });
    return { display: style.display, direction: style.flexDirection, gap: Number.parseFloat(style.rowGap), boxes, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight };
  });
  expect(layout.display).toBe('flex');
  expect(layout.direction).toBe('column');
  expect(layout.gap).toBeLessThanOrEqual(5);
  expect(layout.boxes.length).toBeGreaterThanOrEqual(2);
  for (const box of layout.boxes.filter(box => !box.open)) expect(box.height).toBeLessThanOrEqual(55);
  for (let i = 1; i < layout.boxes.length; i++) {
    expect(layout.boxes[i].top - layout.boxes[i - 1].bottom).toBeLessThanOrEqual(7);
  }
  await page.getByRole('button', { name: 'بستن پنل' }).click();
  await expect(sidebar).not.toHaveClass(/open/);
});

test('settings exposes installation instructions when native install prompt is unavailable', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/settings', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'نصب مدار روی دستگاه' })).toBeVisible();
  await page.getByRole('button', { name: 'راهنمای نصب مدار' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'افزودن مدار به صفحهٔ اصلی' })).toBeVisible();
  await expect(page.getByText(/iPhone و iPad/)).toBeVisible();
  await expect(page.getByText(/اندروید و رایانه/)).toBeVisible();
});

test('supplier directory remains readable from cache when offline', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  let apiReachable = true;
  await page.route('**/api/data/**', async route => {
    if (!apiReachable) { await route.abort('failed'); return; }
    const table = new URL(route.request().url()).pathname.split('/').pop() || '';
    const data = table === 'suppliers' ? [{ id: '00000000-0000-4000-8000-000000000088', name: 'تأمین‌کننده آفلاین', city: 'ساری', province: 'مازندران', active: true, phone: '09120000000' }] : [];
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify({ data, count: data.length, error: null, table }) });
  });
  await page.goto('/simorgh/app/suppliers', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('تأمین‌کننده آفلاین')).toBeVisible();
  apiReachable = false;
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('.offline-notice')).toBeVisible();
  await page.evaluate(() => {
    window.history.pushState({}, '', '/simorgh/app/home');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  });
  await expect(page).toHaveURL(/home$/);
  await page.evaluate(() => {
    window.history.pushState({}, '', '/simorgh/app/suppliers');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  });
  await expect(page.getByText('تأمین‌کننده آفلاین')).toBeVisible();
  await page.context().setOffline(false);
  apiReachable = true;
});

test('supplier workspace keeps manager-only routes out of the allowed menu', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  await installIsolatedSession(page, 'supplier');
  await page.goto('/simorgh/app', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/home$/);
  if (viewportWidth <= 860) {
    await page.getByRole('button', { name: 'بازکردن منو' }).click();
    await expect(page.locator('.app-sidebar')).toHaveClass(/open/);
  }
  await expect(page.getByRole('heading', { name: /سلام تأمین‌کننده آزمایشی مدار/ })).toBeVisible();
  await expect(page.locator('.workspace-home-hero')).toContainText('برنامه‌ی امروز تأمین‌کننده');
  await expect(page.locator('.workspace-home-link')).toHaveCount(4);
  expect(await page.locator('.workspace-home-action').count()).toBeLessThanOrEqual(5);
  await page.screenshot({ path: testInfo.outputPath('supplier-role-home-viewport.png') });
  await page.screenshot({ path: testInfo.outputPath('supplier-role-home.png'), fullPage: true });
  const operationsGroup = page.locator('.nav-group').filter({ has: page.locator('summary', { hasText: /^عملیات روزانه/ }) });
  const operationsGroupIsOpen = await operationsGroup.evaluate(element => (element as HTMLDetailsElement).open);
  if (!operationsGroupIsOpen) await operationsGroup.locator('summary').click();
  await expect(operationsGroup.getByRole('link', { name: /کارهای واگذارشده/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /دستورالعمل‌های کاری/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /دسترسی کاربران/ })).toHaveCount(0);
  await expect(page.locator('.nav-group').filter({ has: page.locator('summary', { hasText: /^مالی/ }) })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /تسویه‌های من/ })).toHaveCount(0);
  await operationsGroup.getByRole('link', { name: /کارهای واگذارشده/ }).click();
  await expect(page.getByRole('heading', { name: 'سفارش‌های واگذارشده' })).toBeVisible();
  await expect(page.locator('.entity-panel')).toBeVisible();
  await expect(page.locator('.role-ops, .role-ops-metrics, .role-ops-shortcuts')).toHaveCount(0);
  expect(await page.locator('.nav-group').count()).toBeLessThanOrEqual(8);
  expect(errors).toEqual([]);
});

test('manager bottom navigation stays manager-specific on mobile and tablet', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /مرکز فرمان شبکه/ })).toBeVisible();
  await expect(page.locator('.tower-quick-access a').filter({ hasText: 'شبکه تأمین‌کنندگان' })).toBeVisible();
  await expect(page.locator('.tower-quick-access a').filter({ hasText: 'دسترسی کاربران' })).toBeVisible();
  await expect(page.locator('.tower-quick-access a').filter({ hasText: 'مرکز ارتباطات' })).toBeVisible();
  await expect(page.locator('.tower-quick-access a').filter({ hasText: 'مالی و تسویه' })).toHaveCount(0);
  await expect(page.locator('.tower-stats')).not.toContainText('مشتریان');
  await expect(page.locator('.topbar-home-link')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'خروج از حساب' })).toHaveCount(0);
  const mobileNav = page.locator('.mobile-workspace-nav:visible');
  if (viewportWidth <= 720) await expect(page.locator('.topbar-home-link')).toBeHidden();
  if (viewportWidth <= 860) {
    await expect(mobileNav).toBeVisible();
    for (const label of ['نمای کلی', 'مرکز ارتباطات', 'ارسال‌ها']) {
      await expect(mobileNav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(mobileNav.getByRole('button', { name: 'بازکردن فهرست ماژول‌ها' })).toBeVisible();
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

  const mobileNav = page.locator('.mobile-workspace-nav:visible');
  if (viewportWidth <= 860) {
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'وظایف' })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'ثبت تولید' })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'مرکز ارتباطات' })).toBeVisible();
    await expect(mobileNav.getByRole('button', { name: 'بازکردن فهرست ماژول‌ها' })).toBeVisible();
    await expect(mobileNav.locator('a,button')).toHaveCount(4);
    await expect(mobileNav.getByRole('link', { name: 'دفتر شریک' })).toHaveCount(0);
    await expect(mobileNav.getByRole('link', { name: /دسترسی کاربران/ })).toHaveCount(0);
  } else {
    await expect(mobileNav).toBeHidden();
  }
});

 
test('legacy customer role has no ordering or customer navigation in the supply-chain release', async ({ page }) => {
  await installIsolatedSession(page, 'customer');
  await page.goto('/simorgh/app', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/home$/);
  await expect(page.locator('.workspace-home-hero')).toContainText('دسترسی محدود');
  await expect(page.getByText('دسترسی سفارش‌گیری غیرفعال است')).toBeVisible();
  await expect(page.locator('.side-nav a').filter({ hasText: 'خرید سازمانی' })).toHaveCount(0);
  await expect(page.locator('.side-nav a').filter({ hasText: 'سفارش‌های من' })).toHaveCount(0);
});

test('driver lands in assigned shipments and does not get customer or manager navigation', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installIsolatedSession(page, 'driver');
  await page.goto('/simorgh/app', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/home$/);
  await expect(page.getByRole('heading', { name: /سلام راننده آزمایشی مدار/ })).toBeVisible();
  await expect(page.locator('.workspace-home-hero')).toContainText('برنامه‌ی امروز راننده');
  await expect(page.locator('.workspace-home-link').filter({ hasText: 'محموله‌های من' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('driver-role-home-viewport.png') });
  await page.locator('.workspace-home-link').filter({ hasText: 'محموله‌های من' }).click();
  await expect(page.getByRole('heading', { name: 'محموله‌های من' })).toBeVisible();
  await expect(page.locator('#driver-shipments')).toBeVisible();
  await expect(page.locator('.role-ops, .role-ops-metrics, .role-ops-shortcuts')).toHaveCount(0);
  if (viewportWidth <= 860) {
    const nav = page.locator('.mobile-workspace-nav:visible');
    await expect(nav).toBeVisible();
    for (const label of ['محموله‌ها', 'نقشه', 'مدرک']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('button', { name: 'بازکردن فهرست ماژول‌ها' })).toBeVisible();
    await expect(nav.locator('a,button')).toHaveCount(4);
    await expect(nav.getByRole('link', { name: 'خرید', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'وظایف', exact: true })).toHaveCount(0);
  } else {
    await expect(page.locator('.mobile-workspace-nav:visible')).toBeHidden();
  }
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('AI assistant is hidden while the core operations release is simplified', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/home', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'بازکردن دستیار هوش مصنوعی' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'پیام به دستیار' })).toHaveCount(0);
});

test('AI attachment controls are hidden in the core operations release', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/home', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'بازکردن دستیار هوش مصنوعی' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'پیام به دستیار' })).toHaveCount(0);
});

test('AI voice controls are hidden in the core operations release', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/home', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'بازکردن دستیار هوش مصنوعی' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'پیام به دستیار' })).toHaveCount(0);
});

test('contact import is hidden from the core supply-chain release', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/contacts-import', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/simorgh\/app\/home$/);
  await expect(page.locator('.side-nav a').filter({ hasText: 'دفترچه مخاطبین' })).toHaveCount(0);
  await expect(page.locator('.side-nav a').filter({ hasText: 'ورود فایل مخاطبین' })).toHaveCount(0);
});

test('a signed-in user can change their own password from Settings through the protected Worker endpoint', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Validate the credential-change request once; responsive settings layout is covered in every viewport.');
  await installIsolatedSession(page, 'owner');
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/auth/password/change', async route => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'گذرواژه تغییر کرد؛ نشست‌های دیگر بسته شدند.' }),
    });
  });

  await page.goto('/simorgh/app/settings', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'امنیت حساب' })).toBeVisible();
  await page.getByLabel('گذرواژه فعلی').fill('Old-pass-2026');
  await page.getByLabel('گذرواژه جدید').fill('New-pass-2026');
  await page.getByLabel('تکرار گذرواژه').fill('New-pass-2026');
  await page.getByRole('button', { name: 'ذخیره گذرواژه جدید' }).click();

  await expect(page.locator('.settings-security [role="status"]')).toContainText('گذرواژه تغییر کرد');
  expect(submitted).toEqual({ currentPassword: 'Old-pass-2026', newPassword: 'New-pass-2026' });
});


test('AI chat controls are hidden in the core operations release', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/home', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'بازکردن دستیار هوش مصنوعی' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'پیام به دستیار' })).toHaveCount(0);
});

test('AI agent center is removed from the normal operations workflow', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/agents', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/simorgh\/app\/home$/);
  await expect(page.locator('.side-nav a').filter({ hasText: 'مرکز ایجنت‌ها' })).toHaveCount(0);
});

test('owner can configure module access for a staff member and restore inherited role defaults', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  const memberId = '00000000-0000-4000-8000-000000000044';
  const staffUserId = '00000000-0000-4000-8000-000000000045';
  const modules = [
    'home','command','agents','contacts','customers','suppliers','orders','purchase-orders','products',
    'inventory','capacity','quality','shipments','finance','farm-sites','flock-cycles','production-batches',
    'daily-production','operational-tasks','task-templates','incidents','partnership-agreements','partner-finance',
    'partner-settlements','goals','members','audit',
  ].map(key => ({
    key,
    label: key === 'agents' ? 'دستیار و مرکز ایجنت‌ها' : key,
    configured: false,
    can_read: true, can_create: true, can_update: true, can_delete: false, can_approve: false,
  }));
  let saved: Array<Record<string, unknown>> | null = null;
  await page.route('**/api/workspace/members*', async route => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ members: [
        { membership_id: '00000000-0000-4000-8000-000000000046', company_id: companyId, user_id: '00000000-0000-4000-8000-000000000011', role: 'owner', active: true, username: 'owner_test', full_name: 'مالک آزمایشی مدار', phone: null, created_at: new Date().toISOString() },
        { membership_id: memberId, company_id: companyId, user_id: staffUserId, role: 'staff', active: true, username: 'staff_test', full_name: 'کارشناس آزمایشی مدار', phone: null, created_at: new Date().toISOString() },
      ] }),
    });
  });
  await page.route('**/api/workspace/members/*/permissions*', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modules }) });
      return;
    }
    const body = route.request().postDataJSON() as { companyId: string; modules: Array<Record<string, unknown>> };
    expect(body.companyId).toBe(companyId);
    saved = body.modules;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, configuredModules: saved.filter(m => m.configured === true).length }) });
  });
  await page.goto('/simorgh/app/members', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'دسترسی کاربران' })).toBeVisible();
  const staffRow = page.locator('.data-table tbody tr').filter({ hasText: '@staff_test' });
  await staffRow.getByRole('button', { name: 'مجوزها' }).click();
  const agentRead = page.getByRole('checkbox', { name: 'دستیار و مرکز ایجنت‌ها — مشاهده' });
  await expect(agentRead).toHaveCount(0);
  const capacityRead = page.getByRole('checkbox', { name: 'capacity — مشاهده' });
  await expect(capacityRead).toBeVisible();
  await expect(capacityRead).toBeChecked();
  await capacityRead.uncheck();
  await page.getByRole('button', { name: 'ذخیره مجوزها' }).click();
  await expect(page.getByText('مجوزهای ماژول ذخیره شدند؛ محدودیت‌ها در API سمت سرور اعمال می‌شوند.')).toBeVisible();
  expect(saved).not.toBeNull();
  const capacitySaved = saved!.find(module => module.key === 'capacity');
  expect(capacitySaved).toMatchObject({ configured: true, can_read: false });
  await staffRow.getByRole('button', { name: 'مجوزها' }).click();
  await page.getByRole('button', { name: 'بازگشت به پیش‌فرض نقش' }).click();
  await page.getByRole('button', { name: 'ذخیره مجوزها' }).click();
  await expect(page.getByText('مجوزهای ماژول ذخیره شدند؛ محدودیت‌ها در API سمت سرور اعمال می‌شوند.')).toBeVisible();
  expect(saved!.every(module => module.configured === false)).toBe(true);
});


test('implemented quality and partner settlement workflows are reachable for authorized owners', async ({ page }) => {
  await installIsolatedSession(page, 'owner');

  const routes = [
    { path: 'quality', label: 'کیفیت و محموله' },
    { path: 'partner-finance', label: 'دفتر مالی شریک' },
    { path: 'partner-settlements', label: 'دوره‌های تسویه' },
  ];
  for (const route of routes) {
    const expectedUrl = '/simorgh/app/' + route.path;
    await page.goto(expectedUrl, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(expectedUrl);
    await expect(page.locator('.side-nav a').filter({ hasText: route.label })).toHaveCount(1);
  }
});

test('supplier can open the implemented supplier settlement workflow', async ({ page }) => {
  await installIsolatedSession(page, 'supplier');
  const expectedUrl = '/simorgh/app/supplier-settlement';
  await page.goto(expectedUrl, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(expectedUrl);
  await expect(page.locator('.side-nav a').filter({ hasText: 'تسویه‌های من' })).toHaveCount(1);
});

test('finance module is deferred from the core supply-chain release', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/finance', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/simorgh\/app\/home$/);
  await expect(page.locator('.side-nav a').filter({ hasText: 'مالی و تسویه' })).toHaveCount(0);
});

test('role home loads the real notification inbox and acknowledges an unread briefing', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  const firstId = '00000000-0000-4000-8000-000000000401';
  const secondId = '00000000-0000-4000-8000-000000000402';
  const companyNotifications = [
    { id: firstId, title: 'خلاصهٔ روزانهٔ عملیات', body: '۲ وظیفهٔ باز · ۱ سفارش عقب‌افتاده', href: '/app/home', readAt: null, createdAt: new Date().toISOString() },
    { id: secondId, title: 'محمولهٔ فعال', body: 'یک محموله در مسیر است.', href: '/app/driver-work', readAt: new Date(Date.now()-86400000).toISOString(), createdAt: new Date(Date.now()-86400000).toISOString() },
  ];
  let markReadCalls = 0;
  await page.route('**/api/notifications**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notifications: companyNotifications, summary: { total: 2, unread: companyNotifications.filter(item => !item.readAt).length } }) });
      return;
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/read-all')) {
      const body = request.postDataJSON() as { companyId: string };
      expect(body.companyId).toBe(companyId);
      companyNotifications.forEach(item => { item.readAt ??= new Date().toISOString(); });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, updated: 1 }) });
      return;
    }
    const body = request.postDataJSON() as { companyId: string };
    expect(body.companyId).toBe(companyId);
    expect(url.pathname).toBe('/api/notifications/' + firstId + '/read');
    markReadCalls += 1;
    companyNotifications[0].readAt = new Date().toISOString();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, notification: { readAt: companyNotifications[0].readAt } }) });
  });
  await page.goto('/simorgh/app', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'اعلان‌های من' })).toBeVisible();
  await expect(page.getByText('خلاصهٔ روزانهٔ عملیات')).toBeVisible();
  await expect(page.getByText('محمولهٔ فعال')).toHaveCount(0);
  await page.getByRole('button', { name: /بایگانی خوانده‌شده‌ها/ }).click();
  await expect(page.getByText('محمولهٔ فعال')).toBeVisible();
  const markRead = page.getByRole('button', { name: 'خوانده‌شده: خلاصهٔ روزانهٔ عملیات' });
  await expect(markRead).toBeVisible();
  await markRead.click();
  await expect(page.locator('.notification-item.unread')).toHaveCount(0);
  await expect(markRead).toHaveCount(0);
  await expect(page.locator('.notification-unread-count')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'خواندن همه' })).toHaveCount(0);
  expect(markReadCalls).toBe(1);
});

test('Medar Connect creates a restricted conversation and sends an idempotent operational message', async ({ page }) => {
  const userId = '00000000-0000-4000-8000-000000000011';
  const otherUserId = '00000000-0000-4000-8000-000000000077';
  const firstConversationId = '00000000-0000-4000-8000-000000000088';
  const newConversationId = '00000000-0000-4000-8000-000000000099';
  await installIsolatedSession(page, 'owner');
  let conversations: Array<{ id: string; title: string; relatedEntityType: string | null; relatedEntityId: string | null; createdAt: string; updatedAt: string; lastReadAt: string | null; unreadCount: number; lastMessage: string | null }> = [{
    id: firstConversationId, title: 'هماهنگی ارسال', relatedEntityType: 'shipment',
    relatedEntityId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    lastReadAt: null, unreadCount: 1, lastMessage: 'بار آماده است',
  }];
  let messages = [{
    id: '00000000-0000-4000-8000-000000000111', senderUserId: otherUserId,
    senderUsername: 'driver_test', body: 'بار آماده است', createdAt: new Date().toISOString(), editedAt: null,
  }];
  await page.route('**/api/connect/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith('/people') && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ people: [{ id: otherUserId, username: 'driver_test', displayName: 'راننده آزمایشی', role: 'driver' }] }) });
      return;
    }
    if (path.endsWith('/conversations') && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations }) });
      return;
    }
    if (path.endsWith('/conversations') && request.method() === 'POST') {
      conversations = [...conversations, {
        id: newConversationId, title: 'تحویل سفارش ۱۲۴', relatedEntityType: null, relatedEntityId: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastReadAt: null,
        unreadCount: 0, lastMessage: null,
      }];
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation: { id: newConversationId } }) });
      return;
    }
    if (path.endsWith('/messages') && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: url.pathname.includes(newConversationId) ? messages.filter(item => item.senderUserId === userId) : messages }) });
      return;
    }
    if (path.endsWith('/messages') && request.method() === 'POST') {
      const body = request.postDataJSON() as { body: string };
      const message = { id: '00000000-0000-4000-8000-000000000122', senderUserId: userId, senderUsername: 'owner_test', body: body.body, createdAt: new Date().toISOString(), editedAt: null };
      messages = [...messages, message];
      conversations = conversations.map(item => item.id === newConversationId ? { ...item, lastMessage: body.body, updatedAt: new Date().toISOString() } : item);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, message }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Unexpected test route: ' + path }) });
  });

  await page.goto('/simorgh/app/connect', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'مرکز ارتباطات' })).toBeVisible();
  await expect(page.getByRole('button', { name: /هماهنگی ارسال/ })).toBeVisible();
  await expect(page.getByText('بار آماده است').first()).toBeVisible();
  await page.getByLabel('فرد یا شریک کاری').selectOption(otherUserId);
  await page.getByLabel('عنوان (اختیاری)').fill('تحویل سفارش ۱۲۴');
  await page.getByRole('button', { name: 'ایجاد گفت‌وگو' }).click();
  await expect(page.getByRole('heading', { name: 'تحویل سفارش ۱۲۴' })).toBeVisible();
  await page.getByRole('textbox', { name: 'متن پیام' }).fill('لطفاً رسید تحویل را ثبت کن.');
  await page.getByRole('button', { name: 'ارسال پیام' }).click();
  await expect(page.getByText('لطفاً رسید تحویل را ثبت کن.').first()).toBeVisible();
});


test('exception inbox is disabled in the simplified supply-chain release', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/exceptions', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/simorgh\/app\/home$/);
  await expect(page.getByRole('heading', { name: 'صندوق مسائل و استثناها' })).toHaveCount(0);
});

test('settings centralizes password, real connection health, and light/dark preferences', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.route('**/api/health', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, database: true, service: 'medar-ops' }),
  }));
  await page.route('**/api/admin/system/clients**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ clients: [{ clientId: 'web-test', platform: 'web', appVersion: 'test', username: 'owner_test', role: 'owner', firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), online: true }], summary: { knownClients: 1, onlineClients: 1 } }),
  }));
  await page.route('**/api/auth/password/change', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, message: 'گذرواژه آزمایشی با موفقیت تغییر کرد.' }),
  }));

  await page.goto('/simorgh/app/settings', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'تنظیمات مدار' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'اتصال مدار' })).toBeVisible();
  await expect(page.getByText('پاسخ‌گو')).toBeVisible();
  await expect(page.getByRole('button', { name: 'خروج از حساب' })).toBeVisible();
  await expect(page.getByText('دستگاه‌های شناخته‌شده')).toBeVisible();
  await expect(page.locator('.nav-tools-box')).toContainText('منوی اصلی');
  await expect(page.locator('.sidebar-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'تغییر گذرواژه' })).toHaveCount(0);

  await page.getByRole('button', { name: /حالت تاریک/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /حالت روشن/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByLabel('گذرواژه فعلی').fill('old-password');
  await page.getByLabel('گذرواژه جدید').fill('new-password-123');
  await page.getByLabel('تکرار گذرواژه').fill('new-password-123');
  await page.getByRole('button', { name: 'ذخیره گذرواژه جدید' }).click();
  await expect(page.locator('.settings-security [role="status"]')).toContainText('گذرواژه آزمایشی با موفقیت تغییر کرد.');

  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.dashboard-connect-disclosure')).toHaveCount(0);
  await expect(page.locator('.sidebar-settings-link, .profile-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'خروج از حساب' })).toHaveCount(0);
});

test('closing contextual help persists across navigation until explicitly reopened', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/members', { waitUntil: 'domcontentloaded' });

  const guide = page.locator('.medar-help-backdrop');
  await expect(guide).toHaveCount(0);
  await page.getByRole('button', { name: 'راهنمای این بخش' }).click();
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: 'بستن راهنما' }).click();
  await expect(guide).toHaveCount(0);

  if (viewportWidth <= 860) {
    const mobileHome = page.locator('.mobile-workspace-nav:visible a').first();
    await expect(mobileHome).toBeVisible();
    await mobileHome.click();
  } else {
    await page.locator('.topbar-home-link').click();
  }
  await expect(page).not.toHaveURL(/\/simorgh\/app\/members$/);
  await expect(guide).toHaveCount(0);

  const helpButton = page.getByRole('button', { name: 'راهنمای مدار' });
  if (await helpButton.isVisible()) {
    await helpButton.click();
    await expect(guide).toBeVisible();
    await guide.getByRole('button', { name: 'بستن راهنما' }).click();
    await expect(guide).toHaveCount(0);
  }
});

test('authenticated workspace remains usable without horizontal overflow across common breakpoints', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/home', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-frame')).toBeVisible();

  for (const width of [320, 360, 375, 390, 414, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document, `workspace document overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.body, `workspace body overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
  }
});

test('reduced-motion preference is respected by the interface', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/home', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.app-frame')).toBeVisible();

  const transitionDuration = await page.locator('.app-sidebar a').first().evaluate(element => getComputedStyle(element).transitionDuration);
  expect(transitionDuration.split(',').every(value => Number.parseFloat(value) <= 0.001)).toBe(true);
});


test('Medar provisions only operational roles and hides customer commerce routes', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.route('**/api/workspace/members?*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ members: [] }),
  }));
  await page.route('**/api/data/**', async route => {
    const table = new URL(route.request().url()).pathname.split('/').pop() || '';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], count: 0, error: null, table }) });
  });
  await page.goto('/simorgh/app/members', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /ساخت حساب جدید/ }).click();
  const roleSelect = page.getByLabel('نقش کاربر');
  await expect(roleSelect.locator('option')).toHaveCount(4);
  await expect.poll(() => roleSelect.locator('option').evaluateAll(options =>
    options.map(option => (option as HTMLOptionElement).value)
  )).toEqual(['admin', 'staff', 'supplier', 'driver']);

  await installIsolatedSession(page, 'customer');
  await page.goto('/simorgh/app/home', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'خرید سازمانی' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'سفارش‌های من' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'حساب سازمانی' })).toHaveCount(0);

  for (const route of ['catalog', 'my-orders', 'my-account']) {
    await page.goto('/simorgh/app/' + route, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\\/simorgh\\/app\\/home$/);
  }
});

test('mobile navigation spacing and contextual help remain usable', async ({ page }, testInfo) => {
  const viewportWidth = Number((testInfo.project.use as { viewport?: { width?: number } }).viewport?.width || 1365);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });

  if (viewportWidth <= 860) {
    await page.getByRole('button', { name: 'بازکردن منو' }).click();
    await expect(page.locator('.app-sidebar')).toHaveClass(/open/);
    await expect(page.locator('.app-sidebar .nav-tools-box .nav-groups')).toHaveCSS('row-gap', '2px');
    await expect(page.locator('.app-sidebar .nav-tools-box .nav-group > summary').first()).toHaveCSS('min-height', '34px');
    await expect(page.locator('.app-sidebar .nav-tools-box .nav-group > .side-nav a').first()).toHaveCSS('min-height', '36px');

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
    await page.getByRole('button', { name: 'بستن پنل' }).click();
  }

  await page.getByRole('button', { name: 'بازکردن راهنمای این بخش' }).click();
  const localGuide = page.getByRole('dialog', { name: 'راهنمای این بخش' });
  await expect(localGuide).toBeVisible();
  await expect(localGuide).toContainText('قاعدهٔ اصلی');
  await expect(localGuide.locator('.medar-help-steps')).toBeVisible();

  await page.getByRole('button', { name: 'راهنمای کلی' }).click();
  const fullGuide = page.getByRole('dialog', { name: 'راهنمای جامع مدیریت مدار' });
  await expect(fullGuide).toBeVisible();
  await expect(fullGuide).toContainText('راهنمای کلی؛ از صفر تا مدیریت روزانه');
  await expect(fullGuide.locator('.medar-help-global-manual')).toBeVisible();

  const helpDimensions = await page.evaluate(() => {
    const box = document.querySelector('.medar-help-dialog')?.getBoundingClientRect();
    return { viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth,
      left: box?.left ?? 0, right: box?.right ?? 0, width: box?.width ?? 0, height: box?.height ?? 0 };
  });
  expect(helpDimensions.document).toBeLessThanOrEqual(helpDimensions.viewport);
  expect(helpDimensions.left).toBeGreaterThanOrEqual(0);
  expect(helpDimensions.right).toBeLessThanOrEqual(helpDimensions.viewport);
  expect(helpDimensions.width).toBeGreaterThan(200);
  expect(helpDimensions.height).toBeGreaterThan(0);

  await fullGuide.getByRole('button', { name: 'بستن راهنما' }).click();
  await expect(fullGuide).toHaveCount(0);
  expect(errors).toEqual([]);
});
