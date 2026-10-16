import { useEffect, useState } from 'react';
import {
  Activity, Boxes, Clock3, CreditCard, Factory, LogIn, Moon,
  Package, ShieldCheck, Sun, Target, Truck, Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SimorghLogo } from './SimorghLogo';

const gatewayFeatures: { title: string; description: string; icon: LucideIcon }[] = [
  { title: 'مزارع و چرخه‌ها', description: 'واحدها، فعالیت‌ها، ظرفیت و دوره‌های تولید', icon: Warehouse },
  { title: 'تولید و کیفیت', description: 'ثبت روزانه، خروجی، اتلاف و وضعیت کنترل', icon: Factory },
  { title: 'سفارش تا تحویل', description: 'سفارش، موجودی، مسیر و تحویل قابل پیگیری', icon: Boxes },
  { title: 'مالی و اهداف', description: 'دفتر حساب، تسویه، شاخص و مسیر اجرا', icon: Target },
];

const operationsFlow: { number: string; title: string; detail: string; icon: LucideIcon }[] = [
  { number: '۰۱', title: 'منابع و ظرفیت', detail: 'مزرعه، شریک و امکان تولید', icon: Warehouse },
  { number: '۰۲', title: 'تولید و کنترل', detail: 'ثبت رکورد و بررسی کیفیت', icon: Activity },
  { number: '۰۳', title: 'سفارش و موجودی', detail: 'تخصیص، کالا و موعد', icon: Package },
  { number: '۰۴', title: 'ارسال و تحویل', detail: 'محموله، مسیر و مدرک', icon: Truck },
  { number: '۰۵', title: 'مالی و رشد', detail: 'تطبیق حساب و هدف مدیریتی', icon: CreditCard },
];

function TehranClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="ops-live-clock"><Clock3 size={15}/><span>{new Intl.DateTimeFormat('fa-IR', { dateStyle: 'full', timeZone: 'Asia/Tehran' }).format(now)}</span><b>{new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(now)}</b></div>;
}

/** Public entry point. The private manager dashboard only renders for active members. */
export default function OperationalWorkspace({ authLoading = false }: { authLoading?: boolean; hasMembership?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('simorgh-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0B1012' : '#F4F7F7';
    try { localStorage.setItem('simorgh-theme', theme); } catch { /* storage may be blocked */ }
  }, [theme]);

  const openSignIn = () => navigate({ pathname: location.pathname, search: location.search, hash: '#signin' });

  if (authLoading) {
    return <main className="ops-live-app ops-live-gateway-loading" dir="rtl" aria-live="polite">
      <SimorghLogo/>
      <span className="ops-live-loading-spinner" aria-hidden="true"/>
      <strong>در حال بررسی حساب و سطح دسترسی…</strong>
      <p>تا پایان بررسی، اطلاعات خصوصی بارگذاری نمی‌شود.</p>
    </main>;
  }

  return <main className="ops-live-app ops-live-gateway" dir="rtl">
    <header className="ops-live-header">
      <div className="ops-live-brand"><SimorghLogo/><span>سامانه‌ی مدیریت مزرعه و عملیات</span></div>
      <div className="ops-live-header-meta">
        <TehranClock/>
        <button type="button" className="ops-live-theme" aria-label={theme === 'dark' ? 'فعال‌کردن حالت روشن' : 'فعال‌کردن حالت تاریک'} onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}<span>{theme === 'dark' ? 'حالت روشن' : 'حالت تاریک'}</span>
        </button>
      </div>
    </header>

    <div className="ops-live-gateway-layout">
      <section className="ops-live-gateway-hero">
        <div className="ops-live-gateway-eyebrow"><i aria-hidden="true"/> مدیریت یکپارچه‌ی مزرعه و عملیات</div>
        <h1>از مزرعه تا تصمیم،<br/><em>با دید کامل و داده‌ی واقعی.</em></h1>
        <p className="ops-live-gateway-intro">سیمرغ کارهای مزرعه، تولید، موجودی، سفارش، ارسال و مالی را در یک جریان قابل پیگیری جمع می‌کند؛ با فضای مدیریتی کامل برای مالک و تجربه‌ی همراه برای هر عضو تیم.</p>
        <button type="button" className="ops-live-gateway-cta" onClick={openSignIn}>ورود مدیر و اعضا <LogIn size={18}/></button>
        <div className="ops-live-gateway-assurance"><ShieldCheck size={17}/><span><b>ورود امن و دسترسی نقش‌محور</b><small>اطلاعات سازمان فقط پس از احراز هویت و تأیید عضویت نمایش داده می‌شود.</small></span></div>

        <div className="ops-live-gateway-features">
          {gatewayFeatures.map(({ title, description, icon: Icon }) => <article className="ops-live-gateway-feature" key={title}>
            <span><Icon size={19}/></span><div><b>{title}</b><small>{description}</small></div>
          </article>)}
        </div>
      </section>

      <aside className="ops-live-gateway-operations">
        <div className="ops-live-gateway-card-label"><span/><small>نقشه‌ی جریان کار</small><span className="ops-live-gateway-card-tag">۵ مرحله‌ی مرتبط</span></div>
        <h2>هر بخش، ادامه‌ی بخش بعدی است.</h2>
        <p>اطلاعات از ثبت عملیاتی به سفارش، تحویل و تصمیم مدیریتی منتقل می‌شود؛ نه بین فایل‌ها و پیام‌های جداگانه.</p>
        <div className="ops-live-gateway-flow">
          {operationsFlow.map(({ number, title, detail, icon: Icon }, index) => <div className="ops-live-gateway-stage" key={number}>
            <span className="ops-live-gateway-stage-icon"><Icon size={17}/></span>
            <span className="ops-live-gateway-stage-number">{number}</span>
            <div><b>{title}</b><small>{detail}</small></div>
            {index < operationsFlow.length - 1 && <i aria-hidden="true"/>}
          </div>)}
        </div>
        <div className="ops-live-gateway-map-note"><Target size={17}/><span><b>نقشه و اهداف در فضای مدیریتی</b><small>نقاط جغرافیایی، شاخص‌ها و وضعیت‌ها از داده‌های ثبت‌شده خوانده می‌شوند؛ مقدار ساختگی نمایش داده نمی‌شود.</small></span></div>
      </aside>
    </div>

    <footer className="ops-live-gateway-footer">
      <span><SimorghLogo compact/><b>سیمرغ</b><small>مدیریت مزرعه و عملیات</small></span>
      <span>فضای کاری فارسی، راست‌چین و سازگار با موبایل</span>
    </footer>
  </main>;
}
