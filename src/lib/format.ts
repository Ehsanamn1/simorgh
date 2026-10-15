export const numberFa = (value: number | string | null | undefined) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(Number(value ?? 0));
export const moneyFa = (value: number | string | null | undefined) => `${numberFa(value)} تومان`;
export const dateFa = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(new Date(value)) : '—';
export const dateTimeFa = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
export const roleLabel: Record<string, string> = { owner: 'مالک', admin: 'مدیر', staff: 'کارشناس عملیات', customer: 'مشتری سازمانی', supplier: 'تأمین‌کننده', driver: 'راننده' };
export const orderLabel: Record<string, string> = { draft: 'پیش‌نویس', submitted: 'ثبت‌شده', confirmed: 'تأییدشده', allocated: 'تخصیص تأمین', in_fulfillment: 'در حال آماده‌سازی', dispatched: 'ارسال‌شده', delivered: 'تحویل‌شده', cancelled: 'لغوشده' };
export const statusLabel: Record<string, string> = { declared: 'اعلام‌شده', confirmed: 'تأییدشده', committed: 'متعهدشده', released: 'آزادشده', cancelled: 'لغوشده', pending_review: 'در انتظار بازبینی', released_lot: 'تأییدشده برای مصرف', on_hold: 'متوقف', rejected: 'ردشده', consumed: 'مصرف‌شده', planned: 'برنامه‌ریزی‌شده', loading: 'بارگیری', in_transit: 'در مسیر', arrived: 'رسیده به مقصد', delivered: 'تحویل‌شده', failed: 'ناموفق', returned: 'مرجوع‌شده', draft_invoice: 'پیش‌نویس', issued: 'صادرشده', partially_paid: 'پرداخت ناقص', paid: 'تسویه‌شده', overdue: 'سررسیدگذشته', void: 'باطل', pending: 'در انتظار', approved: 'تأیید پرداخت', disputed: 'دارای اختلاف', pass: 'قبول', conditional: 'مشروط', fail: 'رد' };
export const statusTone = (value: unknown) => {
  const s = String(value ?? '').toLowerCase();
  if (['delivered','paid','released','approved','pass','confirmed','active'].includes(s)) return 'good';
  if (['cancelled','rejected','failed','overdue','disputed','fail'].includes(s)) return 'bad';
  if (['pending','submitted','draft','declared','pending_review','on_hold','loading','arrived','conditional','partially_paid'].includes(s)) return 'warn';
  return 'neutral';
};
