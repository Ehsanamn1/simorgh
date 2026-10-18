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
  await expect(page).toHaveURL(/\/simorgh\/app\/home$/);
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
    await expect(homeLink).toHaveAttribute('href', /\\/app\\/home$/);
    await homeLink.click();
    await expect(page).toHaveURL(/\\/app\\/home$/);
    await expect(page.getByRole('heading', { name: /سلام مالک آزمایشی مدار/ })).toBeVisible();
  }
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});

test('manager map shows every saved farm coordinate and allows marker selection', async ({ page }) => {
  await installIsolatedSession(page, 'owner');
  const sites = [
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
  await expect(page).toHaveURL(/\/simorgh\/app\/home$/);
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
  await expect(page).toHaveURL(/\/simorgh\/app\/home$/);
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
  await expect(page).toHaveURL(/\/simorgh\/app\/home$/);
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
  await expect(dialog.locator('.ai-composer-actions small')).toContainText('مکالمه صوتی فعال');
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
