const pageSectionLabels: Record<string, string> = {
  'CONTROL CENTER / 01': 'نمای کلی شبکه',
  'MANAGEMENT / OBJECTIVES': 'اهداف مدیریتی',
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
};

/** Maps internal section identifiers to concise Persian labels. */
export function pageSectionLabel(section: string): string {
  return pageSectionLabels[section] ?? section;
}
