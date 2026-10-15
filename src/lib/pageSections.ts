const pageSectionLabels: Record<string, string> = {
  'CONTROL CENTER / 01': 'مرکز فرمان عملیات',
  'MANAGEMENT / OBJECTIVES': 'اهداف مدیریتی',
  'SALES / ORDERS': 'فروش و سفارش‌ها',
  'SUPPLY / CAPACITY': 'برنامه‌ریزی ظرفیت',
  'QUALITY / TRACEABILITY': 'کیفیت و ردیابی',
  'LOGISTICS / DELIVERY': 'حمل و تحویل',
  'FINANCE / RECONCILIATION': 'مالی و تسویه',
  'ACCESS / MEMBERSHIPS': 'مدیریت دسترسی',
  'GOVERNANCE / AUDIT': 'ممیزی و تاریخچه تغییرات',
  'CUSTOMER COMMERCE / CATALOG': 'کاتالوگ مشتری',
  'CUSTOMER COMMERCE / ORDERS': 'سفارش‌های مشتری',
  'CUSTOMER ACCOUNT / TERMS': 'حساب و شرایط همکاری',
  'SUPPLIER / ASSIGNED WORK': 'کارهای تأمین',
  'SUPPLIER / CAPACITY': 'ظرفیت تأمین‌کننده',
  'SUPPLIER / SETTLEMENT': 'تسویه تأمین‌کننده',
};

/** Maps internal section identifiers to concise Persian labels. */
export function pageSectionLabel(section: string): string {
  return pageSectionLabels[section] ?? section;
}
