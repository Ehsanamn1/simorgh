const pageSectionLabels: Record<string, string> = {
  'CONTROL CENTER / 01': 'نمای کلی شبکه',
  'SALES / ORDERS': 'فروش و سفارش‌ها',
  'SUPPLY / CAPACITY': 'ظرفیت تأمین',
  'QUALITY / TRACEABILITY': 'کیفیت و ردیابی',
  'LOGISTICS / DELIVERY': 'ارسال و تحویل',
  'FINANCE / RECONCILIATION': 'مالی و تسویه',
  'ACCESS / MEMBERSHIPS': 'مدیریت دسترسی',
  'GOVERNANCE / AUDIT': 'تاریخچه و نظارت',
  'CUSTOMER COMMERCE / CATALOG': 'کاتالوگ مشتری',
  'CUSTOMER COMMERCE / ORDERS': 'سفارش‌های مشتری',
  'CUSTOMER ACCOUNT / TERMS': 'حساب سازمانی',
  'SUPPLIER / ASSIGNED WORK': 'کارهای تأمین',
  'SUPPLIER / CAPACITY': 'ظرفیت تأمین‌کننده',
  'SUPPLIER / SETTLEMENT': 'تسویه تأمین‌کننده',

  'WAREHOUSE / STOCK LEDGER': 'انبار و گردش کالا',
  'FARM / FACILITIES': 'مزارع و سایت‌ها',
  'FARM / FLOCK CYCLES': 'چرخه‌های پرورش',
  'PRODUCTION / TRACEABILITY': 'رهگیری تولید',
  'PRODUCTION / DAILY LOG': 'ثبت روزانه تولید',
  'OPERATIONS / SOP LIBRARY': 'دستورالعمل‌های کاری',
  'OPERATIONS / TASK CONTROL': 'وظایف عملیاتی',
  'OPERATIONS / INCIDENTS': 'رخدادها و مغایرت‌ها',
  'PARTNERSHIPS / AGREEMENTS': 'قراردادهای مشارکت',
  'FINANCE / PARTNER LEDGER': 'دفتر مالی شریک',
  'FINANCE / PARTNER RECONCILIATION': 'تسویه‌ی مشارکت',
};

/** Maps internal section identifiers to concise Persian labels. */
export function pageSectionLabel(section: string): string {
  return pageSectionLabels[section] ?? section;
}
