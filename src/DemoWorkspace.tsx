import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowLeft, ArrowUpLeft, Boxes, Building2, CalendarDays,
  ChevronLeft, CircleAlert, ClipboardCheck, Clock3, CreditCard, Factory,
  FileText, Gauge, LayoutDashboard, ListChecks, MapPin, Menu, Package, RefreshCw,
  Search, ShieldCheck, Sparkles, Sun, Moon, Target, Truck, Users, Warehouse, X,
  type LucideIcon,
} from 'lucide-react';
import { api } from './lib/apiClient';
import { useAppTheme } from './lib/ThemeContext';
import { MedarLogo } from './MedarLogo';
import './demo-workspace.css';

type HealthResponse = { ok?: boolean; database?: boolean; service?: string };
type DemoStatus = 'good' | 'warn' | 'neutral' | 'bad';
type DemoRow = {
  id: string;
  primary: string;
  secondary: string;
  value: string;
  status: string;
  tone: DemoStatus;
  date: string;
};
type DemoNav = {
  key: string;
  label: string;
  description: string;
  group: string;
  icon: LucideIcon;
};

const navItems: DemoNav[] = [
  { key: 'command', label: 'مرکز فرمان', description: 'تصویر کلی از وضعیت عملیات، سفارش‌ها و فعالیت‌های روز جاری.', group: 'مدیریت', icon: LayoutDashboard },
  { key: 'orders', label: 'سفارش‌ها', description: 'پیگیری وضعیت سفارش از ثبت تا آماده‌سازی، ارسال و تحویل.', group: 'مدیریت', icon: FileText },
  { key: 'goals', label: 'اهداف و برنامه', description: 'هدف‌های دوره‌ای و میزان پیشرفت تیم در برابر برنامه.', group: 'مدیریت', icon: Target },
  { key: 'customers', label: 'مشتریان', description: 'حساب‌های سازمانی و اطلاعات تماس مشتریان.', group: 'فروش و تأمین', icon: Users },
  { key: 'suppliers', label: 'تأمین‌کنندگان', description: 'نمای یکپارچه از شرکا، ظرفیت و وضعیت همکاری تأمین‌کنندگان.', group: 'فروش و تأمین', icon: Factory },
  { key: 'products', label: 'کاتالوگ و قیمت', description: 'محصولات فعال، واحدها و قیمت‌های قابل ارائه.', group: 'فروش و تأمین', icon: Package },
  { key: 'purchase-orders', label: 'سفارش خرید و رسید', description: 'سفارش خرید، تأیید و ورود کالا به انبار.', group: 'فروش و تأمین', icon: FileText },
  { key: 'catalog', label: 'خرید سازمانی', description: 'مشاهده کاتالوگ برای ثبت درخواست خرید سازمانی.', group: 'خرید سازمانی', icon: Boxes },
  { key: 'farm-sites', label: 'سایت‌های مزرعه', description: 'نمای عملیاتی سایت‌ها، چرخه‌های پرورش و تولید روزانه.', group: 'تولید', icon: MapPin },
  { key: 'flock-cycles', label: 'چرخه‌های کشت و پرورش', description: 'چرخه‌های فعال، برنامه و وضعیت پرورش.', group: 'تولید', icon: Factory },
  { key: 'production-batches', label: 'بچ‌های تولید', description: 'ردیابی بچ‌های تولید و وضعیت هر مرحله.', group: 'تولید', icon: Boxes },
  { key: 'daily-production', label: 'ثبت روزانه تولید', description: 'ثبت گزارش روزانه و بررسی روند تولید.', group: 'تولید', icon: Activity },
  { key: 'inventory', label: 'موجودی و خرید', description: 'کنترل موجودی قابل استفاده، آستانه سفارش و ورود کالا.', group: 'عملیات', icon: Warehouse },
  { key: 'capacity', label: 'برنامه ظرفیت', description: 'ظرفیت‌های اعلام‌شده، تأییدشده و تعهدشده.', group: 'عملیات', icon: Warehouse },
  { key: 'quality', label: 'کیفیت و محموله', description: 'کنترل چک‌لیست‌ها، نتایج بازرسی و موارد نیازمند بررسی.', group: 'عملیات', icon: ClipboardCheck },
  { key: 'shipments', label: 'ارسال و تحویل', description: 'پیگیری وضعیت محموله‌ها، زمان تحویل و رخدادهای مسیر.', group: 'عملیات', icon: Truck },
  { key: 'task-templates', label: 'دستورالعمل‌های کاری', description: 'الگوها و چک‌لیست‌های اجرای کار.', group: 'وظایف و رخدادها', icon: ListChecks },
  { key: 'operational-tasks', label: 'وظایف عملیاتی', description: 'کارهای واگذارشده، موعدها و بررسی انجام کار.', group: 'وظایف و رخدادها', icon: ClipboardCheck },
  { key: 'incidents', label: 'رخدادها و مغایرت‌ها', description: 'ثبت و پیگیری مشکلات عملیاتی و موارد مغایر.', group: 'وظایف و رخدادها', icon: CircleAlert },
  { key: 'finance', label: 'مالی و تسویه', description: 'نمای فاکتورها، سررسیدها و وضعیت تطبیق داخلی حساب‌ها.', group: 'مشارکت و مالی', icon: CreditCard },
  { key: 'partnership-agreements', label: 'قراردادهای مشارکت', description: 'مشاهده چارچوب‌ها و وضعیت قراردادهای مشارکت.', group: 'مشارکت و مالی', icon: FileText },
  { key: 'partner-finance', label: 'دفتر مالی شریک', description: 'تراکنش‌ها و مانده‌های ثبت‌شده برای شرکا.', group: 'مشارکت و مالی', icon: CreditCard },
  { key: 'partner-settlements', label: 'دوره‌های تسویه', description: 'دوره‌های محاسبه و تطبیق تسویه.', group: 'مشارکت و مالی', icon: ClipboardCheck },
  { key: 'members', label: 'اعضا و دسترسی', description: 'نمای نقش‌های سازمانی و اصول دسترسی مبتنی بر عضویت.', group: 'کنترل', icon: Users },
  { key: 'audit', label: 'تاریخچه تغییرات', description: 'ثبت رخدادهای کلیدی برای قابلیت پیگیری و پاسخ‌گویی.', group: 'کنترل', icon: Activity },
  { key: 'my-orders', label: 'سفارش‌های من', description: 'وضعیت سفارش‌های ثبت‌شده برای حساب سازمانی.', group: 'خرید سازمانی', icon: FileText },
  { key: 'my-account', label: 'حساب سازمانی', description: 'مشخصات مجموعه خریدار و حساب جاری.', group: 'خرید سازمانی', icon: Building2 },
  { key: 'supplier-work', label: 'کارهای واگذارشده', description: 'فهرست کارهای اجرایی واگذارشده به تأمین‌کننده.', group: 'تأمین', icon: ClipboardCheck },
  { key: 'supplier-capacity', label: 'ظرفیت من', description: 'اعلام و پیگیری ظرفیت قابل ارائه.', group: 'تأمین', icon: Warehouse },
  { key: 'supplier-settlement', label: 'تسویه‌های من', description: 'اسناد و وضعیت تسویه‌های تأمین‌کننده.', group: 'تأمین', icon: CreditCard },
  { key: 'driver-work', label: 'محموله‌های من', description: 'محموله‌های تخصیص‌یافته به راننده.', group: 'ارسال', icon: Truck },
];

const orderRows: DemoRow[] = [
  { id: 'MD-2408', primary: 'سفارش تخم‌مرغ درجه A', secondary: 'شرکت سپهر پخش · ۵٬۰۰۰ شانه', value: '۱۲۸ میلیون تومان', status: 'در آماده‌سازی', tone: 'warn', date: 'امروز، ۱۰:۴۲' },
  { id: 'MD-2407', primary: 'سفارش خوراک طیور', secondary: 'تأمین دام گستر · ۲٫۴ تن', value: '۸۶ میلیون تومان', status: 'در حال بررسی', tone: 'neutral', date: 'امروز، ۰۹:۱۸' },
  { id: 'MD-2406', primary: 'محموله محصولات بسته‌بندی', secondary: 'پخش آریا · ۱٬۲۰۰ بسته', value: '۴۳٫۵ میلیون تومان', status: 'آماده ارسال', tone: 'good', date: 'دیروز، ۱۷:۵۰' },
  { id: 'MD-2405', primary: 'سفارش نهاده تولید', secondary: 'شرکت دانه‌طلایی · ۸۰۰ کیلوگرم', value: '۳۱ میلیون تومان', status: 'نیازمند بررسی', tone: 'bad', date: 'دیروز، ۱۵:۲۶' },
  { id: 'MD-2404', primary: 'تأمین بسته‌بندی', secondary: 'نگین صنعت · ۳٬۰۰۰ عدد', value: '۱۸٫۲ میلیون تومان', status: 'تحویل‌شده', tone: 'good', date: '۱۶ مهر، ۱۲:۱۰' },
];

const customerRows: DemoRow[] = [
  { id: 'CUS-021', primary: 'سپهر پخش', secondary: 'توزیع منطقه‌ای · گرگان', value: 'فعال', status: 'مجاز', tone: 'good', date: 'آخرین بررسی: نمونه' },
  { id: 'CUS-018', primary: 'پخش آریا', secondary: 'خریدار سازمانی · ساری', value: 'فعال', status: 'مجاز', tone: 'good', date: 'آخرین بررسی: نمونه' },
  { id: 'CUS-014', primary: 'بازرگانی شمال', secondary: 'مشتری عمده · گنبد', value: 'در بررسی', status: 'بررسی', tone: 'warn', date: 'اطلاعات نمونه' },
];
const productRows: DemoRow[] = [
  { id: 'PRD-031', primary: 'تخم‌مرغ درجه A', secondary: 'محصول بسته‌بندی‌شده · شانه', value: '۲۵٬۶۰۰ تومان', status: 'فعال', tone: 'good', date: 'قیمت نمونه' },
  { id: 'PRD-022', primary: 'خوراک رشد', secondary: 'نهاده تولید · کیلوگرم', value: '۳۵٬۸۰۰ تومان', status: 'فعال', tone: 'good', date: 'قیمت نمونه' },
  { id: 'PRD-016', primary: 'کارتن بسته‌بندی', secondary: 'ملزومات · عدد', value: '۱۲٬۴۰۰ تومان', status: 'نیازمند بررسی', tone: 'warn', date: 'قیمت نمونه' },
];
const purchaseOrderRows: DemoRow[] = [
  { id: 'PO-108', primary: 'خرید خوراک رشد', secondary: 'انبار مرکزی · سفارش سازمانی', value: '۸۶ میلیون تومان', status: 'منتظر تأیید', tone: 'warn', date: 'تاریخ نمونه' },
  { id: 'PO-106', primary: 'خرید بسته‌بندی', secondary: 'انبار محصولات · سفارش سازمانی', value: '۱۸٫۲ میلیون تومان', status: 'رسید جزئی', tone: 'neutral', date: 'تاریخ نمونه' },
];
const capacityRows: DemoRow[] = [
  { id: 'CAP-031', primary: 'ظرفیت تخم‌مرغ درجه A', secondary: 'سایت مرکزی · بازه هفتگی', value: '۵٬۰۰۰ شانه', status: 'تأییدشده', tone: 'good', date: 'بازه نمونه' },
  { id: 'CAP-029', primary: 'ظرفیت خوراک رشد', secondary: 'تأمین دام گستر · بازه هفتگی', value: '۲٫۴ تن', status: 'منتظر بررسی', tone: 'warn', date: 'بازه نمونه' },
];
const taskRows: DemoRow[] = [
  { id: 'TSK-038', primary: 'ثبت گزارش شیفت تولید', secondary: 'سایت مرکزی · مسئول عملیات', value: 'امروز', status: 'باز', tone: 'warn', date: 'موعد نمونه' },
  { id: 'TSK-035', primary: 'کنترل شرایط انبار', secondary: 'انبار مرکزی · چک‌لیست روزانه', value: 'امروز', status: 'در حال انجام', tone: 'neutral', date: 'موعد نمونه' },
  { id: 'TSK-031', primary: 'بررسی سفارش خرید', secondary: 'تیم تأمین · بررسی مدیر', value: 'اولویت بالا', status: 'منتظر بررسی', tone: 'bad', date: 'موعد نمونه' },
];
const productionRows: DemoRow[] = [
  { id: 'PRD-B-031', primary: 'بچ تولید سایت مرکزی', secondary: 'چرخه پاییز · واحد نمونه', value: '۴٬۸۲۰ کیلوگرم', status: 'در جریان', tone: 'good', date: 'گزارش نمونه' },
  { id: 'PRD-B-028', primary: 'بچ تولید سایت شرقی', secondary: 'چرخه فعال · واحد نمونه', value: '۳٬۶۵۰ کیلوگرم', status: 'تحت پایش', tone: 'warn', date: 'گزارش نمونه' },
];
const incidentRows: DemoRow[] = [
  { id: 'INC-014', primary: 'مغایرت موجودی ملزومات', secondary: 'انبار مرکزی · نیازمند تطبیق', value: 'متوسط', status: 'باز', tone: 'warn', date: 'زمان نمونه' },
  { id: 'INC-012', primary: 'تأخیر تحویل محموله', secondary: 'ارسال منطقه‌ای · بررسی علت', value: 'بالا', status: 'در حال پیگیری', tone: 'bad', date: 'زمان نمونه' },
];
const agreementRows: DemoRow[] = [
  { id: 'AGR-006', primary: 'قرارداد مشارکت سایت مرکزی', secondary: 'نسخه نمایشی قرارداد · بدون اثر حقوقی', value: 'در بررسی', status: 'پیش‌نویس', tone: 'neutral', date: 'تاریخ نمونه' },
  { id: 'AGR-004', primary: 'توافق تأمین دوره‌ای', secondary: 'شرایط تحویل و کیفیت', value: 'فعال', status: 'ثبت نمونه', tone: 'good', date: 'تاریخ نمونه' },
];
const partnerFinanceRows: DemoRow[] = [
  { id: 'PFIN-011', primary: 'ثبت سهم دوره تولید', secondary: 'دفتر شریک · ثبت آزمایشی', value: '۴۸ میلیون تومان', status: 'در انتظار تطبیق', tone: 'warn', date: 'دوره نمونه' },
];
const settlementRows: DemoRow[] = [
  { id: 'SET-087', primary: 'تسویه تأمین‌کننده', secondary: 'دوره نیمه اول مهر · سند نمونه', value: '۴۸ میلیون تومان', status: 'منتظر تطبیق', tone: 'warn', date: 'دوره نمونه' },
];
const accountRows: DemoRow[] = [
  { id: 'ACC-001', primary: 'حساب سازمانی نمونه', secondary: 'نمایش معرفی مدار · بدون اتصال به حساب واقعی', value: 'نمونه', status: 'فقط‌خواندنی', tone: 'neutral', date: 'بدون اطلاعات واقعی' },
];

const rowsByPage: Record<string, DemoRow[]> = {
  orders: orderRows,
  suppliers: [
    { id: 'SUP-018', primary: 'تأمین دام گستر', secondary: 'خوراک و نهاده · گرگان', value: '۹۲٪', status: 'فعال', tone: 'good', date: 'آخرین ارزیابی: ۱۴ مهر' },
    { id: 'SUP-014', primary: 'نگین صنعت', secondary: 'بسته‌بندی و ملزومات · ساری', value: '۸۶٪', status: 'فعال', tone: 'good', date: 'آخرین ارزیابی: ۱۲ مهر' },
    { id: 'SUP-011', primary: 'دانه‌طلایی', secondary: 'مواد اولیه تولید · گنبد', value: '۷۱٪', status: 'نیازمند بررسی', tone: 'warn', date: 'آخرین ارزیابی: ۱۰ مهر' },
    { id: 'SUP-008', primary: 'پخش شمال', secondary: 'حمل و توزیع · گرگان', value: '۹۷٪', status: 'فعال', tone: 'good', date: 'آخرین ارزیابی: ۹ مهر' },
  ],
  'farm-sites': [
    { id: 'SITE-01', primary: 'سایت مرکزی', secondary: 'چرخه فعال: ۳ · ظرفیت: ۱۲٬۰۰۰ قطعه', value: '۸۴٪', status: 'عملیاتی', tone: 'good', date: 'ثبت روزانه: امروز' },
    { id: 'SITE-02', primary: 'سایت شرقی', secondary: 'چرخه فعال: ۲ · ظرفیت: ۸٬۵۰۰ قطعه', value: '۶۸٪', status: 'عملیاتی', tone: 'good', date: 'ثبت روزانه: امروز' },
    { id: 'SITE-03', primary: 'سایت توسعه', secondary: 'چرخه فعال: ۱ · ظرفیت: ۶٬۰۰۰ قطعه', value: '۴۱٪', status: 'تحت پایش', tone: 'warn', date: 'نیازمند بازبینی برنامه' },
  ],
  inventory: [
    { id: 'INV-104', primary: 'خوراک رشد', secondary: 'انبار مرکزی · واحد: کیلوگرم', value: '۲٬۸۴۰', status: 'موجود', tone: 'good', date: 'حد سفارش: ۱٬۰۰۰' },
    { id: 'INV-103', primary: 'کارتن بسته‌بندی', secondary: 'انبار محصولات · واحد: عدد', value: '۶۲۰', status: 'رو به اتمام', tone: 'warn', date: 'حد سفارش: ۸۰۰' },
    { id: 'INV-102', primary: 'مکمل ویتامینه', secondary: 'انبار نهاده · واحد: بسته', value: '۳۸۰', status: 'موجود', tone: 'good', date: 'حد سفارش: ۱۵۰' },
    { id: 'INV-101', primary: 'ملزومات بهداشتی', secondary: 'انبار مرکزی · واحد: عدد', value: '۴۸', status: 'نیازمند سفارش', tone: 'bad', date: 'حد سفارش: ۱۰۰' },
  ],
  quality: [
    { id: 'QC-221', primary: 'کنترل بسته‌بندی', secondary: 'محموله MD-2406 · چک‌لیست خروج', value: '۱۰۰٪', status: 'تأیید اولیه', tone: 'good', date: 'امروز، ۱۰:۰۲' },
    { id: 'QC-220', primary: 'بازرسی خوراک', secondary: 'ورودی انبار · نمونه‌برداری', value: '۸۷٪', status: 'در انتظار بررسی', tone: 'warn', date: 'امروز، ۰۹:۳۱' },
    { id: 'QC-219', primary: 'ثبت دمای نگهداری', secondary: 'سایت مرکزی · کنترل روزانه', value: 'مجاز', status: 'تکمیل‌شده', tone: 'good', date: 'امروز، ۰۸:۴۷' },
  ],
  shipments: [
    { id: 'SHP-077', primary: 'ارسال محصولات بسته‌بندی', secondary: 'راننده نمونه · مقصد: ساری', value: '۱٬۲۰۰ بسته', status: 'در مسیر', tone: 'warn', date: 'تحویل پیش‌بینی: ۱۴:۳۰' },
    { id: 'SHP-076', primary: 'سفارش مشتری سپهر', secondary: 'مقصد: گرگان · محموله MD-2408', value: '۵٬۰۰۰ شانه', status: 'آماده بارگیری', tone: 'neutral', date: 'برنامه: امروز' },
    { id: 'SHP-075', primary: 'تأمین بسته‌بندی', secondary: 'مبدأ: ساری · مقصد: انبار مرکزی', value: '۳٬۰۰۰ عدد', status: 'تحویل‌شده', tone: 'good', date: '۱۶ مهر، ۱۲:۱۰' },
  ],
  finance: [
    { id: 'INV-140', primary: 'فاکتور فروش MD-2408', secondary: 'مشتری: سپهر پخش', value: '۱۲۸ میلیون', status: 'سررسید نزدیک', tone: 'warn', date: 'سررسید: ۲۰ مهر' },
    { id: 'SET-087', primary: 'تسویه تأمین دام گستر', secondary: 'مرجع: دوره نیمه اول مهر', value: '۴۸ میلیون', status: 'در انتظار تطبیق', tone: 'neutral', date: 'ثبت: ۱۵ مهر' },
    { id: 'INV-138', primary: 'فاکتور فروش MD-2406', secondary: 'مشتری: پخش آریا', value: '۴۳٫۵ میلیون', status: 'تطبیق‌شده', tone: 'good', date: '۱۶ مهر، ۱۱:۲۰' },
  ],
  goals: [
    { id: 'GOAL-01', primary: 'تحویل به‌موقع سفارش‌ها', secondary: 'هدف دوره: ۹۵٪', value: '۹۴٪', status: 'نزدیک به هدف', tone: 'warn', date: 'به‌روزرسانی: نمونه' },
    { id: 'GOAL-02', primary: 'ثبت روزانه تولید', secondary: 'هدف: ثبت همه شیفت‌ها', value: '۹۸٪', status: 'در مسیر', tone: 'good', date: 'به‌روزرسانی: نمونه' },
    { id: 'GOAL-03', primary: 'تطبیق مالی دوره', secondary: 'هدف: بستن مغایرت‌ها', value: '۷۶٪', status: 'نیازمند پیگیری', tone: 'warn', date: 'به‌روزرسانی: نمونه' },
  ],
  members: [
    { id: 'USR-001', primary: 'مدیر مجموعه', secondary: 'مالک فضای کاری · دسترسی کامل', value: 'مالک', status: 'فعال', tone: 'good', date: 'آخرین ورود: نمونه' },
    { id: 'USR-002', primary: 'کارشناس عملیات', secondary: 'سفارش، تولید و کیفیت', value: 'کارمند', status: 'فعال', tone: 'good', date: 'آخرین ورود: نمونه' },
    { id: 'USR-003', primary: 'مسئول تأمین', secondary: 'ظرفیت و کارهای واگذارشده', value: 'تأمین‌کننده', status: 'دعوت‌شده', tone: 'neutral', date: 'منتظر پذیرش دعوت' },
  ],
  audit: [
    { id: 'EVT-184', primary: 'تغییر وضعیت سفارش', secondary: 'MD-2408 · در آماده‌سازی', value: 'سفارش', status: 'ثبت‌شده', tone: 'good', date: 'امروز، ۱۰:۴۲' },
    { id: 'EVT-183', primary: 'ثبت کنترل کیفیت', secondary: 'QC-221 · چک‌لیست خروج', value: 'کیفیت', status: 'ثبت‌شده', tone: 'good', date: 'امروز، ۱۰:۰۲' },
    { id: 'EVT-182', primary: 'به‌روزرسانی ظرفیت سایت', secondary: 'SITE-02 · چرخه فعال', value: 'تولید', status: 'ثبت‌شده', tone: 'good', date: 'امروز، ۰۹:۵۶' },
    { id: 'EVT-181', primary: 'ثبت دریافت نهاده', secondary: 'INV-104 · انبار مرکزی', value: 'انبار', status: 'ثبت‌شده', tone: 'good', date: 'امروز، ۰۹:۱۸' },
  ],

  customers: customerRows,
  products: productRows,
  catalog: productRows,
  'purchase-orders': purchaseOrderRows,
  capacity: capacityRows,
  'supplier-capacity': capacityRows,
  'flock-cycles': productionRows,
  'production-batches': productionRows,
  'daily-production': productionRows,
  'task-templates': taskRows,
  'operational-tasks': taskRows,
  'supplier-work': taskRows,
  incidents: incidentRows,
  'partnership-agreements': agreementRows,
  'partner-finance': partnerFinanceRows,
  'partner-settlements': settlementRows,
  'supplier-settlement': settlementRows,
  'my-orders': orderRows,
  'my-account': accountRows,
  'driver-work': [
    { id: 'DRV-022', primary: 'محموله MD-2406', secondary: 'مقصد: ساری · جزئیات نمونه', value: '۱٬۲۰۰ بسته', status: 'در مسیر', tone: 'warn', date: 'تحویل نمونه' },
    { id: 'DRV-021', primary: 'محموله MD-2404', secondary: 'مبدأ: ساری · مقصد: گرگان', value: '۳٬۰۰۰ عدد', status: 'تحویل‌شده', tone: 'good', date: 'زمان نمونه' },
  ],
};
const groupOrder = ['مدیریت', 'فروش و تأمین', 'تولید', 'عملیات', 'وظایف و رخدادها', 'مشارکت و مالی', 'کنترل', 'خرید سازمانی', 'تأمین', 'ارسال'];

const statCards = [
  { label: 'سفارش‌های باز', value: '۱۲', detail: '۳ مورد نیازمند پیگیری', icon: FileText, tone: 'teal' },
  { label: 'تولید ثبت‌شده امروز', value: '۴٬۸۲۰', detail: 'کیلوگرم · در ۳ سایت', icon: Factory, tone: 'blue' },
  { label: 'تحویل به‌موقع', value: '۹۴٪', detail: 'هدف دوره: ۹۵٪', icon: Truck, tone: 'gold' },
  { label: 'موارد نیازمند بررسی', value: '۰۳', detail: 'کیفیت، موجودی و تسویه', icon: CircleAlert, tone: 'rose' },
];
const chartValues = [
  { day: 'شنبه', value: 58 }, { day: 'یکشنبه', value: 72 }, { day: 'دوشنبه', value: 64 },
  { day: 'سه‌شنبه', value: 84 }, { day: 'چهارشنبه', value: 76 }, { day: 'پنجشنبه', value: 92 },
  { day: 'جمعه', value: 68 },
];

export default function DemoWorkspace() {
  const { theme, setTheme } = useAppTheme();
  const [activePage, setActivePage] = useState('command');
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const page = navItems.find((item) => item.key === activePage) ?? navItems[0];
  const PageIcon = page.icon;

  const checkHealth = useCallback(async () => {
    setHealth('checking');
    try {
      const result = await api.get<HealthResponse>('/api/health');
      setHealth(result.ok === true && result.database === true ? 'online' : 'offline');
    } catch {
      setHealth('offline');
    } finally {
      setLastChecked(new Date());
    }
  }, []);

  useEffect(() => { void checkHealth(); }, [checkHealth]);


  const visibleRows = useMemo(() => {
    const rows = activePage === 'command' ? orderRows : (rowsByPage[activePage] ?? []);
    const query = search.trim().toLocaleLowerCase('fa-IR');
    if (!query) return rows;
    return rows.filter((row) => `${row.id} ${row.primary} ${row.secondary} ${row.value} ${row.status}`.toLocaleLowerCase('fa-IR').includes(query));
  }, [activePage, search]);

  function selectPage(key: string) {
    setActivePage(key);
    setSearch('');
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const dateLabel = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full' }).format(new Date());

  return (
    <div className="demo-workspace" dir="rtl">
      {sidebarOpen && <button className="demo-sidebar-scrim" aria-label="بستن منوی ناوبری" onClick={() => setSidebarOpen(false)} />}
      <aside className={`demo-sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <div className="demo-brand-row"><MedarLogo/><button className="demo-mobile-close" onClick={() => setSidebarOpen(false)} aria-label="بستن منو"><X size={19}/></button></div>
        <div className="demo-workspace-switch"><span className="demo-workspace-avatar"><Building2 size={19}/></span><span><b>مجموعه نمونه مدار</b><small>فضای کاری نمایشی</small></span><ChevronLeft size={15}/></div>
        <div className="demo-env-badge"><span className="demo-env-dot"/>دموی قابل ارائه <span className="demo-env-ltr">PREVIEW</span></div>
        <nav className="demo-nav" aria-label="ناوبری فضای کاری">
          {groupOrder.map((group) => {
            const groupItems = navItems.filter((item) => item.group === group);
            return <div className="demo-nav-group" key={group}>
              <span className="demo-nav-label">{group}</span>
              {groupItems.map((item) => {
                const Icon = item.icon;
                return <button key={item.key} type="button" className={`demo-nav-item ${activePage === item.key ? 'is-active' : ''}`} onClick={() => selectPage(item.key)} aria-current={activePage === item.key ? 'page' : undefined}>
                  <Icon size={18} strokeWidth={activePage === item.key ? 2.2 : 1.75}/><span>{item.label}</span>{activePage === item.key && <span className="demo-nav-active-mark"/>}
                </button>;
              })}
            </div>;
          })}
        </nav>
        <div className="demo-sidebar-foot">
          <div className="demo-side-health"><span className={`demo-health-dot ${health}`}/><div><b>{health === 'online' ? 'سرویس اصلی آنلاین' : health === 'checking' ? 'در حال بررسی اتصال' : 'سرویس بررسی نشد'}</b><small>{health === 'online' ? 'Worker و پایگاه‌داده پاسخ می‌دهند' : health === 'checking' ? 'بررسی واقعی API' : 'نمایش نمونه مستقل از API'}</small></div></div>
          <div className="demo-profile"><span className="demo-profile-avatar">م</span><span><b>دموی معرفی مدار</b><small>دسترسی فقط‌خواندنی</small></span><ShieldCheck size={17}/></div>
        </div>
      </aside>

      <main className="demo-main">
        <header className="demo-topbar">
          <div className="demo-topbar-title">
            <button className="demo-menu-button" onClick={() => setSidebarOpen(true)} aria-label="بازکردن منوی ناوبری"><Menu size={20}/></button>
            <div className="demo-breadcrumb"><span>مدار</span><ChevronLeft size={14}/><b>{page.label}</b></div>
          </div>
          <div className="demo-topbar-tools">
            <label className="demo-search"><Search size={17}/><input aria-label="جست‌وجو در داده‌های نمونه" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجو در این بخش…"/><kbd>⌘ K</kbd></label>
            <button className="demo-icon-button demo-theme-toggle" type="button" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'light'} aria-label={theme === 'dark' ? 'فعال‌کردن حالت روشن' : 'فعال‌کردن حالت تاریک'} title={theme === 'dark' ? 'فعال‌کردن حالت روشن' : 'فعال‌کردن حالت تاریک'}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button>
            <button className="demo-icon-button" onClick={() => void checkHealth()} aria-label="بررسی دوباره اتصال API" title="بررسی اتصال API"><RefreshCw size={17} className={health === 'checking' ? 'demo-spin' : ''}/></button>
            <span className="demo-topbar-divider"/>
            <div className="demo-date"><CalendarDays size={16}/><span>{dateLabel}</span></div>
          </div>
        </header>

        <div className="demo-content">
          <section className="demo-preview-notice" role="status">
            <span className="demo-preview-notice-icon"><ShieldCheck size={18}/></span>
            <div><b>محیط نمایشی — داده‌های این صفحه نمونه هستند</b><p>این نسخه برای معرفی محصول است؛ ثبت سفارش، پرداخت، حذف و هرگونه تغییر در اطلاعات عملیاتی عمداً غیرفعال است.</p></div>
            <span className="demo-preview-chip">READ ONLY</span>
          </section>

          {activePage === 'command' ? (
            <>
              <div className="demo-page-heading">
                <div><span className="demo-eyebrow"><span/>MEDAR / OPERATIONS OVERVIEW</span><h1>عملیات، در یک نگاه.</h1><p>نمایی یکپارچه از سفارش، تولید، موجودی و تحویل؛ بدون جابه‌جایی بین فایل‌ها و پیام‌ها.</p></div>
                <button className="demo-secondary-button" onClick={() => selectPage('orders')}>رفتن به سفارش‌ها <ArrowLeft size={16}/></button>
              </div>
              <section className="demo-stats-grid" aria-label="شاخص‌های نمونه">
                {statCards.map((stat) => { const Icon = stat.icon; return <article className="demo-stat-card" key={stat.label}>
                  <div className="demo-stat-top"><span>{stat.label}</span><i className={`demo-stat-icon ${stat.tone}`}><Icon size={19}/></i></div>
                  <b className="demo-stat-value">{stat.value}</b><small>{stat.detail}</small>
                  <span className="demo-stat-sample">شاخص نمایشی</span>
                </article>; })}
              </section>

              <section className="demo-quick-access" aria-label="دسترسی سریع">
                <div className="demo-quick-heading">
                  <span className="demo-quick-heading-mark"><Sparkles size={17}/></span>
                  <div><b>دسترسی سریع</b><small>میانبرهای اصلی عملیات مدار</small></div>
                  <span className="demo-quick-count">۴ میانبر</span>
                </div>
                <div className="demo-quick-grid">
                  <button type="button" className="demo-quick-action" onClick={() => selectPage('orders')}><span><FileText size={18}/></span><b>سفارش‌ها</b><small>ثبت و پیگیری</small><ArrowLeft size={14}/></button>
                  <button type="button" className="demo-quick-action" onClick={() => selectPage('farm-sites')}><span><Factory size={18}/></span><b>تولید و مزرعه</b><small>سایت‌ها و برنامه تولید</small><ArrowLeft size={14}/></button>
                  <button type="button" className="demo-quick-action" onClick={() => selectPage('shipments')}><span><Truck size={18}/></span><b>ارسال و تحویل</b><small>محموله‌ها و مقصد</small><ArrowLeft size={14}/></button>
                  <button type="button" className="demo-quick-action" onClick={() => selectPage('finance')}><span><CreditCard size={18}/></span><b>مالی و تسویه</b><small>فاکتورها و تطبیق</small><ArrowLeft size={14}/></button>
                </div>
              </section>
              <div className="demo-dashboard-grid">
                <section className="demo-panel demo-trend-panel">
                  <div className="demo-panel-heading"><div><span className="demo-panel-mark"><Gauge size={17}/></span><div><h2>روند عملیات هفتگی</h2><p>شاخص ترکیبی تکمیل کارها · داده نمونه</p></div></div><span className="demo-period-chip">۷ روز گذشته <ChevronLeft size={13}/></span></div>
                  <div className="demo-chart-summary"><div><span>میانگین تکمیل</span><b>۷۳٫۴٪</b></div><span className="demo-chart-trend"><ArrowUpLeft size={15}/> ۸٪ <small>نسبت به هفته قبل</small></span></div>
                  <div className="demo-bar-chart" role="img" aria-label="نمودار نمایشی روند عملیات در هفت روز هفته">
                    {chartValues.map((item) => <div className="demo-bar-column" key={item.day}><b>{item.value}٪</b><span className="demo-bar-track"><i style={{ height: `${item.value}%` }}/></span><small>{item.day}</small></div>)}
                  </div>
                  <div className="demo-chart-foot"><span><i/> تکمیل وظایف ثبت‌شده</span><span>منبع: داده نمایشی</span></div>
                </section>
                <section className="demo-panel demo-focus-panel">
                  <div className="demo-panel-heading"><div><span className="demo-panel-mark gold"><ListChecks size={17}/></span><div><h2>موارد نیازمند توجه</h2><p>اولویت‌های پیشنهادی برای پیگیری</p></div></div><span className="demo-count-chip">۳ مورد</span></div>
                  <div className="demo-focus-list">
                    <div className="demo-focus-item"><span className="demo-focus-symbol danger"><CircleAlert size={17}/></span><span><b>موجودی ملزومات بهداشتی</b><small>رسیدن به حد سفارش · انبار مرکزی</small></span><span className="demo-focus-priority danger">بالا</span></div>
                    <div className="demo-focus-item"><span className="demo-focus-symbol gold"><Clock3 size={17}/></span><span><b>تطبیق فاکتور تأمین‌کننده</b><small>نیازمند تأیید سند · مالی</small></span><span className="demo-focus-priority gold">متوسط</span></div>
                    <div className="demo-focus-item"><span className="demo-focus-symbol blue"><Truck size={17}/></span><span><b>برنامه تحویل سفارش MD-2408</b><small>هماهنگی با مقصد و زمان بارگیری</small></span><span className="demo-focus-priority blue">پیگیری</span></div>
                  </div>
                  <div className="demo-focus-foot"><Sparkles size={15}/><span>در نسخه عملیاتی، فهرست براساس وضعیت واقعی داده‌ها محاسبه می‌شود.</span></div>
                </section>
              </div>
              <section className="demo-panel demo-orders-panel">
                <div className="demo-panel-heading"><div><span className="demo-panel-mark"><FileText size={17}/></span><div><h2>آخرین سفارش‌ها</h2><p>نمونه گردش سفارش از ثبت تا ارسال</p></div></div><button className="demo-text-button" onClick={() => selectPage('orders')}>مشاهده همه <ArrowLeft size={15}/></button></div>
                <DemoTable rows={visibleRows} empty={search ? 'با این عبارت در داده‌های نمونه نتیجه‌ای پیدا نشد.' : 'سفارشی برای نمایش وجود ندارد.'}/>
              </section>
              <div className="demo-bottom-grid">
                <section className="demo-mini-panel"><span className="demo-mini-icon"><Factory size={19}/></span><div><small>تولید و سایت‌ها</small><b>۳ سایت نمایشی</b><span>ثبت برنامه، چرخه و تولید روزانه</span></div><button onClick={() => selectPage('farm-sites')} aria-label="مشاهده سایت‌های مزرعه"><ArrowLeft size={17}/></button></section>
                <section className="demo-mini-panel"><span className="demo-mini-icon blue"><Truck size={19}/></span><div><small>ارسال و تحویل</small><b>۲ محموله در جریان</b><span>وضعیت، مقصد و زمان تحویل</span></div><button onClick={() => selectPage('shipments')} aria-label="مشاهده محموله‌ها"><ArrowLeft size={17}/></button></section>
                <section className="demo-mini-panel"><span className="demo-mini-icon gold"><CreditCard size={19}/></span><div><small>مالی و تسویه</small><b>۳ سند نمونه</b><span>سررسید و تطبیق داخلی</span></div><button onClick={() => selectPage('finance')} aria-label="مشاهده امور مالی"><ArrowLeft size={17}/></button></section>
              </div>
            </>
          ) : (
            <>
              <div className="demo-page-heading">
                <div><span className="demo-eyebrow"><span/>{page.group.toUpperCase()} / MEDAR</span><h1>{page.label}</h1><p>{page.description}</p></div>
                <span className="demo-read-only-badge"><ShieldCheck size={15}/> فقط‌خواندنی</span>
              </div>
              <div className="demo-module-summary">
                <div><span className="demo-module-summary-icon"><PageIcon size={21}/></span><div><small>بخش انتخاب‌شده</small><b>{page.label}</b><span>نمونه رابط کاربری برای بررسی توسط تیم شما</span></div></div>
                <div className="demo-module-summary-side"><span>رکورد قابل مشاهده</span><b>{visibleRows.length.toLocaleString('fa-IR')}</b></div>
              </div>
              <section className="demo-panel demo-orders-panel">
                <div className="demo-panel-heading"><div><span className="demo-panel-mark"><PageIcon size={17}/></span><div><h2>فهرست {page.label}</h2><p>اطلاعات نمونه؛ هیچ رکوردی از شرکت شما در این جدول نیست</p></div></div><span className="demo-sample-chip">داده نمونه</span></div>
                <DemoTable rows={visibleRows} empty={search ? 'با این عبارت در داده‌های نمونه نتیجه‌ای پیدا نشد.' : 'داده نمونه‌ای برای این بخش تعریف نشده است.'}/>
              </section>
              <div className="demo-info-panel"><ShieldCheck size={18}/><div><b>این بخش در نسخه عملیاتی چگونه کار می‌کند؟</b><p>پس از ورود معتبر و انتخاب فضای کاری، فقط اطلاعات مجاز همان مجموعه از API و پایگاه‌داده خوانده می‌شود. عملیات تغییر اطلاعات تا فعال‌شدن نسخه واقعی در این دموی معرفی خاموش است.</p></div></div>
            </>
          )}

          <footer className="demo-footer"><span><MedarLogo compact/> مدار <i/> دموی تعاملی</span><span>{lastChecked ? `آخرین بررسی API: ${new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(lastChecked)}` : 'در انتظار بررسی API'} <i/> مقادیر عملیاتی، نمونه هستند</span></footer>
        </div>
      </main>
      <nav className="demo-mobile-bottom-nav" aria-label="ناوبری اصلی موبایل">
        <button type="button" className={activePage === 'command' ? 'is-active' : ''} onClick={() => selectPage('command')} aria-current={activePage === 'command' ? 'page' : undefined}><LayoutDashboard size={20}/><span>نمای کلی</span></button>
        <button type="button" className={activePage === 'orders' ? 'is-active' : ''} onClick={() => selectPage('orders')} aria-current={activePage === 'orders' ? 'page' : undefined}><FileText size={20}/><span>سفارش‌ها</span></button>
        <button type="button" className={['farm-sites', 'flock-cycles', 'production-batches', 'daily-production', 'inventory', 'capacity', 'quality', 'shipments', 'task-templates', 'operational-tasks', 'incidents'].includes(activePage) ? 'is-active' : ''} onClick={() => selectPage('operational-tasks')} aria-current={['farm-sites', 'flock-cycles', 'production-batches', 'daily-production', 'inventory', 'capacity', 'quality', 'shipments', 'task-templates', 'operational-tasks', 'incidents'].includes(activePage) ? 'page' : undefined}><Factory size={20}/><span>عملیات</span></button>
        <button type="button" className={!['command', 'orders', 'farm-sites', 'flock-cycles', 'production-batches', 'daily-production', 'inventory', 'capacity', 'quality', 'shipments', 'task-templates', 'operational-tasks', 'incidents'].includes(activePage) ? 'is-active' : ''} onClick={() => setSidebarOpen(true)} aria-label="بازکردن فهرست ماژول‌ها"><Menu size={20}/><span>ماژول‌ها</span></button>
      </nav>
    </div>
  );
}

function DemoTable({ rows, empty }: { rows: DemoRow[]; empty: string }) {
  if (!rows.length) return <div className="demo-empty"><Search size={24}/><b>نتیجه‌ای پیدا نشد</b><p>{empty}</p></div>;
  return <div className="demo-table-scroll"><table className="demo-table"><thead><tr><th>شناسه</th><th>عنوان / جزئیات</th><th>مبلغ یا شاخص</th><th>وضعیت</th><th>زمان / توضیحات</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
    <td><code>{row.id}</code></td><td><b>{row.primary}</b><small>{row.secondary}</small></td><td className="demo-table-value">{row.value}</td><td><span className={`demo-status ${row.tone}`}><i/>{row.status}</span></td><td className="demo-table-date">{row.date}</td>
  </tr>)}</tbody></table></div>;
}
