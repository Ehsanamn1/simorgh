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
  page.on('pageerror', error => errors.push(error.message));
  await installIsolatedSession(page, 'owner');
  await page.goto('/simorgh/app', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/home$/);
  await expect(page.getByRole('heading', { name: /سلام مالک آزمایشی مدار/ })).toBeVisible();
  await expect(page.locator('.workspace-home-hero')).toContainText('کنترل امروز کسب‌وکار');
  await expect(page.getByRole('heading', { name: 'بخش‌های پرکاربرد شما' })).toBeVisible();
  await expect(page.locator('.workspace-home-link').filter({ hasText: 'دفترچه مخاطبین' })).toBeVisible();
  await expect(page.locator('.workspace-home-section').filter({ hasText: 'کارهای امروز و هشدارها' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('manager-role-home-viewport.png') });
  await page.screenshot({ path: testInfo.outputPath('manager-role-home.png'), fullPage: true });

  const paths = [
    ['farm-sites', 'سایت‌های مزرعه'],
    ['flock-cycles', 'چرخه‌های کشت و پرورش'],
    ['production-batches', 'بچ‌های تولید'],
    ['daily-production', 'ثبت روزانه عملیات'],
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
    const homeLink = page.getByRole('link', { name: 'بازگشت به صفحه اصلی' });
    await expect(homeLink).toBeVisible();
    await expect(homeLink).toHaveAttribute('href', /home$/);
    await homeLink.click();
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
  await expect(map.locator('.iran-paper-illustration')).toBeVisible();
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
  await map.getByRole('button', { name: 'نقشه دقیق' }).click();
  const embedUrl = await map.locator('.farm-map-canvas iframe').getAttribute('src');
  expect(embedUrl).toContain('bbox=');
  expect(embedUrl).not.toContain('marker=');

  await map.getByRole('button', { name: 'انتخاب واحد کرمان' }).click();
  await expect(map.locator('.farm-map-marker.active .farm-map-marker-label')).toHaveText('واحد کرمان');
  await expect(map.locator('.farm-map-site.active b')).toHaveText('واحد کرمان');

  sites = [];
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(map.locator('.iran-paper-illustration')).toBeVisible();
  await expect(map.getByRole('button', { name: 'نقشه کاغذی ایران' })).toBeEnabled();
  await expect(map.locator('.farm-map-sites-empty')).toBeVisible();
  await expect(map.getByRole('button', { name: 'نقشه دقیق' })).toBeDisabled();
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
  await map.getByRole('button', { name: 'نقشه دقیق' }).click();
  await expect(map.locator('.farm-map-canvas iframe')).toBeVisible();
  await expect(map.locator('.farm-map-canvas iframe')).toHaveAttribute('src', /bbox=/);
  await expect(map.locator('.farm-map-driver-marker')).toHaveCount(1);

  ageMs = 10 * 60 * 1000;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(map.locator('.farm-map-driver-marker')).toHaveCount(0);
  await expect(map.locator('.farm-map-fleet-list')).toContainText('آخرین نقطه قدیمی است');
});

test('generic farm types and daily rejected quantities are validated before writes', async ({ page }) => {
  await installIsolatedSession(page, 'owner');

  await page.goto('/simorgh/app/products', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'کاتالوگ و مشخصات محصول' })).toBeVisible();
  await page.getByRole('button', { name: 'افزودن رکورد', exact: true }).click();
  const productKind = page.getByLabel('نوع محصول');
  for (const kind of ['farm_product','crop','livestock','poultry','aquaculture','dairy','eggs','meat','honey','forestry','greenhouse','orchard','input','feed','equipment','processed','service','other']) {
    await expect(productKind.locator('option[value="' + kind + '"]')).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'انصراف' }).click();

  await page.goto('/simorgh/app/farm-sites', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'سایت‌های مزرعه' })).toBeVisible();
  await page.getByRole('button', { name: 'ثبت رکورد', exact: true }).click();
  const siteType = page.locator('#ops-site_type');
  for (const kind of ['crop','livestock','poultry','dairy','aquaculture','greenhouse','orchard','apiary','processing','warehouse','distribution','mixed','other']) {
    await expect(siteType.locator('option[value="' + kind + '"]')).toHaveCount(1);
  }
  const latitude = page.locator('#ops-latitude');
  const longitude = page.locator('#ops-longitude');
  await latitude.fill('-33.8688');
  await longitude.fill('151.2093');
  expect(await latitude.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
  expect(await longitude.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true);
  await latitude.fill('91');
  expect(await latitude.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
  await longitude.fill('-181');
  expect(await longitude.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false);
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

test('an existing account must join a workspace using an invitation code', async ({ page }) => {
  await installIsolatedSession(page, 'unprovisioned');
  const inviteeUserId = '00000000-0000-4000-8000-000000000011';
  let joined = false;
  const user = {
    id: inviteeUserId,
    username: 'unprovisioned_test',
    phone: '+989120000011',
    full_name: 'کاربر بدون عضویت مدار',
  };
  const joinedMembership = {
    id: '00000000-0000-4000-8000-000000000077',
    company_id: companyId,
    user_id: inviteeUserId,
    role: 'staff',
    customer_id: null,
    supplier_id: null,
    active: true,
    company: { name: 'شرکت دعوت آزمایشی' },
  };
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user, memberships: joined ? [joinedMembership] : [] }),
  }));
  await page.route('**/api/workspace/join', async route => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    expect(payload.inviteCode).toBe('a'.repeat(64));
    joined = true;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ membership: joinedMembership, memberships: [joinedMembership] }),
    });
  });

  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.access-request-card')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'پیوستن به مجموعه' })).toBeVisible();
  await expect(page.getByLabel('کد دعوت')).toBeVisible();
  await page.getByLabel('کد دعوت').fill('a'.repeat(64));
  await page.getByRole('button', { name: 'پیوستن به مجموعه' }).click();
  await expect(page.locator('.app-frame')).toBeVisible();
  expect(joined).toBe(true);
  await expect(page.locator('.workspace-switch')).toContainText('شرکت دعوت آزمایشی');
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
  await page.screenshot({ path: testInfo.outputPath('supplier-role-home-viewport.png') });
  await page.screenshot({ path: testInfo.outputPath('supplier-role-home.png'), fullPage: true });
  const supplierGroup = page.locator('.nav-group').filter({ has: page.locator('summary', { hasText: /^تأمین/ }) });
  await supplierGroup.locator('summary').click();
  await expect(supplierGroup.getByRole('link', { name: /کارهای واگذارشده/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /دستورالعمل‌های کاری/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /دسترسی کاربران/ })).toHaveCount(0);
  await expect(supplierGroup.getByRole('link', { name: /تسویه‌های من/ })).toBeVisible();
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

  const mobileNav = page.locator('.mobile-workspace-nav');
  if (viewportWidth <= 860) {
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'وظایف' })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'ثبت تولید' })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'ظرفیت' })).toBeVisible();
    await expect(mobileNav.getByRole('button', { name: 'بازکردن فهرست ماژول‌ها' })).toBeVisible();
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
    await expect(page).toHaveURL(/home$/);
  await expect(page.getByRole('heading', { name: /سلام مشتری آزمایشی مدار/ })).toBeVisible();
  await expect(page.locator('.workspace-home-hero')).toContainText('وضعیت سفارش‌های سازمان شما');
  await expect(page.locator('.workspace-home-link').filter({ hasText: 'کاتالوگ خرید' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('customer-role-home-viewport.png') });
  if (viewportWidth <= 860) {
    const nav = page.locator('.mobile-workspace-nav');
    await expect(nav).toBeVisible();
    for (const label of ['خرید', 'سفارش‌های من', 'حساب']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('button', { name: 'بازکردن فهرست ماژول‌ها' })).toBeVisible();
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
    await expect(page).toHaveURL(/home$/);
  await expect(page.getByRole('heading', { name: /سلام راننده آزمایشی مدار/ })).toBeVisible();
  await expect(page.locator('.workspace-home-hero')).toContainText('برنامه‌ی امروز راننده');
  await expect(page.locator('.workspace-home-link').filter({ hasText: 'محموله‌های من' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('driver-role-home-viewport.png') });
  if (viewportWidth <= 860) {
    const nav = page.locator('.mobile-workspace-nav');
    await expect(nav).toBeVisible();
    for (const label of ['محموله‌ها', 'نقشه', 'مدرک']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('button', { name: 'بازکردن فهرست ماژول‌ها' })).toBeVisible();
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

test('manager AI assistant opens in-panel with provider settings but no client key disclosure', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The assistant layout is responsive; verify key configuration flow once.');
  await installIsolatedSession(page, 'owner');
  const companyId = '00000000-0000-4000-8000-000000000022';
  await page.route('**/api/ai/providers*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        companyId,
        activeProvider: null,
        canConfigure: true,
        providers: [
          { provider: 'openai', model: 'gpt-6-luna', configured: false, isDefault: false, updatedAt: null },
          { provider: 'gemini', model: 'gemini-4-argon', configured: false, isDefault: false, updatedAt: null },
          { provider: 'deepseek', model: 'deepseek-flash', configured: false, isDefault: false, updatedAt: null },
          { provider: 'anthropic', model: 'claude-sonnet-5', configured: false, isDefault: false, updatedAt: null },
        ],
      }),
    });
  });
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'بازکردن دستیار هوش مصنوعی' }).click();
  const dialog = page.getByRole('dialog', { name: 'دستیار مدار' });
  await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: 'تنظیمات اتصال هوش مصنوعی' }).click();
  await expect(page.getByText('اتصال مدل‌های هوش مصنوعی')).toBeVisible();
  await expect(dialog.locator('input[type="password"][autocomplete="new-password"]')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Gemini/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /DeepSeek/ })).toBeVisible();
  await expect(page.getByText(/کلید فقط به API امن مدار فرستاده می‌شود/)).toBeVisible();
  await dialog.locator('input[type="password"][autocomplete="new-password"]').fill('sk-test-provider-key-0000000000');
  let testPayload: Record<string, unknown> | undefined;
  await page.route('**/api/ai/provider-test', async route => {
    testPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      ok: true, provider: 'openai', model: 'gpt-6-luna', message: 'اتصال به OpenAI موفق بود. این تست کلید جدید را ذخیره نکرد.',
    }) });
  });
  await dialog.getByRole('button', { name: /تست اتصال بدون ذخیره/ }).click();
  await expect(dialog.getByRole('status')).toContainText('اتصال به OpenAI موفق بود');
  expect(testPayload?.apiKey).toBe('sk-test-provider-key-0000000000');
});

test('AI assistant sends a PDF attachment through the selected provider boundary', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Validate binary PDF packaging once; responsive layout is covered in all viewport projects.');
  await installIsolatedSession(page, 'owner');
  const companyId = '00000000-0000-4000-8000-000000000022';
  await page.route('**/api/ai/providers*', async route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      companyId, activeProvider: 'openai', canConfigure: true,
      providers: [
        { provider: 'openai', model: 'gpt-6-luna', configured: true, isDefault: true, updatedAt: null },
        { provider: 'gemini', model: 'gemini-4-argon', configured: false, isDefault: false, updatedAt: null },
        { provider: 'deepseek', model: 'deepseek-flash', configured: false, isDefault: false, updatedAt: null },
        { provider: 'anthropic', model: 'claude-sonnet-5', configured: false, isDefault: false, updatedAt: null },
      ],
    }),
  }));
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF', 'utf8');
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/ai/chat', async route => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: 'تحلیل آزمایشی فایل انجام شد.', provider: 'openai', model: 'gpt-6-luna' }),
    });
  });
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'بازکردن دستیار هوش مصنوعی' }).click();
  const dialog = page.getByRole('dialog', { name: 'دستیار مدار' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.ai-composer-actions small')).toContainText('OpenAI');
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'operations.pdf', mimeType: 'application/pdf', buffer: pdf,
  });
  await expect(dialog.locator('.ai-attachment-chip')).toContainText('operations.pdf');
  await dialog.getByRole('textbox', { name: 'پیام به دستیار' }).fill('این سند را خلاصه کن.');
  await dialog.getByRole('button', { name: 'ارسال پیام' }).click();
  await expect(dialog.locator('.ai-message.assistant')).toContainText('تحلیل آزمایشی فایل انجام شد.');
  const attachment = submitted?.attachment as { name?: string; mimeType?: string; base64?: string } | undefined;
  expect(attachment?.name).toBe('operations.pdf');
  expect(attachment?.mimeType).toBe('application/pdf');
  expect(attachment?.base64).toBe(pdf.toString('base64'));
});

test('assistant can enter and stop automatic turn-taking voice mode', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Verify voice mode controls once; the general responsive workspace suite covers the other viewports.');
  await installIsolatedSession(page, 'owner');
  await page.addInitScript(() => {
    class MockSpeechRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null = null;
      onerror: ((event: { error?: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {}
      stop() { this.onend?.(); }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: MockSpeechRecognition });

    // CI validates the WebRTC state machine without a real microphone or external API key.
    const audioTrack = { stop() {}, kind: 'audio', enabled: true };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getAudioTracks: () => [audioTrack], getTracks: () => [audioTrack] }) },
    });
    class MockRTCDataChannel {
      readyState = 'open';
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() { window.setTimeout(() => this.onopen?.(), 0); }
      send(_message: string) {}
      close() { this.readyState = 'closed'; }
    }
    class MockRTCPeerConnection {
      connectionState = 'new';
      ontrack: ((event: { streams: unknown[] }) => void) | null = null;
      onconnectionstatechange: (() => void) | null = null;
      addTrack(_track: unknown, _stream: unknown) {}
      createDataChannel(_label: string) { return new MockRTCDataChannel(); }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
      async setLocalDescription(_description: unknown) {}
      async setRemoteDescription(_description: unknown) {
        this.connectionState = 'connected';
        this.onconnectionstatechange?.();
      }
      close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
    }
    Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: MockRTCPeerConnection });
  });
  await page.route('**/api/ai/realtime/session**', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['content-type']).toContain('application/sdp');
    await route.fulfill({ status: 200, contentType: 'application/sdp', body: 'v=0\r\n' });
  });
  await page.route('**/api/ai/providers*', async route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      activeProvider: 'openai', canConfigure: true,
      providers: [
        { provider: 'openai', model: 'gpt-6-luna', configured: true, isDefault: true, updatedAt: null },
        { provider: 'gemini', model: 'gemini-4-argon', configured: false, isDefault: false, updatedAt: null },
        { provider: 'deepseek', model: 'deepseek-flash', configured: false, isDefault: false, updatedAt: null },
        { provider: 'anthropic', model: 'claude-sonnet-5', configured: false, isDefault: false, updatedAt: null },
      ],
    }),
  }));
  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'بازکردن دستیار هوش مصنوعی' }).click();
  const dialog = page.getByRole('dialog', { name: 'دستیار مدار' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'شروع مکالمه صوتی خودکار' })).toBeVisible();
  await dialog.getByRole('button', { name: 'شروع مکالمه صوتی خودکار' }).click();
  await expect(dialog.getByRole('button', { name: 'توقف مکالمه صوتی' })).toBeVisible();
  await expect(dialog.locator('.ai-composer-actions small')).toContainText('مکالمه realtime فعال');
  await dialog.getByRole('button', { name: 'توقف مکالمه صوتی' }).click();
  await expect(dialog.getByRole('button', { name: 'شروع مکالمه صوتی خودکار' })).toBeVisible();
});

test('manager can preview and import a mixed supplier/customer CSV with duplicate phone removal', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Validate import API payload once; compact layout is covered by general responsive checks.');
  await installIsolatedSession(page, 'owner');
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/contacts/import', async route => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        imported: 2, updated: 0, skipped: 0,
        byKind: { suppliers: { imported: 1, updated: 0 }, customers: { imported: 1, updated: 0 } },
      }),
    });
  });
  await page.goto('/simorgh/app/contacts-import', { waitUntil: 'domcontentloaded' });
  await page.locator('.contact-import-page input[type="file"]').setInputFiles({
    name: 'contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,phone,city,address,email,organization,notes,tags,type\nSupplier One,PHONE-001,Tehran,Industrial zone,supplier@example.invalid,North Farm,egg producer,producer|wholesale,supplier\nCustomer Two,PHONE-002,Karaj,Main street,buyer@example.invalid,City Store,retail customer,retail|weekly,customer\nDuplicate supplier,+PHONE-001,Tehran,Industrial zone,other@example.invalid,North Farm,duplicate,producer|wholesale,supplier', 'utf8'),
  });
  await expect(page.getByText('Supplier One')).toBeVisible();
  await expect(page.getByText('Customer Two')).toBeVisible();
  await expect(page.locator('.contact-preview-list .contact-duplicate-tag')).toBeVisible();
  await page.getByRole('button', { name: /ثبت .* مخاطب در فضای کاری/ }).click();
  await expect(page.getByRole('status')).toContainText('واردکردن مخاطبین کامل شد');
  expect(Array.isArray(submitted?.contacts)).toBe(true);
  const importedContacts = submitted?.contacts as Array<{ kind: string; name: string; email?: string; organization?: string; notes?: string; tags?: string[] }>;
  expect(importedContacts).toHaveLength(2);
  expect(importedContacts.map(contact => contact.kind).sort()).toEqual(['customers', 'suppliers']);
  const supplier = importedContacts.find(contact => contact.kind === 'suppliers');
  expect(supplier).toMatchObject({ email: 'supplier@example.invalid', organization: 'North Farm', notes: 'egg producer' });
  expect(supplier?.tags).toEqual(['producer','wholesale']);
  const customer = importedContacts.find(contact => contact.kind === 'customers');
  expect(customer).toMatchObject({ email: 'buyer@example.invalid', organization: 'City Store', notes: 'retail customer' });
  expect(customer?.tags).toEqual(['retail','weekly']);
});

test('AI contact classification sends no phone, email or street address and only suggests changes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The contact classification flow uses the same responsive preview.');
  await installIsolatedSession(page, 'owner');
  let sent: Record<string, unknown> | undefined;
  await page.route('**/api/contacts/classify', async route => {
    sent = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        analyzed: 2, provider: 'deepseek', model: 'deepseek-flash',
        results: [
          { index: 0, kind: 'suppliers', confidence: 0.93, reason: 'سازمان و توضیحات با تأمین‌کننده سازگار است.', tags: ['تولیدکننده'] },
          { index: 1, kind: 'customers', confidence: 0.91, reason: 'توضیحات کسب‌وکار با مشتری سازگار است.', tags: ['خریدار'] },
        ],
      }),
    });
  });
  await page.goto('/simorgh/app/contacts-import', { waitUntil: 'domcontentloaded' });
  await page.locator('.contact-import-page input[type="file"]').setInputFiles({
    name: 'contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,phone,city,address,email,organization,notes,tags,type\nSupplier One,PHONE-001,Tehran,Private road,supplier@example.invalid,North Farm,egg producer,producer|wholesale,supplier\nCustomer Two,PHONE-002,Karaj,Private lane,buyer@example.invalid,City Store,retail customer,retail|weekly,customer', 'utf8'),
  });
  await expect(page.getByText('Supplier One')).toBeVisible();
  await page.getByRole('button', { name: /تحلیل .* مخاطب/ }).click();
  await expect(page.locator('.contact-ai-summary')).toContainText('هنوز چیزی در پایگاه داده ذخیره نشده است.');
  expect(Array.isArray(sent?.contacts)).toBe(true);
  const rows = sent?.contacts as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row).not.toHaveProperty('phone');
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('address');
    expect(row).not.toHaveProperty('streetAddress');
  }
  expect(JSON.stringify(sent)).not.toContain('PHONE-001');
  expect(JSON.stringify(sent)).not.toContain('supplier@example.invalid');
  expect(JSON.stringify(sent)).not.toContain('Private road');
  await expect(page.getByText(/پیشنهاد AI · ۹۳٪/)).toBeVisible();
});

test('a signed-in user can change their own password through the protected Worker endpoint', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Validate the credential-change request once; responsive auth and workspace layout are covered in every viewport.');
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

  await page.goto('/simorgh/app/command', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /تغییر گذرواژه/ }).click();
  await expect(page.getByRole('dialog', { name: 'تغییر گذرواژه' })).toBeVisible();
  await page.getByLabel('گذرواژه فعلی').fill('Old-pass-2026');
  await page.getByLabel('گذرواژه جدید', { exact: true }).fill('New-pass-2026');
  await page.getByLabel('تکرار گذرواژه جدید').fill('New-pass-2026');
  await page.getByRole('button', { name: 'ذخیره گذرواژه جدید' }).click();

  await expect(page.getByRole('status')).toContainText('گذرواژه تغییر کرد');
  expect(submitted).toEqual({ currentPassword: 'Old-pass-2026', newPassword: 'New-pass-2026' });
});


test('assistant send control remains visible and sends a message through the authenticated Worker API', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  await page.route('**/api/ai/providers**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify({
      companyId,
      activeProvider: 'openai',
      canConfigure: true,
      providers: [{ provider: 'openai', model: 'gpt-6-luna', isDefault: true, configured: true, updatedAt: null }],
    }),
  }));
  await page.route('**/api/ai/chat', async route => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    const payload = request.postDataJSON() as { companyId?: string; messages?: Array<{ role: string; content: string }> };
    expect(payload.companyId).toBe(companyId);
    expect(payload.messages?.some(message => message.role === 'user' && message.content === 'وضعیت کارهای امروز چیست؟')).toBe(true);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ content: 'کارهای امروز از داده‌های واقعی بررسی می‌شوند.', provider: 'openai', model: 'gpt-6-luna' }),
    });
  });
  await page.goto('/simorgh/app/home', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'بازکردن دستیار هوش مصنوعی' }).click();
  const composer = page.getByRole('textbox', { name: 'پیام به دستیار' });
  await expect(composer).toBeVisible();
  const send = page.getByRole('button', { name: 'ارسال پیام' });
  await expect(send).toBeVisible();
  await expect(send).toBeDisabled();
  await composer.fill('وضعیت کارهای امروز چیست؟');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText('کارهای امروز از داده‌های واقعی بررسی می‌شوند.')).toBeVisible();
  await expect(composer).toHaveValue('');
});


test('agent center creates an inert proposal and only creates a task after explicit approval', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  const actionId = '00000000-0000-4000-8000-000000000099';
  const taskId = '00000000-0000-4000-8000-000000000098';
  const requestedBy = '00000000-0000-4000-8000-000000000011';
  let action: {
    id: string;
    toolKey: 'create_operational_task';
    status: 'proposed' | 'executed' | 'cancelled' | 'failed';
    arguments: Record<string, unknown>;
    result: { taskId?: string; title?: string; status?: string } | null;
    createdAt: string;
    executedAt?: string | null;
    requestedByName: string;
    requestedBy: string;
  } | null = null;
  let createdTasks = 0;

  await page.route('**/api/workspace/members*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        members: [{
          membership_id: '00000000-0000-4000-8000-000000000044',
          company_id: companyId,
          user_id: requestedBy,
          role: 'owner',
          active: true,
          username: 'owner_test',
          full_name: 'مالک آزمایشی مدار',
        }],
      }),
    });
  });
  await page.route('**/api/ai/actions**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/ai/actions' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ actions: action ? [action] : [] }) });
      return;
    }
    if (url.pathname === '/api/ai/actions/propose' && method === 'POST') {
      const body = route.request().postDataJSON() as { companyId?: string; toolKey?: string; arguments?: Record<string, unknown> };
      expect(body.companyId).toBe(companyId);
      expect(body.toolKey).toBe('create_operational_task');
      expect(body.arguments?.title).toBe('پیگیری تأمین خوراک فردا');
      action = {
        id: actionId,
        toolKey: 'create_operational_task',
        status: 'proposed',
        arguments: body.arguments ?? {},
        result: null,
        createdAt: new Date().toISOString(),
        requestedByName: 'مالک آزمایشی مدار',
        requestedBy,
      };
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ action, requiresConfirmation: true }) });
      return;
    }
    if (url.pathname === '/api/ai/actions/' + actionId + '/execute' && method === 'POST') {
      const body = route.request().postDataJSON() as { companyId?: string; confirmed?: boolean };
      expect(body.companyId).toBe(companyId);
      expect(body.confirmed).toBe(true);
      expect(action?.status).toBe('proposed');
      createdTasks += 1;
      action = { ...action!, status: 'executed', result: { taskId, title: 'پیگیری تأمین خوراک فردا', status: 'pending' }, executedAt: new Date().toISOString() };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, result: action.result }) });
      return;
    }
    if (url.pathname === '/api/ai/actions/' + actionId + '/cancel' && method === 'POST') {
      action = { ...action!, status: 'cancelled' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Unexpected agent API route in test' }) });
  });

  page.on('dialog', dialog => dialog.accept());
  await page.goto('/simorgh/app/agents', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'مرکز ایجنت‌ها و اقدامات' })).toBeVisible();
  await page.getByLabel('عنوان وظیفه').fill('پیگیری تأمین خوراک فردا');
  await page.getByLabel('شرح و نتیجهٔ مورد انتظار').fill('موجودی را بررسی و نتیجه را ثبت کن.');
  await page.getByRole('button', { name: 'ثبت پیشنهاد برای تأیید' }).click();
  await expect(page.locator('.agent-feedback.notice')).toContainText('پیشنهاد ذخیره شد؛ هنوز هیچ وظیفه‌ای در عملیات ایجاد نشده است.');
  await expect(page.getByText('در انتظار تأیید')).toBeVisible();
  expect(createdTasks).toBe(0);

  await page.getByRole('button', { name: 'تأیید و ایجاد وظیفه' }).click();
  await expect(page.getByText('وظیفه پس از تأیید در مدار ایجاد شد.')).toBeVisible();
  await expect(page.getByText('اجرا شد')).toBeVisible();
  await expect(page.getByText('شناسه وظیفه:')).toBeVisible();
  expect(createdTasks).toBe(1);
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
  await expect(agentRead).toBeVisible();
  await expect(agentRead).toBeChecked();
  await agentRead.uncheck();
  await page.getByRole('button', { name: 'ذخیره مجوزها' }).click();
  await expect(page.getByText('مجوزهای ماژول ذخیره شدند؛ محدودیت‌ها در API سمت سرور اعمال می‌شوند.')).toBeVisible();
  expect(saved).not.toBeNull();
  const agentsSaved = saved!.find(module => module.key === 'agents');
  expect(agentsSaved).toMatchObject({ configured: true, can_read: false });
  await staffRow.getByRole('button', { name: 'مجوزها' }).click();
  await page.getByRole('button', { name: 'بازگشت به پیش‌فرض نقش' }).click();
  await page.getByRole('button', { name: 'ذخیره مجوزها' }).click();
  await expect(page.getByText('مجوزهای ماژول ذخیره شدند؛ محدودیت‌ها در API سمت سرور اعمال می‌شوند.')).toBeVisible();
  expect(saved!.every(module => module.configured === false)).toBe(true);
});


test('finance imports an actual CSV payload and reconciles only after explicit confirmation', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  const accountId = '00000000-0000-4000-8000-000000000301';
  const transactionId = '00000000-0000-4000-8000-000000000302';
  const invoiceId = '00000000-0000-4000-8000-000000000303';
  let importedRows: Array<Record<string, unknown>> = [];
  let transactionStatus = 'unmatched';
  let reconcileCalls = 0;
  const account = {
    id: accountId, label: 'حساب تست عملیات', bankName: 'بانک آزمایشی', maskedAccount: '****1234',
    currency: 'IRR', provider: 'manual_csv', connectionStatus: 'manual_import', active: true,
    lastImportedAt: null, createdAt: new Date().toISOString(), transactionCount: 1, unmatchedCount: 1,
  };
  const transaction = {
    id: transactionId, bankAccountId: accountId, externalTransactionId: 'TXN-20261018-001',
    bookedAt: '2026-10-18T08:30:00.000Z', amount: '1250.50', currency: 'IRR',
    description: 'دریافت مشتری', counterparty: 'مشتری آزمایشی', reference: 'REF-000001',
    direction: 'incoming', reconciliationStatus: 'unmatched', importedAt: new Date().toISOString(),
  };
  await page.route('**/api/finance/bank-accounts*', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          accounts: [account],
          summary: { total: 1, unmatched: transactionStatus === 'unmatched' ? 1 : 0, reconciled: transactionStatus === 'reconciled' ? 1 : 0 },
          capabilities: { canCreate: true, canUpdate: true, canDelete: false, canReconcile: true },
        }),
      });
      return;
    }
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ account }) });
  });
  await page.route('**/api/finance/bank-transactions**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname.endsWith('/candidates')) {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ candidates: [{
          entityType: 'invoice', entityId: invoiceId, label: 'فاکتور INV-900 · مشتری آزمایشی',
          amount: '1250.50', dueAt: '2026-10-20', status: 'issued',
        }] }),
      });
      return;
    }
    if (method === 'GET') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          transactions: transactionStatus === 'unmatched' ? [transaction] : [{ ...transaction, reconciliationStatus: transactionStatus, matchedEntityType: 'invoice', matchedEntityId: invoiceId }],
        }),
      });
      return;
    }
    if (method === 'POST' && url.pathname.endsWith('/import')) {
      const body = route.request().postDataJSON() as { companyId: string; accountId: string; transactions: Array<Record<string, unknown>> };
      expect(body.companyId).toBe(companyId);
      expect(body.accountId).toBe(accountId);
      importedRows = body.transactions;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ inserted: body.transactions.length, skippedDuplicates: 0, submitted: body.transactions.length }),
      });
      return;
    }
    if (method === 'POST' && url.pathname.endsWith('/reconcile')) {
      const body = route.request().postDataJSON() as { companyId: string; entityType: string; entityId: string };
      expect(body.companyId).toBe(companyId);
      expect(body.entityType).toBe('invoice');
      expect(body.entityId).toBe(invoiceId);
      reconcileCalls += 1;
      transactionStatus = 'reconciled';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'reconciled' }) });
      return;
    }
    if (method === 'POST' && url.pathname.endsWith('/ignore')) {
      transactionStatus = 'ignored';
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, status: 'ignored' }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Unexpected bank API request in test.' }) });
  });

  page.on('dialog', dialog => dialog.accept());
  await page.goto('/simorgh/app/finance', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'صورت‌حساب بانکی و تطبیق تراکنش' })).toBeVisible();
  await expect(page.locator('.bank-account-card').filter({ hasText: 'حساب تست عملیات' })).toBeVisible();
  const csv = [
    'transaction_id,date,amount,currency,description,counterparty,reference',
    'TXN-20261018-001,2026-10-18,1250.50,IRR,"دریافت مشتری",مشتری آزمایشی,REF-000001',
  ].join('\n');
  await page.locator('.bank-import-button input[type="file"]').setInputFiles({
    name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await expect(page.getByText(/ورود صورت‌حساب تمام شد/)).toBeVisible();
  expect(importedRows).toHaveLength(1);
  expect(importedRows[0]).toMatchObject({ externalTransactionId: 'TXN-20261018-001', amount: 1250.5, direction: 'incoming' });
  await expect(page.getByText('دریافت مشتری')).toBeVisible();

  await page.getByRole('button', { name: 'تطبیق', exact: true }).click();
  const candidateSelect = page.getByLabel('سند تجاری مربوط');
  await expect(candidateSelect.locator('option').filter({ hasText: 'فاکتور INV-900 · مشتری آزمایشی' })).toHaveCount(1);
  await candidateSelect.selectOption('invoice:' + invoiceId);
  await expect(candidateSelect).toHaveValue('invoice:' + invoiceId);
  await page.getByRole('button', { name: 'تأیید و ثبت تطبیق' }).click();
  await expect(page.getByText(/پیوند تطبیق مالی ثبت/)).toBeVisible();
  expect(reconcileCalls).toBe(1);
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
  await expect(page.getByText('محمولهٔ فعال')).toBeVisible();
  const markRead = page.getByRole('button', { name: 'خوانده‌شده: خلاصهٔ روزانهٔ عملیات' });
  await expect(markRead).toBeVisible();
  await markRead.click();
  await expect(page.locator('.notification-item.unread')).toHaveCount(0);
  await expect(markRead).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'اعلان‌های من' })).toContainText('۰');
  expect(markReadCalls).toBe(1);
});

test('finance bank reconciliation imports real CSV rows without duplicating transactions', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  const accountId = '00000000-0000-4000-8000-000000000301';
  let accountCreated = false;
  let importedPayload: { companyId?: string; accountId?: string; transactions?: Array<Record<string, unknown>> } | null = null;
  let importCalls = 0;
  const account = {
    id: accountId, label: 'حساب تست عملیات', bankName: 'بانک نمونه', maskedAccount: '****1234',
    currency: 'IRR', provider: 'manual_csv', connectionStatus: 'manual_import', active: true,
    lastImportedAt: null, createdAt: new Date().toISOString(), transactionCount: importCalls ? 1 : 0,
    unmatchedCount: importCalls ? 1 : 0,
  };

  await page.route('**/api/finance/bank-accounts**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { companyId: string; label: string; maskedAccount: string };
      expect(body.companyId).toBe(companyId);
      expect(body.label).toBe('حساب تست عملیات');
      expect(body.maskedAccount).toBe('****1234');
      accountCreated = true;
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ account }) });
      return;
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        accounts: accountCreated ? [{ ...account, transactionCount: importCalls, unmatchedCount: importCalls }] : [],
        summary: { total: importCalls, unmatched: importCalls, reconciled: 0 },
        capabilities: { canCreate: true, canUpdate: true, canDelete: false, canReconcile: true },
      }),
    });
  });
  await page.route('**/api/finance/bank-transactions/import', async route => {
    expect(route.request().method()).toBe('POST');
    importedPayload = route.request().postDataJSON() as { companyId?: string; accountId?: string; transactions?: Array<Record<string, unknown>> };
    expect(importedPayload.companyId).toBe(companyId);
    expect(importedPayload.accountId).toBe(accountId);
    importCalls += 1;
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ inserted: importCalls === 1 ? 1 : 0, skippedDuplicates: importCalls === 1 ? 0 : 1, submitted: 1 }),
    });
  });
  await page.route('**/api/finance/bank-transactions?**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ transactions: [] }) });
  });

  await page.goto('/simorgh/app/finance', { waitUntil: 'domcontentloaded' });
  const bank = page.locator('.bank-reconciliation');
  await expect(bank.getByRole('heading', { name: 'صورت‌حساب بانکی و تطبیق تراکنش' })).toBeVisible();
  await bank.getByRole('button', { name: 'حساب جدید' }).click();
  await bank.getByLabel('نام نمایشی حساب').fill('حساب تست عملیات');
  await bank.getByLabel('نام بانک').fill('بانک نمونه');
  await bank.getByLabel('چهار رقم پایانی (اختیاری)').fill('****1234');
  await bank.getByRole('button', { name: 'ثبت حساب' }).click();
  await expect(bank.getByRole('button', { name: /حساب تست عملیات/ })).toBeVisible();

  const csv = [
    'transaction_id,date,amount,currency,description,counterparty,reference',
    'TXN-000001,2026-10-18,1250.50,IRR,"خرید, خوراک",فروشگاه,REF-12345',
  ].join('\n');
  const fileInput = bank.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(bank.getByText(/۱ تراکنش جدید ثبت شد/)).toBeVisible();
  expect(importCalls).toBe(1);
  expect(importedPayload!.transactions).toHaveLength(1);
  expect(importedPayload!.transactions![0]).toMatchObject({
    externalTransactionId: 'TXN-000001',
    amount: 1250.5,
    description: 'خرید, خوراک',
    counterparty: 'فروشگاه',
    reference: 'REF-12345',
  });

  await fileInput.setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(bank.getByText(/۰ تراکنش جدید ثبت شد و ۱ مورد تکراری نادیده گرفته شد/)).toBeVisible();
  expect(importCalls).toBe(2);
});
