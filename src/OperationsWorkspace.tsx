import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowLeft, ArrowUpLeft, BarChart3, Bell,
  Boxes, Camera, CheckCircle2, ClipboardCheck, Clock3,
  CreditCard, Factory, FileText, Gauge, Home, Layers3, Map, MapPin, Menu, Moon,
  Package, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Sun, Target, Truck, Users, Warehouse, X,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SimorghLogo } from './SimorghLogo';

type WorkspacePage =
  | 'command' | 'orders' | 'farm' | 'driver' | 'customer' | 'finance'
  | 'map' | 'intelligence' | 'inventory' | 'quality' | 'partners' | 'settings';

const pageInfo: Record<WorkspacePage, { title: string; eyebrow: string; description: string; icon: typeof Home }> = {
  command: { title: 'مرکز فرمان شبکه', eyebrow: 'مرکز فرمان مدیریتی', description: 'تصویر یکپارچه‌ی سفارش، تولید، کیفیت، ارسال و جریان مالی شبکه.', icon: Gauge },
  orders: { title: 'سفارش‌ها', eyebrow: 'مدیریت سفارش‌ها', description: 'وضعیت واقعی سفارش، موعد تحویل، مسئول پیگیری و تاریخچه‌ی تغییرات.', icon: FileText },
  farm: { title: 'فضای شریک مزرعه', eyebrow: 'اپ مزرعه', description: 'کارهای امروز، ثبت تولید، مدرک تصویری و صورت‌وضعیت همکاری.', icon: Factory },
  driver: { title: 'فضای راننده و حمل', eyebrow: 'اپ حمل و تحویل', description: 'محموله‌ی تخصیص‌یافته، مراحل سفر، وضعیت موقعیت و مدرک تحویل.', icon: Truck },
  customer: { title: 'فضای مشتری سازمانی', eyebrow: 'پرتال مشتریان', description: 'کاتالوگ واقعی، ثبت سفارش، پیگیری ارسال و اسناد حساب.', icon: Boxes },
  finance: { title: 'مالی و تسویه‌ی مشارکت', eyebrow: 'حسابداری و تسویه‌ی شرکا', description: 'دفتر شفاف قرارداد، دوره‌ی مالی، هزینه‌ی موردتأیید و تسویه‌ی نهایی.', icon: CreditCard },
  map: { title: 'نقشه‌ی راهنمای شبکه', eyebrow: 'نقشه و ارسال', description: 'نقشه‌ی جغرافیایی برای راهنمایی؛ نشانگر محموله فقط از مختصات واقعی دیتابیس ساخته می‌شود.', icon: Map },
  intelligence: { title: 'هوش عملیاتی', eyebrow: 'هوش عملیاتی', description: 'پیشنهادهای قابل‌پیگیری با منبع داده، سطح اطمینان و تأیید مدیر.', icon: Sparkles },
  inventory: { title: 'انبار و ثبت خرید', eyebrow: 'انبار و خرید', description: 'مانده‌ی محاسبه‌شده، رسید خرید، گردش کالا و جلوگیری از موجودی منفی.', icon: Warehouse },
  quality: { title: 'کیفیت و مدارک', eyebrow: 'کیفیت و مستندات', description: 'ثبت عکس و مدرک، بررسی مغایرت و ردیابی مسئول رسیدگی.', icon: ClipboardCheck },
  partners: { title: 'شرکا و ظرفیت', eyebrow: 'شبکه‌ی همکاران', description: 'ظرفیت تأییدشده، تعهدات و وضعیت مشارکت هر مجموعه.', icon: Users },
  settings: { title: 'تنظیمات سامانه', eyebrow: 'تنظیمات سامانه', description: 'ترجیحات نمایش؛ پیکربندی عملیاتی پس از فعال‌شدن دسترسی مدیر انجام می‌شود.', icon: Settings2 },
};

const navGroups: { title: string; items: { key: WorkspacePage; label: string; icon: typeof Home }[] }[] = [
  { title: 'مدیریت', items: [{ key: 'command', label: 'داشبورد مدیریتی', icon: Gauge }, { key: 'orders', label: 'سفارش‌ها', icon: FileText }, { key: 'partners', label: 'شرکا و ظرفیت', icon: Users }] },
  { title: 'عملیات', items: [{ key: 'farm', label: 'تولید و وظایف مزرعه', icon: Factory }, { key: 'quality', label: 'کیفیت و مدارک', icon: ClipboardCheck }, { key: 'driver', label: 'حمل و تحویل', icon: Truck }, { key: 'inventory', label: 'انبار و ثبت خرید', icon: Warehouse }] },
  { title: 'کنترل و هوشمندی', items: [{ key: 'finance', label: 'مالی و تسویه', icon: CreditCard }, { key: 'intelligence', label: 'پیشنهادهای هوشمند', icon: Sparkles }, { key: 'map', label: 'نقشه و راهنما', icon: Map }, { key: 'settings', label: 'تنظیمات', icon: Settings2 }] },
];

const routeToPage = (pathname: string, search: string): WorkspacePage => {
  const queryPage = new URLSearchParams(search).get('module');
  if (queryPage && Object.prototype.hasOwnProperty.call(pageInfo, queryPage)) return queryPage as WorkspacePage;
  const tail = pathname.split('/').filter(Boolean).pop();
  const direct: Record<string, WorkspacePage> = {
    command: 'command', orders: 'orders', 'daily-production': 'farm', 'driver-work': 'driver',
    catalog: 'customer', 'partner-finance': 'finance', shipments: 'map', inventory: 'inventory',
    quality: 'quality', customers: 'partners', suppliers: 'partners',
  };
  return (tail && direct[tail]) || 'command';
};

const routeForPage = (page: WorkspacePage) => {
  const direct: Partial<Record<WorkspacePage, string>> = {
    command: '/app/command', orders: '/app/orders', farm: '/app/daily-production',
    driver: '/app/driver-work', customer: '/app/catalog', finance: '/app/partner-finance',
    map: '/app/shipments', inventory: '/app/inventory', quality: '/app/quality',
    partners: '/app/customers',
  };
  return direct[page] ?? `/app/command?module=${page}`;
};

function DateAndTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="sim-preview-clock"><span>{new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full', timeZone: 'Asia/Tehran' }).format(now)}</span><b>{new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(now)}</b></div>;
}

function WorkspaceHeader({ theme, onThemeToggle, onNavigate }: {
  theme: 'dark' | 'light'; onThemeToggle: () => void; onNavigate: (page: WorkspacePage) => void;
}) {
  return <>
    <header className="sim-preview-masthead">
      <div className="sim-preview-brand"><SimorghLogo/><span className="sim-preview-brand-caption">مدیریت یکپارچه‌ی مزرعه و عملیات</span></div>
      <div className="sim-preview-manifesto"><b>از تولید تا تصمیم، یک مسیر روشن</b><span>مرکز فرمان عملیات، اهداف روزانه، حساب‌وکتاب و شبکه‌ی تأمین</span></div>
      <div className="sim-preview-head-actions">
        <DateAndTime/>
        <div className="sim-preview-status"><span/> محیط عملیاتی سیمرغ</div>
        <div className="sim-preview-header-tools">
          <button className="sim-preview-theme" type="button" onClick={onThemeToggle} aria-label={theme === 'dark' ? 'فعال‌کردن حالت روشن' : 'فعال‌کردن حالت تاریک'} title={theme === 'dark' ? 'حالت روشن' : 'حالت تاریک'}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}<span>{theme === 'dark' ? 'روشن' : 'تیره'}</span></button>
          <button className="sim-preview-theme" type="button" onClick={() => window.location.reload()} aria-label="به‌روزرسانی سامانه" title="به‌روزرسانی سامانه"><RefreshCw size={16}/><span>تازه‌سازی</span></button>
          <button className="sim-preview-theme" type="button" onClick={() => onNavigate('settings')} aria-label="تنظیمات سامانه" title="تنظیمات"><Settings2 size={16}/><span>تنظیمات</span></button>
        </div>
      </div>
    </header>
    <div className="sim-preview-workspace-bar">
      <div className="sim-preview-page-label"><span><Layers3 size={17}/></span><b>مرکز فرمان عملیات</b><small>مدیریت روزانه‌ی مجموعه</small></div>
      <div className="sim-preview-workspace-summary"><span><Activity size={14}/> اهداف و شاخص‌ها</span><span><MapPin size={14}/> نقشه‌ی شبکه</span><span><CreditCard size={14}/> حساب‌وکتاب شفاف</span></div>
    </div>
  </>;
}

function EmptyState({ icon: Icon = Layers3, title, description }: { icon?: typeof Home; title: string; description: string }) {
  return <div className="sim-preview-empty"><span className="sim-preview-empty-icon"><Icon size={21}/></span><b>{title}</b><p>{description}</p><small><ShieldCheck size={13}/> هیچ داده یا شاخصی برای این بخش جعل یا حدس زده نشده است.</small></div>;
}

function MetricCard({ title, icon: Icon, foot, tone = 'neutral' }: { title: string; icon: typeof Home; foot: string; tone?: string }) {
  return <article className={`sim-preview-metric tone-${tone}`}><div className="sim-preview-metric-label"><span>{title}</span><i><Icon size={17}/></i></div><strong>—</strong><small>{foot}</small></article>;
}

function NetworkMap({ expanded = false }: { expanded?: boolean }) {
  return <section className={`sim-preview-panel sim-preview-map-panel ${expanded ? 'expanded' : ''}`}>
    <div className="sim-preview-panel-head"><div><span className="sim-preview-section-id">۰۱</span><div><h3>نقشه و ردیابی شبکه</h3><p>نقشه‌ی واقعی جغرافیایی؛ بدون نشانگر ساختگی محموله</p></div></div><span className="sim-preview-live-flag"><span/> نقشه‌ی راهنما</span></div>
    <div className="sim-preview-map-frame">
      <iframe title="نقشه جغرافیایی ایران برای راهنمای شبکه" loading="lazy" referrerPolicy="no-referrer-when-downgrade" src="https://www.openstreetmap.org/export/embed.html?bbox=43.2%2C24.5%2C64.8%2C40.8&layer=mapnik" />
      <div className="sim-preview-map-note"><MapPin size={16}/><span><b>موقعیت محموله ثبت نشده</b><small>نشانگرها فقط پس از ثبت مختصات واقعی و مجاز نمایش داده می‌شوند.</small></span></div>
    </div>
    <div className="sim-preview-map-foot"><span><MapPin size={14}/> مختصات GPS: هنوز ثبت نشده</span><button type="button" onClick={() => window.open('https://www.openstreetmap.org/#map=5/32.5/53.5', '_blank', 'noopener,noreferrer')}>بازکردن نقشه <ArrowUpLeft size={14}/></button></div>
  </section>;
}


function QuickAccess({ navigate }: { navigate: (page: WorkspacePage) => void }) {
  const actions: { key: WorkspacePage; title: string; description: string; icon: typeof Home; tone: string }[] = [
    { key: 'orders', title: 'سفارش‌ها و تحویل', description: 'وضعیت سفارش و موعد ارسال', icon: Truck, tone: 'teal' },
    { key: 'inventory', title: 'انبار و خرید', description: 'موجودی و گردش کالا', icon: Warehouse, tone: 'blue' },
    { key: 'map', title: 'نقشه‌ی شبکه', description: 'جغرافیا و مسیرهای مجاز', icon: MapPin, tone: 'amber' },
    { key: 'finance', title: 'مالی و تسویه', description: 'اسناد و صورت مشارکت', icon: CreditCard, tone: 'slate' },
  ];
  return <section className="sim-preview-quick-access" aria-label="دسترسی سریع">
    <div className="sim-preview-quick-heading"><div><span className="sim-preview-section-id"><Layers3 size={14}/></span><div><h3>دسترسی سریع</h3><p>عملیات پرکاربرد با یک لمس</p></div></div><span><Activity size={13}/> میان‌برهای کاری</span></div>
    <div className="sim-preview-quick-grid">
      {actions.map(action => { const Icon = action.icon; return <button type="button" key={action.title} className={`sim-preview-quick-card tone-${action.tone}`} onClick={() => navigate(action.key)}><span className="sim-preview-quick-icon"><Icon size={18}/></span><span className="sim-preview-quick-copy"><b>{action.title}</b><small>{action.description}</small></span><ArrowUpLeft className="sim-preview-quick-arrow" size={15}/></button>; })}
    </div>
  </section>;
}

function ObjectivesPanel({ navigate }: { navigate: (page: WorkspacePage) => void }) {
  const objectives: { title: string; detail: string; page: WorkspacePage; icon: typeof Home }[] = [
    { title: 'تولید و ظرفیت', detail: 'هدف روزانه و ظرفیت تأییدشده', page: 'farm', icon: Factory },
    { title: 'تحویل به‌موقع', detail: 'موعد سفارش‌ها و وضعیت ارسال', page: 'orders', icon: Truck },
    { title: 'کنترل موجودی', detail: 'حداقل موجودی و گردش کالا', page: 'inventory', icon: Warehouse },
    { title: 'حساب‌وکتاب شفاف', detail: 'مطالبات، هزینه و تسویه', page: 'finance', icon: CreditCard },
  ];
  return <section className="sim-preview-goals-panel" aria-label="اهداف و برنامه‌ی مدیریتی">
    <div className="sim-preview-goals-heading">
      <div className="sim-preview-goals-title"><span><Target size={18}/></span><div><h3>اهداف و برنامه‌ی مدیریتی</h3><p>چهار محور کلیدی برای کنترل روزانه‌ی مجموعه</p></div></div>
      <span className="sim-preview-goal-note">هدف‌ها پس از تعریف مدیریتی فعال می‌شوند</span>
    </div>
    <div className="sim-preview-goals-grid">
      {objectives.map(item => { const Icon = item.icon; return <button type="button" className="sim-preview-goal" key={item.title} onClick={() => navigate(item.page)}>
        <span className="sim-preview-goal-icon"><Icon size={17}/></span>
        <span className="sim-preview-goal-copy"><b>{item.title}</b><small>{item.detail}</small></span>
        <span className="sim-preview-goal-state">تعریف نشده</span>
        <ArrowUpLeft size={14} className="sim-preview-goal-arrow"/>
      </button>; })}
    </div>
  </section>;
}

function ControlTower({ navigate }: { navigate: (page: WorkspacePage) => void }) {
  return <>
    <div className="sim-preview-page-heading"><div><span className="sim-preview-eyebrow">مرکز فرمان مدیریتی</span><h1>مرکز فرمان شبکه</h1><p>نمای کلان عملیات، از تولید و تأمین تا تحویل و تسویه.</p></div><div className="sim-preview-heading-meta"><span className="sim-preview-readonly"><ShieldCheck size={14}/> محیط مشاهده‌ی عملیات</span><small>داده‌های واقعی پس از فعال‌شدن حساب مالک و دریافت مجوزهای شرکت خوانده می‌شوند.</small></div></div>
    <div className="sim-preview-metric-grid">
      <MetricCard title="هشدارهای عملیاتی" icon={AlertTriangle} tone="red" foot="پس از خواندن رخدادهای واقعی" />
      <MetricCard title="سفارش‌های در جریان" icon={Boxes} tone="teal" foot="بدون داده‌ی سفارش در عملیات" />
      <MetricCard title="ظرفیت تأییدشده" icon={Factory} tone="blue" foot="بر پایه‌ی تعهدهای ثبت‌شده" />
      <MetricCard title="محموله‌های فعال" icon={Truck} tone="amber" foot="فقط محموله‌های تخصیص‌یافته" />
    </div>
    <ObjectivesPanel navigate={navigate}/>
    <div className="sim-preview-primary-grid">
      <NetworkMap/>
      <section className="sim-preview-panel sim-preview-chart-panel">
        <div className="sim-preview-panel-head"><div><span className="sim-preview-section-id">۰۲</span><div><h3>روند تولید و فروش</h3><p>آمار روزانه‌ی شبکه در منطقه‌ی زمانی تهران</p></div></div><BarChart3 size={18}/></div>
        <div className="sim-preview-empty-chart"><div className="sim-preview-chart-grid"><span/><span/><span/><span/><span/></div><div className="sim-preview-chart-empty-label"><BarChart3 size={24}/><b>آمار روزانه در دسترس نیست</b><small>با فعال‌شدن دسترسی به رکوردهای واقعی، نمودار از تاریخچه‌ی ثبت‌شده ساخته می‌شود.</small></div></div>
        <div className="sim-preview-chart-legend"><span><i className="production-dot"/> تولید ثبت‌شده</span><span><i className="sales-dot"/> سفارش تکمیل‌شده</span><small>نمودار پس از دریافت داده‌های ثبت‌شده به‌روزرسانی می‌شود.</small></div>
      </section>
    </div>
    <QuickAccess navigate={navigate}/>
    <div className="sim-preview-secondary-grid">
      <section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><span className="sim-preview-section-id">۰۳</span><div><h3>سفارش‌های اخیر</h3><p>جدیدترین سفارش‌ها و موعد تحویل</p></div></div><button type="button" className="sim-preview-text-link" onClick={() => navigate('orders')}>همه سفارش‌ها <ArrowLeft size={13}/></button></div><EmptyState icon={FileText} title="سفارش ثبت‌شده‌ای در دسترس نیست" description="پس از اتصال حساب مجاز، سفارش‌ها، مشتری، مبلغ و وضعیت واقعی اینجا نمایش داده می‌شوند."/></section>
      <section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><span className="sim-preview-section-id">۰۴</span><div><h3>وضعیت ظرفیت شبکه</h3><p>ظرفیت تأییدشده در برابر تعهدها</p></div></div></div><EmptyState icon={Gauge} title="ظرفیت واقعی در دسترس نیست" description="درصد بهره‌برداری یا کمبود ظرفیت بدون رکورد معتبر محاسبه نمی‌شود."/></section>
      <section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><span className="sim-preview-section-id">۰۵</span><div><h3>وضعیت مالی</h3><p>مطالبات و تسویه‌های ثبت‌شده</p></div></div><CreditCard size={18}/></div><EmptyState icon={CreditCard} title="مانده‌ی مالی خوانده نشده" description="هیچ مبلغ، سود یا بدهی فرضی در داشبورد قرار نمی‌گیرد."/></section>
    </div>
    <div className="sim-preview-feature-strip">
      <button type="button" onClick={() => navigate('finance')}><span><CreditCard size={17}/></span><b>صورت مالی ۵۰/۵۰</b><small>نمای قرارداد و تسویه</small></button>
      <button type="button" onClick={() => navigate('quality')}><span><Camera size={17}/></span><b>مدرک و تصاویر</b><small>فایل واقعی پس از مجوز</small></button>
      <button type="button" onClick={() => navigate('intelligence')}><span><Sparkles size={17}/></span><b>هوش عملیاتی</b><small>بدون پاسخ هوش مصنوعی ساختگی</small></button>
      <button type="button" onClick={() => navigate('map')}><span><MapPin size={17}/></span><b>نقشه‌ی شبکه</b><small>نقاط فقط از GPS واقعی</small></button>
    </div>
  </>;
}

function FarmWorkspace() {
  return <div className="sim-preview-page-stack">
    <div className="sim-preview-page-heading"><div><span className="sim-preview-eyebrow">عملیات مزرعه</span><h1>کارهای امروز مزرعه</h1><p>وظایف روزانه، ثبت تولید و مدرک تصویری در یک مسیر ساده.</p></div><span className="sim-preview-readonly"><Factory size={14}/> نمای شریک مزرعه</span></div>
    <div className="sim-preview-metric-grid two"><MetricCard title="وظایف سررسیدشده" icon={ClipboardCheck} foot="بر اساس برنامه‌ی واقعی"/> <MetricCard title="ثبت تولید امروز" icon={Activity} foot="از دفتر تولید روزانه"/></div>
    <div className="sim-preview-two-columns">
      <section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>چک‌لیست روزانه</h3><p>موعد، مسئول و وضعیت تأیید</p></div><Clock3 size={18}/></div><EmptyState icon={ClipboardCheck} title="وظیفه‌ی واقعی بارگذاری نشده" description="اینجا چک‌لیست تعیین‌شده برای همین مزرعه نمایش داده می‌شود؛ موردی به‌صورت فرضی اضافه نشده است."/></section>
      <section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>ثبت تولید و مدرک</h3><p>عدد تولید و تصویر مستند</p></div><Camera size={18}/></div><EmptyState icon={Camera} title="داده‌ی تولید یا تصویر موجود نیست" description="مجوز دوربین و ارسال فایل فقط هنگام ورود مجاز و اقدام واقعی کاربر فعال می‌شوند."/></section>
    </div>
  </div>;
}

function DriverWorkspace() {
  return <div className="sim-preview-page-stack">
    <div className="sim-preview-page-heading"><div><span className="sim-preview-eyebrow">حمل و تحویل</span><h1>مأموریت‌های حمل</h1><p>هر مأموریت با محموله‌ی اختصاص‌یافته، مراحل سفر و تأیید تحویل دنبال می‌شود.</p></div><span className="sim-preview-readonly"><Truck size={14}/> نمای راننده</span></div>
    <div className="sim-preview-two-columns"><section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>محموله‌های تخصیص‌یافته</h3><p>زمان بارگیری، مقصد و تحویل</p></div><Truck size={18}/></div><EmptyState icon={Truck} title="محموله‌ای بارگذاری نشده" description="راننده فقط مأموریت‌هایی را می‌بیند که به حساب خودش تخصیص داده شده‌اند."/></section><NetworkMap expanded/></div>
    <section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>مراحل سفر</h3><p>بارگیری ← حرکت ← رسیدن ← تحویل</p></div><CheckCircle2 size={18}/></div><EmptyState icon={MapPin} title="وضعیت سفر و مختصات در دسترس نیست" description="این اپ موقعیت‌یابی پس‌زمینه انجام نمی‌دهد و نقطه‌ای را جعل نمی‌کند. ثبت موقعیت در اپ واقعی با اقدام صریح راننده انجام می‌شود."/></section>
  </div>;
}

function CustomerWorkspace({ navigate }: { navigate: (page: WorkspacePage) => void }) {
  return <div className="sim-preview-page-stack">
    <div className="sim-preview-page-heading"><div><span className="sim-preview-eyebrow">سفارش مشتریان</span><h1>خرید سازمانی</h1><p>کاتالوگ مجاز، سفارش جدید، زمان تحویل و حساب مشتری در یک فضای موبایل‌محور.</p></div><span className="sim-preview-readonly"><Boxes size={14}/> نمای مشتری</span></div>
    <section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>کاتالوگ محصولات</h3><p>قیمت و موجودی فقط بر اساس اطلاعات مجاز</p></div><Package size={18}/></div><EmptyState icon={Package} title="محصول فعالی ثبت نشده" description="هیچ تصویر، قیمت یا موجودی فرضی نشان داده نمی‌شود. کالاهای قابل سفارش از کاتالوگ واقعی خوانده خواهند شد."/></section>
    <div className="sim-preview-two-columns"><section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>سفارش‌های من</h3><p>وضعیت و زمان تحویل</p></div><FileText size={18}/></div><EmptyState icon={FileText} title="سفارش ثبت‌شده‌ای بارگذاری نشده" description="لیست سفارش‌ها بعد از اتصال حساب همان مشتری قابل مشاهده است."/></section><section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>پیگیری ارسال</h3><p>وضعیت واقعی محموله</p></div><Truck size={18}/></div><EmptyState icon={MapPin} title="ارسال قابل پیگیری موجود نیست" description="برای جلوگیری از نمایش اطلاعات مشتری دیگر، ردیابی فقط از حساب احرازشده خوانده می‌شود."/><button className="sim-preview-secondary-button" type="button" onClick={() => navigate('map')}>نقشه‌ی راهنما <ArrowLeft size={14}/></button></section></div>
  </div>;
}

function FinanceWorkspace() {
  return <div className="sim-preview-page-stack">
    <div className="sim-preview-page-heading"><div><span className="sim-preview-eyebrow">حسابداری شفاف مشارکت</span><h1>دفتر مالی مشارکت</h1><p>هر قلم مالی باید به قرارداد، سند، تاریخ و تأیید مربوط متصل باشد.</p></div><span className="sim-preview-readonly"><ShieldCheck size={14}/> بدون تراکنش فرضی</span></div>
    <div className="sim-preview-two-columns"><section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>الگوی تقسیم مشارکت</h3><p>الگوی تقسیم قرارداد ۵۰/۵۰؛ بدون ساخت مبلغ فرضی</p></div><Layers3 size={18}/></div><div className="sim-preview-split-model"><span className="split-ring"><b>۵۰/۵۰</b></span><div><b>الگوی قراردادی</b><p>سهم واقعی طرفین فقط از نسخه‌ی قرارداد فعال خوانده می‌شود. این بخش تا زمان بارگذاری قرارداد، مانده یا سود را نمایش نمی‌دهد.</p><span className="sim-preview-readonly"><ShieldCheck size={13}/> قرارداد فعال خوانده نشده</span></div></div></section><section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>گردش مالی و تسویه</h3><p>اقلام تأییدشده، کسورات و مانده</p></div><CreditCard size={18}/></div><EmptyState icon={CreditCard} title="سند مالی بارگذاری نشده" description="مبالغ قرارداد، درآمد، هزینه، سهم طرفین و مانده‌ی تسویه از دیتابیس مجاز محاسبه می‌شود؛ مبلغ نمونه ساخته نمی‌شود."/></section></div>
    <section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>دفتر تغییرناپذیر اقلام مالی</h3><p>سند، کاربر ثبت‌کننده، زمان و وضعیت تأیید</p></div><Activity size={18}/></div><EmptyState icon={FileText} title="دفتر تسویه آماده‌ی نمایش داده‌ی واقعی است" description="ردیف‌های مالی تنها پس از ثبت و تأیید در دیتابیس نمایش داده خواهند شد."/></section>
  </div>;
}

function IntelligenceWorkspace() {
  return <div className="sim-preview-page-stack">
    <div className="sim-preview-page-heading"><div><span className="sim-preview-eyebrow">هوش عملیاتی سیمرغ</span><h1>هوش عملیاتی سیمرغ</h1><p>پیشنهاد به‌اندازه‌ی شواهد ارزش دارد: هر توصیه باید منبع داده، دلیل و اقدام بعدی مشخص داشته باشد.</p></div><span className="sim-preview-readonly"><Sparkles size={14}/> آماده‌ی پیکربندی</span></div>
    <div className="sim-preview-two-columns"><section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>پیشنهادهای مدیریتی</h3><p>داده‌ی ورودی ← تحلیل ← تأیید مسئول</p></div><Sparkles size={18}/></div><EmptyState icon={Sparkles} title="تحلیلی تولید نشده" description="تا زمانی که منبع داده و ارائه‌دهنده‌ی هوش مصنوعی پیکربندی و آزمایش نشود، پاسخ یا توصیه‌ی ساختگی نمایش داده نمی‌شود."/></section><section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>دروازه‌ی اجرای عامل‌ها</h3><p>دسترسی ابزار، سقف هزینه و ردپا</p></div><ShieldCheck size={18}/></div><EmptyState icon={ShieldCheck} title="عامل اجرایی فعالی در انتظار راه‌اندازی" description="هر عامل واقعی باید مجوز ابزار، سقف هزینه، تأیید اقدامات حساس و لاگ اجرا داشته باشد."/></section></div>
  </div>;
}

function ModuleWorkspace({ page }: { page: WorkspacePage }) {
  const info = pageInfo[page];
  const Icon = info.icon;
  const desc = page === 'inventory'
    ? 'مانده‌ی موجودی فقط از گردش‌های ثبت‌شده محاسبه می‌شود. دفتر انبار برای تغییرات واقعی به دسترسی مجاز نیاز دارد.'
    : page === 'quality'
      ? 'عکس، نتیجه‌ی کنترل و مغایرت فقط در صورت وجود مدرک مجاز نمایش داده می‌شود.'
      : page === 'partners'
        ? 'فهرست شرکا، ظرفیت اعلامی و ظرفیت تأییدشده از رکوردهای شرکت خوانده می‌شود.'
        : 'این بخش در محیط عملیات فقط ساختار و مسیر کار را نشان می‌دهد؛ هیچ تغییر عملیاتی نوشته نمی‌شود.';
  return <div className="sim-preview-page-stack"><div className="sim-preview-page-heading"><div><span className="sim-preview-eyebrow">{info.eyebrow}</span><h1>{info.title}</h1><p>{info.description}</p></div><span className="sim-preview-readonly"><ShieldCheck size={14}/> محیط عملیات</span></div><section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>{info.title}</h3><p>{desc}</p></div><Icon size={18}/></div><EmptyState icon={Icon} title="داده‌ی مجاز برای نمایش در دسترس نیست" description={desc}/></section></div>;
}

export default function OperationsWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const [page, setPage] = useState<WorkspacePage>(() => routeToPage(location.pathname, location.search));
    const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return window.localStorage.getItem('simorgh-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  const [search, setSearch] = useState('');
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const info = pageInfo[page];
  const activeNav = useMemo(() => navGroups.flatMap(group => group.items).find(item => item.key === page), [page]);

  useEffect(() => { setPage(routeToPage(location.pathname, location.search)); }, [location.pathname, location.search]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0B1012' : '#F4F7F7';
    try { window.localStorage.setItem('simorgh-theme', theme); } catch { /* Storage may be disabled. */ }
  }, [theme]);

  const goTo = (next: WorkspacePage) => {
    setPage(next);
    setMobileSidebar(false);
    navigate(routeForPage(next));
  };
  const visibleGroups = navGroups.map(group => ({ ...group, items: group.items.filter(item => !search || item.label.toLowerCase().includes(search.toLowerCase()) || pageInfo[item.key].title.toLowerCase().includes(search.toLowerCase())) })).filter(group => group.items.length);

  const content = page === 'command' ? <ControlTower navigate={goTo}/>
    : page === 'farm' ? <FarmWorkspace/>
      : page === 'driver' ? <DriverWorkspace/>
        : page === 'customer' ? <CustomerWorkspace navigate={goTo}/>
          : page === 'finance' ? <FinanceWorkspace/>
            : page === 'intelligence' ? <IntelligenceWorkspace/>
              : page === 'map' ? <div className="sim-preview-page-stack"><div className="sim-preview-page-heading"><div><span className="sim-preview-eyebrow">{info.eyebrow}</span><h1>{info.title}</h1><p>{info.description}</p></div><span className="sim-preview-readonly"><MapPin size={14}/> بدون مختصات ساختگی</span></div><NetworkMap expanded/><section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>آخرین موقعیت‌های مجاز</h3><p>فقط موقعیت‌هایی که راننده با اقدام صریح ثبت کرده باشد</p></div><MapPin size={18}/></div><EmptyState icon={MapPin} title="نقطه‌ی واقعی برای نمایش موجود نیست" description="این بخش موقعیت دستگاه را فقط با مجوز کاربر می‌خواند. موقعیت محموله فقط با دسترسی مجاز و ثبت صریح راننده نمایش داده می‌شود."/></section></div>
                : page === 'orders' ? <div className="sim-preview-page-stack"><div className="sim-preview-page-heading"><div><span className="sim-preview-eyebrow">{info.eyebrow}</span><h1>{info.title}</h1><p>{info.description}</p></div><span className="sim-preview-readonly"><FileText size={14}/> بدون سفارش نمونه</span></div><section className="sim-preview-panel"><div className="sim-preview-panel-head"><div><h3>دفتر سفارش‌ها</h3><p>شماره سفارش، مشتری، وضعیت، موعد تحویل و مبلغ ثبت‌شده</p></div><FileText size={18}/></div><EmptyState icon={FileText} title="سفارش واقعی بارگذاری نشده" description="اطلاعات سفارش پس از فعال‌شدن دسترسی کاربر خوانده می‌شود؛ هیچ سفارش نمونه‌ای ساخته نشده است."/></section></div>
                  : page === 'settings' ? <ModuleWorkspace page="settings"/> : page === 'quality' || page === 'inventory' || page === 'partners' ? <ModuleWorkspace page={page}/> : <ModuleWorkspace page={page}/>;

  return <main className="sim-preview-app" dir="rtl" data-theme={theme}>
    <WorkspaceHeader theme={theme} onThemeToggle={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} onNavigate={goTo}/>
    <div className="sim-preview-shell">
      {mobileSidebar && <button className="sim-preview-scrim" type="button" aria-label="بستن منوی کناری" onClick={() => setMobileSidebar(false)}/>}
      <aside className={`sim-preview-sidebar ${mobileSidebar ? 'open' : ''}`}>
        <div className="sim-preview-sidebar-brand"><SimorghLogo compact/><div><b>سیمرغ</b><small>سامانه</small></div><button type="button" className="sim-preview-close-sidebar" aria-label="بستن منو" onClick={() => setMobileSidebar(false)}><X size={17}/></button></div>
        <div className="sim-preview-sidebar-search"><Search size={15}/><input placeholder="جست‌وجو در بخش‌ها…" value={search} onChange={e => setSearch(e.target.value)} aria-label="جست‌وجو در بخش‌های سامانه"/></div>
        <nav className="sim-preview-nav" aria-label="بخش‌های سیمرغ">
          {visibleGroups.map(group => <div className="sim-preview-nav-group" key={group.title}><span>{group.title}</span>{group.items.map(item => {const Icon=item.icon;return <button type="button" key={item.key} className={page===item.key?'active':''} onClick={()=>goTo(item.key)}><Icon size={16}/><span>{item.label}</span>{page===item.key&&<i/>}</button>;})}</div>)}
        </nav>
        <div className="sim-preview-sidebar-footer"><div className="sim-preview-footer-orb"><ShieldCheck size={16}/></div><span><b>محیط عملیات</b><small>بدون نشست و بدون نوشتن در دیتابیس</small></span><span className="sim-preview-readonly-dot"/></div>
      </aside>
      <section className="sim-preview-main">
        <div className="sim-preview-toolbar"><button type="button" className="sim-preview-menu-button" onClick={() => setMobileSidebar(true)} aria-label="بازکردن منو"><Menu size={19}/></button><div className="sim-preview-breadcrumb"><span>سیمرغ</span><i>/</i><b>{activeNav?.label ?? info.title}</b></div><div className="sim-preview-toolbar-actions"><span className="sim-preview-session-label"><ShieldCheck size={14}/> داده‌ی شرکت در دسترس نیست</span><button type="button" aria-label="هشدارها" title="هشدارها در عملیات موجود نیست" className="sim-preview-icon-button" onClick={() => goTo('command')}><Bell size={16}/></button><button type="button" aria-label="تنظیمات" title="تنظیمات" className="sim-preview-icon-button" onClick={() => goTo('settings')}><Settings2 size={16}/></button></div></div>
        <div className="sim-preview-content" key={page}>
          {content}
          <footer className="sim-preview-footer-note"><span><ShieldCheck size={14}/> سیمرغ / مدیریت یکپارچه‌ی عملیات</span><span>سیمرغ؛ سامانه‌ی یکپارچه‌ی مدیریت مزرعه و عملیات. داده‌های شرکت از منبع مجاز و به‌روز خوانده می‌شوند.</span></footer>
        </div>
      </section>
    </div>
    <nav className="sim-preview-bottom-nav" aria-label="ناوبری موبایل">
      <button type="button" className={page === 'command' ? 'active' : ''} onClick={() => goTo('command')}><Home size={19}/><span>خانه</span></button>
      <button type="button" className={page === 'orders' ? 'active' : ''} onClick={() => goTo('orders')}><ClipboardCheck size={19}/><span>عملیات</span></button>
      <button type="button" className={page === 'map' ? 'active' : ''} onClick={() => goTo('map')}><MapPin size={19}/><span>نقشه</span></button>
      <button type="button" className={mobileSidebar ? 'active' : ''} onClick={() => setMobileSidebar(true)} aria-label="بیشتر و همه‌ی بخش‌ها"><Menu size={19}/><span>بیشتر</span></button>
    </nav>
  </main>;
}
