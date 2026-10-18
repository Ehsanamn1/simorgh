import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, Boxes, Building2, Check, ClipboardCheck, CreditCard, Factory, FileText, Home, LayoutDashboard, ListTodo, MapPin, Menu, Moon, Package, ShieldCheck, Sun, Target, Truck, Warehouse, X, UserPlus, Eye, EyeOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from './lib/AuthContext';
import { useAppTheme } from './lib/ThemeContext';
import { api, isApiConfigured } from './lib/apiClient';
import { MedarLogo } from './MedarLogo';

type NavigationEntry = { key: string; label: string };
type AuthMode = 'signin' | 'signup';
const routeIcons: Record<string, LucideIcon> = {
  command: LayoutDashboard, orders: FileText, goals: Target, shipments: Truck, finance: CreditCard, catalog: Boxes,
  'my-orders': Package, 'my-account': Building2, 'supplier-work': ClipboardCheck, 'supplier-capacity': Warehouse,
  'supplier-settlement': CreditCard, 'driver-work': Truck, 'daily-production': Factory,
  'operational-tasks': ListTodo, 'partner-finance': CreditCard, 'farm-sites': Warehouse, incidents: Activity,
};
const priorities: Record<string, string[]> = {
  manager: ['command', 'orders', 'shipments'],
  supplier: ['operational-tasks', 'daily-production', 'supplier-capacity'],
  driver: ['driver-work'], customer: ['catalog', 'my-orders', 'my-account'],
};
type MobileNavigationLink = { key: string; route: string; label: string; Icon: LucideIcon; anchor?: string };
const shortLabels: Record<string, string> = {
  command: 'نمای کلی', orders: 'سفارش‌ها', shipments: 'ارسال‌ها', finance: 'مالی', catalog: 'خرید',
  'my-orders': 'سفارش‌های من', 'my-account': 'حساب', 'supplier-work': 'کارهای من',
  'supplier-capacity': 'ظرفیت', 'supplier-settlement': 'تسویه', 'driver-work': 'محموله‌ها',
  'daily-production': 'ثبت تولید', 'operational-tasks': 'وظایف', 'partner-finance': 'دفتر شریک',
  'farm-sites': 'مزرعه', incidents: 'رخدادها',
};

function readAllowedLinks(): NavigationEntry[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('.side-nav a')).flatMap(anchor => {
    const href = anchor.getAttribute('href') || '';
    const tail = href.split('/app/')[1];
    const key = tail?.split(/[/?#]/)[0];
    const label = anchor.querySelector('span')?.textContent?.trim() || anchor.textContent?.trim() || '';
    return key && label ? [{ key, label }] : [];
  });
}

/** Secure operational sign-in. Self-registration creates an isolated owner workspace; joining an existing workspace requires an invitation. */
export default function ProductExperience() {
  const { user, loading, memberships, refreshSession, error: sessionError } = useAuth();
  const { theme, setTheme } = useAppTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [appMain, setAppMain] = useState<HTMLElement | null>(null);
  const [waitingScreen, setWaitingScreen] = useState<HTMLElement | null>(null);
  const [allowedLinks, setAllowedLinks] = useState<NavigationEntry[]>([]);
  const [mode, setMode] = useState<AuthMode>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [joinInviteCode, setJoinInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const protectedRoute = location.pathname.includes('/app');
  // Protected operational routes are only active in builds that explicitly opt in.
  // The Pages showcase remains read-only; the same-origin Worker build enables this guarded UI.
  // Creating a workspace grants owner access only to that new tenant; joining an existing tenant requires a server-issued invitation.
  const authUiEnabled = import.meta.env.VITE_ENABLE_AUTH_UI === 'true' && isApiConfigured;
  const signInOpen = authUiEnabled && (((location.hash === '#signin' || location.hash === '#signup') && !user && !loading) || (protectedRoute && !user && !loading));
  const normalizedPath = location.pathname.startsWith(basePath) ? location.pathname.slice(basePath.length) || '/' : location.pathname;
  const protectedDestination = normalizedPath === '/app/command' || normalizedPath === '/app' || normalizedPath === '/' ? '/app/home' : normalizedPath.startsWith('/app') ? normalizedPath : '/app/home';

  useEffect(() => {
    const invite = new URLSearchParams(location.search).get('invite')?.trim().toLowerCase() ?? '';
    if (!user && /^[a-f0-9]{64}$/.test(invite)) {
      setJoinInviteCode(invite);
      setMode('signup');
      setNotice('دعوت مجموعه دریافت شد؛ نام کاربری و رمز خودت را بساز تا به همان مجموعه متصل شوی.');
    }
  }, [location.search, user?.id]);

  useEffect(() => {
    const refreshTargets = () => {
      setAppMain(document.querySelector<HTMLElement>('.app-main'));
      setWaitingScreen(document.querySelector<HTMLElement>('.waiting-screen'));
    };
    refreshTargets();
    const observer = new MutationObserver(refreshTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [location.pathname, location.hash, user?.id, memberships.length]);

  useEffect(() => {
    if (!appMain) { setAllowedLinks([]); return; }
    // The sidebar is a sibling of .app-main; query the live, permission-filtered nav globally.
    const sideNav = document.querySelector('.side-nav');
    if (!sideNav) { setAllowedLinks([]); return; }
    const refresh = () => {
      const next = readAllowedLinks();
      setAllowedLinks(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(sideNav, { childList: true, subtree: true, characterData: true, attributes: true });
    return () => observer.disconnect();
  }, [appMain, location.pathname, user?.id, memberships.length, memberships[0]?.role]);

  useEffect(() => {
    const canCloseWithEscape = true;
    if (!signInOpen) return;
    const background = document.querySelector<HTMLElement>('.portal, .app-frame');
    const oldOverflow = document.body.style.overflow;
    if (background) background.inert = true;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !protectedRoute && canCloseWithEscape) {
        setError(''); setNotice('');
        navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      if (background) background.inert = false;
      document.body.style.overflow = oldOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [signInOpen, protectedRoute, mode, location.pathname, location.search, navigate]);

  const mobileLinks = useMemo<MobileNavigationLink[]>(() => {
    const keys = new Set(allowedLinks.map(item => item.key));
    const workspace = keys.has('catalog') ? 'customer' : keys.has('orders') || keys.has('members') ? 'manager'
      : keys.has('supplier-work') || keys.has('daily-production') ? 'supplier' : 'driver';
    if (workspace === 'driver' && keys.has('driver-work')) {
      return [
        { key: 'driver-cargo', route: 'driver-work', label: 'محموله‌ها', Icon: Truck, anchor: 'driver-shipments' },
        { key: 'driver-map', route: 'driver-work', label: 'نقشه', Icon: MapPin, anchor: 'driver-map' },
        { key: 'driver-evidence', route: 'driver-work', label: 'مدرک', Icon: ClipboardCheck, anchor: 'driver-proof' },
      ];
    }
    return priorities[workspace].filter(key => keys.has(key)).slice(0, 3).map(key => ({
      key, route: key, label: shortLabels[key] || allowedLinks.find(item => item.key === key)?.label || key, Icon: routeIcons[key] || Home,
    }));
  }, [allowedLinks]);

  const closeSignIn = () => {
    setError(''); setNotice('');
    navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true });
  };

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanUsername = username.trim();
    const validUsername = cleanUsername.length >= 3 && cleanUsername.length <= 32 &&
      /^[\p{L}\p{N}._-]+$/u.test(cleanUsername) && !/^[._-]|[._-]$/.test(cleanUsername);
    if (!validUsername) {
      setError('نام کاربری باید ۳ تا ۳۲ نویسه باشد و با نقطه یا خط تیره شروع یا تمام نشود.');
      return;
    }
    if (mode === 'signup') {
      if (password.length < 8 || password.length > 128) {
        setError('رمز عبور باید بین ۸ تا ۱۲۸ نویسه باشد.');
        return;
      }
    } else if (password.length < 1 || password.length > 128) {
      setError('نام کاربری یا رمز عبور نادرست است.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'signup') {
        const inviteCode = joinInviteCode.trim().toLowerCase();
        if (inviteCode && !/^[a-f0-9]{64}$/.test(inviteCode)) {
          setError('کد دعوت باید ۶۴ نویسهٔ معتبر داشته باشد.');
          return;
        }
        if (inviteCode) {
          await api.post('/api/auth/signup-with-invite', { username: cleanUsername, password, inviteCode });
        } else {
          await api.post('/api/auth/signup', { username: cleanUsername, password });
        }
        await refreshSession();
        setPassword('');
        setJoinInviteCode('');
        setMode('signin');
        setNotice(inviteCode ? 'حساب ساخته شد و با نقش تعیین‌شده به مجموعه پیوست.' : 'حساب و فضای کاری با موفقیت ساخته شد.');
        navigate(protectedDestination, { replace: true });
      } else {
        await api.post('/api/auth/login', { username: cleanUsername, password });
        await refreshSession();
        setPassword('');
        navigate(protectedDestination, { replace: true });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ارتباط با سرویس مدار برقرار نشد. دوباره تلاش کن.');
    } finally {
      setBusy(false);
    }
  }

  async function submitInviteJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = joinInviteCode.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(code)) { setError('کد دعوت معتبر ۶۴ نویسه‌ای وارد کن.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await api.post('/api/workspace/join', { inviteCode: code });
      await refreshSession();
      setJoinInviteCode('');
      setNotice('عضویت با موفقیت فعال شد؛ در حال بارگذاری فضای کاری.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'پیوستن به مجموعه ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }


  return <>
    {user && appMain && mobileLinks.length > 0 && createPortal(
      <nav className="mobile-workspace-nav" aria-label="ناوبری اصلی فضای کاری">
        {mobileLinks.map(({ key, route, label, Icon, anchor }) => {
          const current = location.pathname.split('/').filter(Boolean).at(-1) === route
            && (!anchor || location.hash === '#' + anchor);
          return <Link key={key} to={{ pathname: '/app/' + route, hash: anchor ? '#' + anchor : '' }} className={current ? 'is-active' : ''} aria-current={current ? 'page' : undefined}><Icon size={20} strokeWidth={current ? 2.3 : 1.8} aria-hidden="true"/><span>{label}</span></Link>;
        })}
        <button type="button" className="mobile-workspace-more" onClick={() => document.querySelector<HTMLButtonElement>('.mobile-menu')?.click()} aria-label="بازکردن فهرست ماژول‌ها"><Menu size={20} aria-hidden="true"/><span>ماژول‌ها</span></button>
      </nav>, appMain)}
    {authUiEnabled && user && waitingScreen && memberships.length === 0 && createPortal(
      <section className="access-request-card" dir="rtl" aria-labelledby="access-request-title">
        <div className="access-request-heading"><span className="access-request-icon"><UserPlus size={20}/></span><div><span className="obsidian-eyebrow">فضای کاری مدار</span><h2 id="access-request-title">پیوستن به مجموعه</h2><p>برای اتصال حساب موجود، کد دعوتی را وارد کن که مالک یا مدیر مجموعه برایت ساخته است. انتخاب نقش به‌تنهایی دسترسی ایجاد نمی‌کند.</p></div></div>
        <form className="access-request-form" onSubmit={submitInviteJoin}>
          <label className="wide">کد دعوت<input className="auth-input" required minLength={64} maxLength={64} autoComplete="off" value={joinInviteCode} onChange={e => setJoinInviteCode(e.target.value.toLowerCase())} placeholder="کد دعوت ۶۴ نویسه‌ای" dir="ltr"/></label>
          {error && <div className="auth-feedback error wide" role="alert">{error}</div>}
          {notice && <div className="auth-feedback success wide" role="status">{notice}</div>}
          <button className="obsidian-primary wide" type="submit" disabled={busy || joinInviteCode.trim().length !== 64}>{busy ? 'در حال بررسی دعوت…' : 'پیوستن به مجموعه'} <ArrowLeft size={16}/></button>
        </form>
        <p className="access-request-foot"><ShieldCheck size={15}/> اگر کد دعوت نداری، از مالک مجموعه بخواه از بخش «دسترسی کاربران» برایت دعوت بسازد.</p>
      </section>, waitingScreen)}
    {signInOpen && !user && (
      <section className="simorgh-signin-layer" role="dialog" aria-modal="true" aria-labelledby="simorgh-signin-title" aria-label="ورود امن مدار">
        <div className="simorgh-signin-brand">
          <div className="simorgh-signin-brand-top"><span className="simorgh-signin-mark"><ShieldCheck size={26}/></span><span><strong>مدار</strong><small>مدیریت یکپارچه عملیات</small></span></div>
          <div className="simorgh-signin-story"><span className="signin-overline">مدار / فضای کاری امن</span><h1>یک شبکه.<br/><em>کنترل دقیق.</em></h1><p>مدیریت مزرعه، منابع، سفارش، کیفیت، حمل و حساب‌ها؛ در یک فضای کاری امن و قابل پیگیری.</p><div className="signin-assurance"><ShieldCheck size={17}/><span>نقش‌های داخلی و مدیریتی فقط با دعوت یا تأیید مالک فعال می‌شوند.</span></div></div>
          <div className="signin-brand-foot"><span>عملیات و منابع</span><span>ورود امن</span></div>
        </div>
        <div className="simorgh-signin-form-area">
          {!protectedRoute && <button type="button" className="signin-close" onClick={closeSignIn} aria-label="بستن ورود"><X size={20}/></button>}
          <div className="simorgh-signin-form-card" dir="rtl">
            <div className="signin-form-toolbar">
              <MedarLogo compact className="signin-form-logo"/>
              <button type="button" className="signin-theme-toggle" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'light'} aria-label="تغییر حالت نمایش" title={theme === 'dark' ? 'فعال‌کردن حالت روشن' : 'فعال‌کردن حالت تاریک'}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button>
            </div>
            <span className="signin-overline">{mode === 'signup' ? 'ثبت‌نام مجموعه' : 'ورود امن'}</span>
            <h2 id="simorgh-signin-title">{mode === 'signup' ? 'ساخت حساب و فضای کاری' : 'ورود به مدار'}</h2>
            <p>{mode === 'signup' ? 'برای ساخت فضای شخصی کد را خالی بگذار؛ برای عضویت در شرکت، کد دعوت مدیر را وارد کن.' : 'برای ورود فقط نام کاربری و رمز عبور لازم است.'}</p>
            {sessionError && <div className="auth-feedback error session-connection-error" role="status">
              <span>{sessionError}</span>
              <button type="button" className="auth-text-action" onClick={() => void refreshSession()} disabled={loading}>تلاش دوباره برای اتصال</button>
            </div>}
             <form className="simorgh-signin-form" onSubmit={event => void submitAuth(event)}>
               <label htmlFor="simorgh-signin-username">نام کاربری</label><input id="simorgh-signin-username" className="auth-input" type="text" autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value)} placeholder="نام کاربری" dir="ltr"/>
               {mode === 'signup' && <><label htmlFor="simorgh-signup-invite">کد دعوت شرکت (اختیاری)</label><input id="simorgh-signup-invite" className="auth-input" type="text" autoComplete="off" inputMode="text" maxLength={64} value={joinInviteCode} onChange={e => setJoinInviteCode(e.target.value.toLowerCase().replace(/\s/g, ''))} placeholder="کد ۶۴ نویسه‌ای مدیر" dir="ltr"/><small className="auth-recovery-note">با کد دعوت، حساب از ابتدا فقط با نقش و دسترسی همان شرکت ساخته می‌شود؛ فضای مالک جداگانه ایجاد نمی‌شود.</small></>}
               <label htmlFor="simorgh-signin-password">گذرواژه</label>
               <div className="auth-password-wrap"><input id="simorgh-signin-password" className="auth-input" type={showPassword ? 'text' : 'password'} minLength={mode === 'signup' ? 8 : 1} maxLength={128} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'حداقل ۸ نویسه' : 'گذرواژه'} dir="ltr"/><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'پنهان‌کردن گذرواژه' : 'نمایش گذرواژه'}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>
               {error && <div className="auth-feedback error" role="alert">{error}</div>}{notice && <div className="auth-feedback success" role="status">{notice}</div>}
               <button className="signin-submit" type="submit" disabled={busy || !username.trim() || !password}>
                 {busy ? <><span className="signin-spinner" aria-hidden="true"/> در حال پردازش…</> : mode === 'signup' ? <>ساخت حساب و فضای کاری <ArrowLeft size={17}/></> : <>ورود به فضای کار <ArrowLeft size={17}/></>}
               </button>
             </form>
             {mode === 'signin' && <><p className="auth-recovery-note">برای بازنشانی امن گذرواژه، با مالک سامانه تماس بگیر؛ بازیابی بدون ایمیل یا عامل تأیید دوم فعلاً فعال نیست.</p><div className="signin-registration-cta"><span>برای مجموعه جدید حساب می‌خواهی؟</span><button type="button" onClick={() => {setMode('signup');setError('');setNotice('');navigate({pathname:location.pathname,search:location.search,hash:'#signup'},{replace:true});}}>ساخت حساب و فضای کاری</button></div></>}
             {mode === 'signup' && <button type="button" className="auth-text-action" onClick={() => {setMode('signin');setError('');setNotice('');navigate({pathname:location.pathname,search:location.search,hash:'#signin'},{replace:true});}}>بازگشت به ورود</button>}
             <div className="signin-form-foot"><span><Check size={13}/> کنترل دسترسی سمت سرور</span><span>مدار · فضای امن</span></div>
          </div>
        </div>
      </section>
    )}
  </>;
}
