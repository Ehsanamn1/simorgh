import { expect, test } from '@playwright/test';

const panels = [
  { role: /مدیر و مالک شبکه/, title: 'مرکز فرمان شرکت', item: 'نمای عملیاتی شبکه' },
  { role: /تأمین‌کننده و شریک مزرعه/, title: 'فضای تأمین و مزرعه', item: 'کارهای واگذارشده' },
  { role: /راننده و پیمانکار حمل/, title: 'فضای راننده و حمل', item: 'محموله‌های واگذارشده' },
  { role: /مشتری و خریدار عمده/, title: 'فضای مشتری سازمانی', item: 'کاتالوگ و سفارش' },
];

for (const panel of panels) {
  test(`role preview contains its own navigation and capability: ${String(panel.title)}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/simorgh/', { waitUntil: 'domcontentloaded' });

    const card = page.getByRole('button', { name: panel.role });
    await expect(card).toBeVisible();
    await card.click();
    await page.getByRole('button', { name: 'نمایش ساختار پنل' }).click();

    await expect(page.getByRole('heading', { name: panel.title })).toBeVisible();
    await expect(page.getByRole('navigation', { name: /منوی پیش‌نمایش/ })).toBeVisible();
    await expect(page.getByText('ورود و ثبت‌نام فعلاً غیرفعال است')).toBeVisible();
    await expect(page.getByText(panel.item, { exact: true })).toBeVisible();
    await expect(page.getByText('نمای ساختاری، نه پنل عملیاتی')).toBeVisible();
    expect(errors).toEqual([]);
  });
}
