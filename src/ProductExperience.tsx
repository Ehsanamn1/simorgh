import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, Boxes, Building2, Check, ClipboardCheck, CreditCard, Factory, FileText, Home, LayoutDashboard, ListTodo, MapPin, Menu, Package, ShieldCheck, Target, Truck, Warehouse, X, UserPlus, Eye, EyeOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from './lib/AuthContext';
import { api } from './lib/apiClient';
import { normalizeIranPhone } from './lib/phone';
import { MedarLogo } from './MedarLogo';
import type { AppRole } from './lib/types';

type NavigationEntry = { key: string; label: string };
type PublicRequestedRole = 'staff' | 'supplier' | 'driver' | 'customer';
type AuthMode = 'signin' | 'signup';
const requestedRoles: { value: PublicRequestedRole; label: string; Icon: LucideIcon }[] = [
  { value: 'customer', label: 'خریدار عمده', Icon: Boxes },
  { value: 'supplier', label: 'شریک مزرعه', Icon: Factory },
  { value: 'driver', label: 'راننده / حمل', Icon: Truck },
  { value: 'staff', label: 'تیم داخلی', Icon: Building2 },
];
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

/** Private operational app entry. Public self-registration is intentionally disabled. */
export default function ProductExperience() {
  const { user, loading, memberships, membershipsLoading, refreshSession, refreshMemberships } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [appMain, setAppMain] = useState<HTMLElement | null>(null);
  const [waitingScreen, setWaitingScreen] = useState<HTMLElement | null>(null);
  const [allowedLinks, setAllowedLinks] = useState<NavigationEntry[]>([]);
  const [mode, setMode] = useState<AuthMode>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [workspaceMode, setWorkspaceMode] = useState<'create' | 'join'>('create');
  const [inviteCode, setInviteCode] = useState('');
  const [phone, setPhone] = useState('');
  const [requestedRole, setRequestedRole] = useState<PublicRequestedRole>('customer');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requestId, setRequestId] = useState('');
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const protectedRoute = location.pathname.includes('/app');
  // Enable secure sign-in by default in web, preview and native builds; only an explicit false disables it.
  // Public self-registration remains disabled independently of this UI flag.
  const authUiEnabled = import.meta.env.VITE_ENABLE_AUTH_UI !== 'false';
  const signInOpen = authUiEnabled && (((location.hash === '#signin' || location.hash === '#signup') && !user && !loading) || (protectedRoute && !user && !loading));
  const normalizedPath = location.pathname.startsWith(basePath) ? location.pathname.slice(basePath.length) || '/' : location.pathname;
  const protectedDestination = normalizedPath.startsWith('/app') ? normalizedPath : '/app';

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
    if (!user || memberships.length) return;
    if (user.full_name) setFullName(user.full_name);
    if (user.phone) setPhone(user.phone);
  }, [user?.id, user?.full_name, user?.phone, memberships.length]);

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
    const workspace = keys.has('catalog') ? 'customer' : keys.has('command') ? 'manager'
      : keys.has('supplier-capacity') || keys.has('supplier-work') || keys.has('daily-production') ? 'supplier' : 'driver';
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
    const normalizedPhone = mode === 'signup' ? normalizeIranPhone(phone) : '';
    if (cleanUsername.length < 3 || cleanUsername.length > 32 || !/^[\\p{L}\\p{N}._-]+$/u.test(cleanUsername)) {
      setError('نام کاربری باید ۳ تا ۳۲ نویسه و شامل حروف، عدد، نقطه، خط تیره یا زیرخط باشد.');
      return;
    }
    if (mode === 'signup') {
      if (fullName.trim().length < 2 || fullName.trim().length > 160) { setError('نام کامل باید بین ۲ تا ۱۶۰ نویسه باشد.'); return; }
      if (workspaceMode === 'create' && (organizationName.trim().length < 2 || organizationName.trim().length > 160)) { setError('نام مجموعه باید بین ۲ تا ۱۶۰ نویسه باشد.'); return; }
      if (workspaceMode === 'join' && !/^[a-f0-9]{64}$/i.test(inviteCode.trim())) { setError('کد دعوت معتبر ۶۴ نویسه‌ای وارد کن.'); return; }
      if (password.length < 8 || password.length > 128) { setError('گذرواژه باید بین ۸ تا ۱۲۸ نویسه باشد.'); return; }
      if (!normalizedPhone) { setError('شماره موبایل ایران معتبر وارد کن؛ مثال: 09121234567'); return; }
      if (password !== confirmPassword) { setError('تکرار گذرواژه یکسان نیست.'); return; }
    } else if (password.length < 1 || password.length > 128) {
      setError('نام کاربری یا گذرواژه نادرست است.');
      return;
    }

    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'signup') {
        await api.post('/api/auth/signup', {
          username: cleanUsername,
          password,
          fullName: fullName.trim(),
          companyName: workspaceMode === 'create' ? organizationName.trim() : '',
          inviteCode: workspaceMode === 'join' ? inviteCode.trim().toLowerCase() : undefined,
          phone: normalizedPhone,
        });
        await refreshSession();
        setPassword(''); setConfirmPassword(''); setMode('signin');
        setNotice('حساب و فضای کاری با موفقیت ساخته شد.');
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

  async function submitRoleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) { setError('برای ثبت درخواست ابتدا وارد حساب شو.'); return; }
    if (['customer', 'supplier'].includes(requestedRole) && organizationName.trim().length < 2) {
      setError('نام شرکت یا مزرعه برای این نقش ضروری است.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.post<{ requestId: string }>('/api/access-requests', {
        role: requestedRole as AppRole,
        fullName: fullName.trim(),
        organizationName: organizationName.trim() || null,
        phone: phone.trim() || null,
      });
      setNotice('درخواست دسترسی ثبت شد. پس از بررسی مالک یا مدیر، فضای کاری نقش انتخابی فعال می‌شود.');
      setRequestId(result.requestId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ثبت درخواست دسترسی ناموفق بود.');
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
        <button type="button" className="mobile-workspace-more" onClick={() => document.querySelector<HTMLButtonElement>('.mobile-menu')?.click()} aria-label="بازکردن منوی کامل"><Menu size={20} aria-hidden="true"/><span>بیشتر</span></button>
      </nav>, appMain)}
    {authUiEnabled && user && waitingScreen && memberships.length === 0 && createPortal(
      <section className="access-request-card" dir="rtl" aria-labelledby="access-request-title">
        <div className="access-request-heading"><span className="access-request-icon"><UserPlus size={20}/></span><div><span className="obsidian-eyebrow">فضای کاری مدار</span><h2 id="access-request-title">درخواست فضای کاری</h2><p>نقش را مشخص کن؛ مدیر پس از بررسی آن را تأیید یا رد می‌کند.</p></div></div>
        <form className="access-request-form" onSubmit={submitRoleRequest}>
          <label>نام و نام خانوادگی<input required minLength={2} maxLength={160} autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="نام کامل"/></label>
          <label>نوع دسترسی<select value={requestedRole} onChange={e => { setRequestedRole(e.target.value as PublicRequestedRole); setRequestId(''); }}><option value="customer">خریدار عمده</option><option value="supplier">شریک مزرعه</option><option value="driver">راننده / پیمانکار حمل</option><option value="staff">عضو تیم داخلی</option></select></label>
          {['customer', 'supplier'].includes(requestedRole) && <label className="wide">نام شرکت / مزرعه<input required minLength={2} maxLength={160} value={organizationName} onChange={e => setOrganizationName(e.target.value)} placeholder="نام مجموعه"/></label>}
          <label>شماره تماس<input type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="اختیاری"/></label>
          {error && <div className="auth-feedback error wide" role="alert">{error}</div>}
          {notice && <div className="auth-feedback success wide" role="status">{notice}</div>}
          <button className="obsidian-primary wide" type="submit" disabled={busy || Boolean(requestId)}>{busy ? 'در حال ارسال…' : requestId ? 'درخواست ثبت شد' : 'ارسال برای تأیید مدیر'} <ArrowLeft size={16}/></button>
        </form>
        <p className="access-request-foot"><ShieldCheck size={15}/> انتخاب نقش به‌تنهایی دسترسی نمی‌دهد. مدیر باید درخواست را در پنل کاربران بررسی کند.</p>
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
            <MedarLogo compact className="signin-form-logo"/>
            <span className="signin-overline">{mode === 'signup' ? 'ثبت‌نام مجموعه' : 'ورود امن'}</span>
            <h2 id="simorgh-signin-title">{mode === 'signup' ? 'ساخت حساب و فضای کاری' : 'ورود به مدار'}</h2>
            <p>{mode === 'signup' ? 'با نام کاربری، شماره موبایل و گذرواژه ثبت‌نام کن؛ می‌توانی مجموعه جدید بسازی یا با کد دعوت به یک مجموعه بپیوندی.' : 'با نام کاربری و گذرواژه وارد مدار شو. ایمیل و تأیید پیامکی برای ورود لازم نیست.'}</p>
             <form className="simorgh-signin-form" onSubmit={event => void submitAuth(event)}>
               {mode === 'signup' && <>
                 <label htmlFor="simorgh-signin-full-name">نام و نام خانوادگی</label><input id="simorgh-signin-full-name" className="auth-input" type="text" autoComplete="name" required minLength={2} maxLength={160} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="نام کامل"/>
                 <label htmlFor="simorgh-workspace-mode">نحوه اتصال به مجموعه</label>
                 <select id="simorgh-workspace-mode" className="auth-input" value={workspaceMode} onChange={e => {setWorkspaceMode(e.target.value as 'create' | 'join');setError('');}}><option value="create">ساخت مجموعه جدید</option><option value="join">پیوستن با کد دعوت</option></select>
                 {workspaceMode === 'create'
                   ? <><label htmlFor="simorgh-signin-organization">نام مزرعه یا مجموعه</label><input id="simorgh-signin-organization" className="auth-input" type="text" required minLength={2} maxLength={160} value={organizationName} onChange={e => setOrganizationName(e.target.value)} placeholder="نام مجموعه"/></>
                   : <><label htmlFor="simorgh-signin-invite">کد دعوت</label><input id="simorgh-signin-invite" className="auth-input" type="text" required minLength={64} maxLength={64} value={inviteCode} onChange={e => setInviteCode(e.target.value.toLowerCase())} placeholder="کد دعوت را وارد کن" dir="ltr"/></>}
                 <label htmlFor="simorgh-signin-phone">شماره موبایل</label><input id="simorgh-signin-phone" className="auth-input" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="09121234567" pattern="(?:09\\d{9}|9\\d{9}|\\+989\\d{9})" required dir="ltr"/>
               </>}
               <label htmlFor="simorgh-signin-username">نام کاربری</label><input id="simorgh-signin-username" className="auth-input" type="text" autoComplete="username" required minLength={3} maxLength={32} value={username} onChange={e => setUsername(e.target.value)} placeholder="نام کاربری" dir="ltr"/>
               <label htmlFor="simorgh-signin-password">گذرواژه</label>
               <div className="auth-password-wrap"><input id="simorgh-signin-password" className="auth-input" type={showPassword ? 'text' : 'password'} minLength={mode === 'signup' ? 8 : 1} maxLength={128} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'حداقل ۸ نویسه' : 'گذرواژه'} dir="ltr"/><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'پنهان‌کردن گذرواژه' : 'نمایش گذرواژه'}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>
               {mode === 'signup' && <><label htmlFor="simorgh-confirm-password">تکرار گذرواژه</label><input id="simorgh-confirm-password" className="auth-input" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="گذرواژه را دوباره وارد کن" dir="ltr"/></>}
               {error && <div className="auth-feedback error" role="alert">{error}</div>}{notice && <div className="auth-feedback success" role="status">{notice}</div>}
               <button className="signin-submit" type="submit" disabled={busy || !username.trim() || !password || (mode === 'signup' && (!fullName.trim() || (workspaceMode === 'create' ? !organizationName.trim() : !inviteCode.trim()) || !phone.trim() || !confirmPassword))}>
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
