import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, ArrowLeft, Boxes, Building2, Check, ClipboardCheck, CreditCard,
  Factory, FileText, Home, LayoutDashboard, ListTodo, LockKeyhole, LogIn,
  Mail, Menu, Package, ShieldCheck, Truck, Warehouse, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from './lib/AuthContext';
import { isSupabaseConfigured, supabase } from './lib/supabase';

type NavigationEntry = { key: string; label: string };
const routeIcons: Record<string, LucideIcon> = {
  command: LayoutDashboard, orders: FileText, shipments: Truck, finance: CreditCard,
  catalog: Boxes, 'my-orders': Package, 'my-account': Building2,
  'supplier-work': ClipboardCheck, 'supplier-capacity': Warehouse,
  'supplier-settlement': CreditCard, 'driver-work': Truck,
  'daily-production': Factory, 'operational-tasks': ListTodo,
  'partner-finance': CreditCard, 'farm-sites': Warehouse, incidents: Activity,
};
const priorities: Record<string, string[]> = {
  manager: ['command', 'orders', 'shipments', 'finance'],
  supplier: ['operational-tasks', 'daily-production', 'supplier-capacity', 'partner-finance'],
  driver: ['driver-work'],
  customer: ['catalog', 'my-orders', 'finance', 'my-account'],
};
const shortLabels: Record<string, string> = {
  command: 'نمای کلی', orders: 'سفارش‌ها', shipments: 'ارسال‌ها', finance: 'مالی',
  catalog: 'خرید', 'my-orders': 'سفارش‌های من', 'my-account': 'حساب',
  'supplier-work': 'کارهای من', 'supplier-capacity': 'ظرفیت', 'supplier-settlement': 'تسویه',
  'driver-work': 'محموله‌ها', 'daily-production': 'ثبت تولید', 'operational-tasks': 'وظایف',
  'partner-finance': 'دفتر شریک', 'farm-sites': 'مزرعه', incidents: 'رخدادها',
};

function readAllowedLinks(): NavigationEntry[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('.side-nav a')).flatMap((anchor) => {
    const href = anchor.getAttribute('href') || '';
    const key = href.match(/\/app\/([^/?#]+)/)?.[1];
    const label = anchor.querySelector('span')?.textContent?.trim() || anchor.textContent?.trim() || '';
    return key && label ? [{ key, label }] : [];
  });
}

/** Shared sign-in and mobile navigation are rendered from the actual app shell.
 * Tabs mirror existing role-filtered routes; no preview or additional role is created here. */
export default function ProductExperience() {
  const { user, loading, memberships } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [portalHeader, setPortalHeader] = useState<HTMLElement | null>(null);
  const [appMain, setAppMain] = useState<HTMLElement | null>(null);
  const [allowedLinks, setAllowedLinks] = useState<NavigationEntry[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const protectedRoute = location.pathname.includes('/app');
  const signInOpen = location.hash === '#signin' || (protectedRoute && !user && !loading);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const normalizedPath = location.pathname.startsWith(basePath)
    ? location.pathname.slice(basePath.length) || '/'
    : location.pathname;
  const protectedDestination = normalizedPath.startsWith('/app') ? normalizedPath : '/app';

  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.portal-header');
    const main = document.querySelector<HTMLElement>('.app-main');
    setPortalHeader((old) => old === header ? old : header);
    setAppMain((old) => old === main ? old : main);
    const sideNav = document.querySelector('.side-nav');
    if (!sideNav) {
      setAllowedLinks((old) => old.length ? [] : old);
      return;
    }
    const refresh = () => {
      const next = readAllowedLinks();
      setAllowedLinks((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(sideNav, { childList: true, subtree: true, characterData: true, attributes: true });
    return () => observer.disconnect();
  }, [location.pathname, location.hash, user?.id, memberships.length, memberships[0]?.role]);

  useEffect(() => {
    if (!signInOpen) return;
    const background = document.querySelector<HTMLElement>('.portal, .app-frame');
    const oldOverflow = document.body.style.overflow;
    if (background) background.inert = true;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !protectedRoute) {
        setError('');
        navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      if (background) background.inert = false;
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [signInOpen, protectedRoute, location.pathname, location.search, navigate]);

  const mobileLinks = useMemo(() => {
    const keys = new Set(allowedLinks.map((item) => item.key));
    const workspace = keys.has('catalog') ? 'customer'
      : keys.has('command') ? 'manager'
        : keys.has('supplier-capacity') || keys.has('supplier-work') || keys.has('daily-production') ? 'supplier' : 'driver';
    return priorities[workspace].filter((key) => keys.has(key)).map((key) => ({
      key,
      label: shortLabels[key] || allowedLinks.find((item) => item.key === key)?.label || key,
      Icon: routeIcons[key] || Home,
    }));
  }, [allowedLinks]);

  const openSignIn = () => {
    setError('');
    navigate({ pathname: location.pathname, search: location.search, hash: '#signin' });
  };
  const closeSignIn = () => {
    setError('');
    navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true });
  };

  async function submitSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !isSupabaseConfigured) {
      setError('اتصال سامانه احراز هویت پیکربندی نشده است. ورود در این محیط در دسترس نیست.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) {
        setError('ورود انجام نشد. ایمیل و گذرواژه را بررسی کن یا از مدیر مجموعه درباره فعال‌بودن حساب دعوت‌شده مطمئن شو.');
        return;
      }
      setPassword('');
      navigate(protectedDestination, { replace: true });
    } catch {
      setError('ارتباط با سرویس ورود برقرار نشد. اتصال اینترنت را بررسی کن و دوباره تلاش کن.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {portalHeader && !user && createPortal(
        <button className="portal-signin-link" type="button" onClick={openSignIn}>
          <LockKeyhole size={16} aria-hidden="true" /><span>ورود اعضای مجاز</span><ArrowLeft size={14} aria-hidden="true" />
        </button>,
        portalHeader,
      )}

      {user && appMain && mobileLinks.length > 0 && createPortal(
        <nav className="mobile-workspace-nav" aria-label="ناوبری اصلی فضای کاری">
          {mobileLinks.map(({ key, label, Icon }) => {
            const current = location.pathname.split('/').filter(Boolean).at(-1) === key;
            return <Link key={key} to={'/app/' + key} className={current ? 'is-active' : ''} aria-current={current ? 'page' : undefined}>
              <Icon size={20} strokeWidth={current ? 2.3 : 1.8} aria-hidden="true" /><span>{label}</span>
            </Link>;
          })}
          <button type="button" className="mobile-workspace-more" onClick={() => document.querySelector<HTMLButtonElement>('.mobile-menu')?.click()} aria-label="بازکردن منوی کامل">
            <Menu size={20} aria-hidden="true" /><span>بیشتر</span>
          </button>
        </nav>,
        appMain,
      )}

      {signInOpen && !user && !loading && (
        <section className="simorgh-signin-layer" role="dialog" aria-modal="true" aria-labelledby="simorgh-signin-title" aria-label="ورود کاربران مجاز">
          <div className="simorgh-signin-brand">
            <div className="simorgh-signin-brand-top">
              <span className="simorgh-signin-mark"><ShieldCheck size={27} aria-hidden="true" /></span>
              <span><strong>سیمرغ</strong><small>مدیریت شبکه تأمین</small></span>
            </div>
            <div className="simorgh-signin-story">
              <span className="signin-overline">SIMORGH / SECURE WORKSPACE</span>
              <h1>کار واقعی،<br /><em>دسترسی دقیق.</em></h1>
              <p>ورود فقط برای کاربران دعوت‌شده و حساب‌هایی است که مالک یا مدیر مجموعه دسترسی آن‌ها را تأیید کرده است.</p>
              <div className="signin-assurance"><ShieldCheck size={17} /><span>نقش‌ها از روی کارت انتخابی تعیین نمی‌شوند؛ دسترسی از عضویت معتبر خوانده می‌شود.</span></div>
            </div>
            <div className="signin-brand-foot"><span>NETWORK OPERATIONS</span><span>AUTHENTICATED ACCESS</span></div>
          </div>
          <div className="simorgh-signin-form-area">
            {!protectedRoute && <button type="button" className="signin-close" onClick={closeSignIn} aria-label="بستن ورود"><X size={20} /></button>}
            <div className="simorgh-signin-form-card" dir="rtl">
              <span className="signin-form-icon"><LogIn size={21} aria-hidden="true" /></span>
              <span className="signin-overline">ورود امن به فضای کاری</span>
              <h2 id="simorgh-signin-title">خوش برگشتی</h2>
              <p>با اطلاعات حساب دعوت‌شده وارد شو. ثبت‌نام عمومی در این سامانه فعال نیست.</p>
              <form className="simorgh-signin-form" onSubmit={(event) => void submitSignIn(event)}>
                <label htmlFor="simorgh-signin-email">ایمیل سازمانی</label>
                <div className="signin-input-wrap"><Mail size={17} aria-hidden="true" /><input id="simorgh-signin-email" type="email" autoComplete="username" inputMode="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" dir="ltr" /></div>
                <label htmlFor="simorgh-signin-password">گذرواژه</label>
                <div className="signin-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="simorgh-signin-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="گذرواژه حساب" dir="ltr" /></div>
                {error && <div className="signin-error" role="alert">{error}</div>}
                <button className="signin-submit" type="submit" disabled={busy || !email.trim() || !password}>
                  {busy ? <><span className="signin-spinner" aria-hidden="true" /> در حال بررسی دسترسی…</> : <>ورود به سیمرغ <ArrowLeft size={17} aria-hidden="true" /></>}
                </button>
              </form>
              <div className="signin-no-signup"><ShieldCheck size={16} /><span>حساب نداری؟ مالک مجموعه باید از مسیر دعوت کنترل‌شده برایت دسترسی ایجاد کند.</span></div>
              <div className="signin-form-foot"><span><Check size={13} /> ارتباط امن</span><span>SIMORGH · 01</span></div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
