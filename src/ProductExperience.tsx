import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, Boxes, Building2, Check, ClipboardCheck, CreditCard, Factory, FileText, Home, LayoutDashboard, ListTodo, MapPin, Menu, Package, ShieldCheck, Target, Truck, Warehouse, X, UserPlus, Eye, EyeOff, KeyRound, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from './lib/AuthContext';
import { neonAuth } from './lib/neonAuth';
import { api } from './lib/apiClient';
import { MedarLogo } from './MedarLogo';
import type { AppRole } from './lib/types';

type NavigationEntry = { key: string; label: string };
type PublicRequestedRole = 'owner' | 'staff' | 'supplier' | 'driver' | 'customer';
type AuthMode = 'signin' | 'signup' | 'reset' | 'recovery';
function normalizeIranPhone(value: string): string {
  const digits = value.trim().replaceAll(' ', '').replaceAll('-', '').replaceAll('(', '').replaceAll(')', '')
    .replace(/[۰-۹]/g, char => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
    .replace(/[٠-٩]/g, char => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)));
  if (digits.startsWith('09') && digits.length === 11 && /^[0-9]+$/.test(digits)) return '+98' + digits.slice(1);
  if (digits.startsWith('9') && digits.length === 10 && /^[0-9]+$/.test(digits)) return '+98' + digits;
  if (digits.startsWith('+989') && digits.length === 13 && /^[+0-9]+$/.test(digits)) return digits;
  return '';
}

const requestedRoles: { value: PublicRequestedRole; label: string; Icon: LucideIcon }[] = [
  { value: 'owner', label: 'مالک مجموعه جدید', Icon: Building2 },
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
  const { user, loading, memberships, membershipsLoading, refreshMemberships } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [appMain, setAppMain] = useState<HTMLElement | null>(null);
  const [waitingScreen, setWaitingScreen] = useState<HTMLElement | null>(null);
  const [allowedLinks, setAllowedLinks] = useState<NavigationEntry[]>([]);
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [phone, setPhone] = useState('');
  const [requestedRole, setRequestedRole] = useState<PublicRequestedRole>('customer');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requestId, setRequestId] = useState('');
  const [workspaceProvisionError, setWorkspaceProvisionError] = useState('');
  const [workspaceProvisioning, setWorkspaceProvisioning] = useState(false);
  const [workspaceProvisionRetry, setWorkspaceProvisionRetry] = useState(0);
  const provisionedUserIds = useRef<Set<string>>(new Set());
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const protectedRoute = location.pathname.includes('/app');
  // Enable secure sign-in by default in web, preview and native builds; only an explicit false disables it.
  // Public self-registration remains disabled independently of this UI flag.
  const authUiEnabled = import.meta.env.VITE_ENABLE_AUTH_UI !== 'false';
  const signInOpen = authUiEnabled && (mode === 'recovery' || ((location.hash === '#signin' || location.hash === '#signup') && !user && !loading) || (protectedRoute && !user && !loading));
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
    if (!neonAuth) return;
    const { data: listener } = neonAuth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('recovery'); setError(''); setNotice('گذرواژه جدید را وارد کن تا بازیابی حساب تکمیل شود.');
        navigate({ pathname: location.pathname, search: location.search, hash: '#signin' }, { replace: true });
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [navigate, location.pathname, location.search]);

  useEffect(() => {
    if (!user || memberships.length) return;
    const metadata = user.user_metadata ?? {};
    if (requestedRoles.some(role => role.value === metadata.requested_role)) setRequestedRole(metadata.requested_role as PublicRequestedRole);
    if (typeof metadata.full_name === 'string' && metadata.full_name.trim()) setFullName(metadata.full_name);
    if (typeof metadata.organization_name === 'string') setOrganizationName(metadata.organization_name);
    if (typeof metadata.phone === 'string') setPhone(metadata.phone);
  }, [user?.id, user?.user_metadata, memberships.length]);

  useEffect(() => {
    if (!neonAuth || !user || loading || membershipsLoading || memberships.length > 0) return;
    const metadata = user.user_metadata ?? {};
    if (metadata.signup_workspace_pending !== true || provisionedUserIds.current.has(user.id)) return;
    provisionedUserIds.current.add(user.id);
    void (async () => {
      setWorkspaceProvisioning(true);
      setWorkspaceProvisionError('');
      const result = await api.post<{ companyId: string }>('/api/workspace/provision', {
        companyName: typeof metadata.organization_name === 'string' ? metadata.organization_name : '',
        fullName: typeof metadata.full_name === 'string' ? metadata.full_name : '',
        phone: typeof metadata.phone === 'string' ? metadata.phone : null,
      });
      if (!result?.companyId) {
        provisionedUserIds.current.delete(user.id);
        setWorkspaceProvisionError('ساخت فضای کاری انجام نشد. تأیید نام کاربری، اتصال و نسخه پایگاه داده را بررسی کن و دوباره تلاش کن.');
        setWorkspaceProvisioning(false);
        return;
      }
            await refreshMemberships();
      setWorkspaceProvisioning(false);
      setWorkspaceProvisionError('');
      setNotice('فضای کاری اختصاصی آماده شد.');
    })().catch(() => {
      provisionedUserIds.current.delete(user.id);
      setWorkspaceProvisioning(false);
      setWorkspaceProvisionError('ارتباط برای ساخت فضای کاری قطع شد. دوباره تلاش کن.');
    });
  }, [user?.id, user?.user_metadata, loading, membershipsLoading, memberships.length, refreshMemberships, workspaceProvisionRetry]);

  useEffect(() => {
    const canCloseWithEscape: boolean = mode !== 'recovery';
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
    if (!neonAuth) { setError('اتصال احراز هویت در این نسخه پیکربندی نشده است. ورود آنلاین در دسترس نیست.'); return; }
    const normalizedPhone = mode === 'signup' ? normalizeIranPhone(phone) : '';
    if (mode === 'signup') {
      if (password.length < 10) { setError('رمز عبور باید حداقل ۱۰ نویسه باشد.'); return; }
      if (!normalizedPhone) { setError('شماره موبایل ایران معتبر وارد کن؛ مثال: 09121234567'); return; }
      if (password !== confirmPassword) { setError('تکرار گذرواژه یکسان نیست.'); return; }
    }
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'reset') {
        const redirectUrl = new URL((import.meta.env.BASE_URL || '/') + '#signin', window.location.origin).toString();
        const { error: resetError } = await neonAuth.resetPasswordForEmail(email.trim(), { redirectTo: redirectUrl });
        if (resetError) { setError('ارسال نام کاربری بازیابی انجام نشد. نام کاربری و تنظیمات Auth را بررسی کن.'); return; }
        setNotice('اگر این نام کاربری حساب فعالی داشته باشد، لینک بازیابی برای آن ارسال می‌شود.');
      } else if (mode === 'signup') {
        const emailRedirectTo = new URL(basePath + '/#signin', window.location.origin).toString();
        const { data, error: signUpError } = await neonAuth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo,
            data: {
              full_name: fullName.trim(),
              organization_name: organizationName.trim(),
              phone: normalizedPhone,
              requested_role: requestedRole,
              signup_workspace_pending: true,
            },
          },
        });
        if (signUpError) {
          const message = signUpError.message.toLowerCase();
          setError(message.includes('signup is disabled') || message.includes('signups not allowed')
            ? 'ثبت‌نام در تنظیمات Auth پروژه غیرفعال است؛ باید ثبت‌نام در سرویس احراز هویت فعال شود.'
            : 'ساخت حساب انجام نشد. نام کاربری را بررسی کن و اگر قبلاً حسابی با آن ساخته‌ای، وارد شو.');
          return;
        }
        if (!data.user) { setError('پاسخ سرویس ثبت‌نام معتبر نبود. دوباره تلاش کن.'); return; }
        setPassword(''); setConfirmPassword('');
        if (data.session) {
          setNotice('حساب ساخته شد؛ در حال ورود به مدار…');
          navigate(protectedDestination, { replace: true });
        } else {
          setMode('signin');
          navigate({ pathname: location.pathname, search: location.search, hash: '#signin' }, { replace: true });
          setError('حساب ساخته شد اما نشست ورود ایجاد نشد. با نام کاربری و رمز عبور وارد شو.');
        }
      } else if (mode === 'recovery') {
        if (password.length < 8) { setError('گذرواژه جدید باید حداقل ۸ نویسه باشد.'); return; }
        if (password !== confirmPassword) { setError('تکرار گذرواژه یکسان نیست.'); return; }
        const { error: updateError } = await neonAuth.updateUser({ password });
        if (updateError) { setError('تغییر گذرواژه انجام نشد. لینک بازیابی ممکن است منقضی شده باشد.'); return; }
        await neonAuth.signOut();
        setPassword(''); setConfirmPassword(''); setMode('signin'); setNotice('گذرواژه تغییر کرد. حالا با گذرواژه جدید وارد شو.');
      } else {
        const { error: authError } = await neonAuth.signInWithPassword({ email: email.trim(), password });
        if (authError) { setError('ورود انجام نشد. نام کاربری و گذرواژه را بررسی کن یا نام کاربری حساب را تأیید و دوباره تلاش کن.'); return; }
        setPassword(''); navigate(protectedDestination, { replace: true });
      }
    } catch {
      setError('ارتباط با سرویس احراز هویت برقرار نشد. اتصال اینترنت را بررسی کن و دوباره تلاش کن.');
    } finally { setBusy(false); }
  }

  async function submitRoleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) { setError('برای ثبت درخواست ابتدا وارد حساب شو.'); return; }
    if (organizationName.trim().length < 2) {
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
      setRequestId(String(result.requestId ?? ''));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ثبت درخواست دسترسی انجام نشد. دوباره تلاش کن.');
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
        <div className="access-request-heading"><span className="access-request-icon"><UserPlus size={20}/></span><div><span className="obsidian-eyebrow">فضای کاری مدار</span><h2 id="access-request-title">{user.user_metadata?.signup_workspace_pending === true ? 'آماده‌سازی فضای کاری' : 'درخواست فضای کاری'}</h2><p>{user.user_metadata?.signup_workspace_pending === true ? 'پس از تأیید نام کاربری، فضای کاری خصوصی مجموعه‌ات ساخته می‌شود.' : 'نقش را مشخص کن؛ مدیر پس از بررسی آن را تأیید یا رد می‌کند.'}</p></div></div>
        {workspaceProvisioning && <div className="auth-feedback success" role="status">در حال ساخت فضای کاری اختصاصی…</div>}
        {workspaceProvisionError && <div className="auth-feedback error workspace-provision-error" role="alert"><span>{workspaceProvisionError}</span><button type="button" onClick={() => setWorkspaceProvisionRetry(value => value + 1)}>تلاش دوباره</button></div>}
        {user.user_metadata?.signup_workspace_pending !== true && <form className="access-request-form" onSubmit={submitRoleRequest}>
          <label>نام و نام خانوادگی<input required minLength={2} maxLength={160} autoComplete="name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="نام کامل"/></label>
          <label>نوع دسترسی<select value={requestedRole} onChange={e => { setRequestedRole(e.target.value as PublicRequestedRole); setRequestId(''); }}><option value="customer">خریدار عمده</option><option value="supplier">شریک مزرعه</option><option value="driver">راننده / پیمانکار حمل</option><option value="staff">عضو تیم داخلی</option></select></label>
          <label className="wide">نام شرکت / مجموعه هدف<input required minLength={2} maxLength={160} value={organizationName} onChange={e => setOrganizationName(e.target.value)} placeholder="نام دقیق مجموعه‌ای که می‌خواهی به آن بپیوندی"/></label>
          <label>شماره تماس<input type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="اختیاری"/></label>
          {error && <div className="auth-feedback error wide" role="alert">{error}</div>}
          {notice && <div className="auth-feedback success wide" role="status">{notice}</div>}
          <button className="obsidian-primary wide" type="submit" disabled={busy || Boolean(requestId)}>{busy ? 'در حال ارسال…' : requestId ? 'درخواست ثبت شد' : 'ارسال برای تأیید مدیر'} <ArrowLeft size={16}/></button>
        </form>}
        <p className="access-request-foot"><ShieldCheck size={15}/> انتخاب نقش به‌تنهایی دسترسی نمی‌دهد. مدیر باید درخواست را در پنل کاربران بررسی کند.</p>
      </section>, waitingScreen)}
    {signInOpen && (!user || mode === 'recovery') && (
      <section className="simorgh-signin-layer" role="dialog" aria-modal="true" aria-labelledby="simorgh-signin-title" aria-label="ورود امن مدار">
        <div className="simorgh-signin-brand">
          <div className="simorgh-signin-brand-top"><span className="simorgh-signin-mark"><ShieldCheck size={26}/></span><span><strong>مدار</strong><small>مدیریت یکپارچه عملیات</small></span></div>
          <div className="simorgh-signin-story"><span className="signin-overline">مدار / فضای کاری امن</span><h1>یک شبکه.<br/><em>کنترل دقیق.</em></h1><p>مدیریت مزرعه، منابع، سفارش، کیفیت، حمل و حساب‌ها؛ در یک فضای کاری امن و قابل پیگیری.</p><div className="signin-assurance"><ShieldCheck size={17}/><span>نقش‌های داخلی و مدیریتی فقط با دعوت یا تأیید مالک فعال می‌شوند.</span></div></div>
          <div className="signin-brand-foot"><span>عملیات و منابع</span><span>ورود امن</span></div>
        </div>
        <div className="simorgh-signin-form-area">
          {!protectedRoute && mode !== 'recovery' && <button type="button" className="signin-close" onClick={closeSignIn} aria-label="بستن ورود"><X size={20}/></button>}
          <div className="simorgh-signin-form-card" dir="rtl">
            {mode === 'signin' || mode === 'signup' ? <MedarLogo compact className="signin-form-logo"/> : <span className="signin-form-icon"><KeyRound size={21}/></span>}
            <span className="signin-overline">{mode === 'signup' ? 'ثبت‌نام مجموعه' : mode === 'reset' ? 'بازیابی گذرواژه' : mode === 'recovery' ? 'تنظیم گذرواژه تازه' : 'ورود امن'}</span>
            <h2 id="simorgh-signin-title">{mode === 'signup' ? 'ساخت حساب و فضای کاری' : mode === 'reset' ? 'بازیابی گذرواژه' : mode === 'recovery' ? 'گذرواژه جدید' : 'ورود به مدار'}</h2>
            <p>{mode === 'signup' ? 'حساب بساز؛ نام کاربری، شماره موبایل، رمز عبور و نقش کافی است. انتخاب «مالک مجموعه جدید» فضای کاری جداگانه می‌سازد؛ نقش‌های دیگر با تأیید مجموعه فعال می‌شوند.' : mode === 'reset' ? 'نام کاربری حساب را وارد کن تا در صورت وجود حساب، لینک بازیابی ارسال شود.' : mode === 'recovery' ? 'یک گذرواژه جدید و قوی برای حساب انتخاب کن.' : 'با نام کاربری و گذرواژه وارد فضای کاری‌ات شو. شماره موبایل برای بازیابی و ارتباط عملیاتی حساب ثبت می‌شود.'}</p>
             <form className="simorgh-signin-form" onSubmit={event => void submitAuth(event)}>
               {mode === 'signup' && <>
                 <label htmlFor="simorgh-signin-phone">شماره موبایل</label><input id="simorgh-signin-phone" className="auth-input" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="09121234567" required dir="ltr"/>
               </>}
               {mode === 'signup' && <><label htmlFor="simorgh-signin-role">نقش مورد درخواست</label><select id="simorgh-signin-role" className="auth-input" value={requestedRole} onChange={e => setRequestedRole(e.target.value as PublicRequestedRole)}><option value="owner">مالک مجموعه جدید</option><option value="customer">خریدار عمده</option><option value="supplier">تأمین‌کننده / شریک مزرعه</option><option value="driver">راننده / حمل‌ونقل</option><option value="staff">عضو تیم (نیازمند تأیید)</option></select></>}
               <label htmlFor="simorgh-signin-username">نام کاربری</label><input id="simorgh-signin-username" className="auth-input" type="text" autoComplete="username" inputMode="text" required={mode !== 'recovery'} value={email} onChange={e => setEmail(e.target.value)} placeholder="username" dir="ltr"/>
               {mode !== 'reset' && <>
                 <label htmlFor="simorgh-signin-password">{mode === 'recovery' ? 'گذرواژه جدید' : 'گذرواژه'}</label>
                 <div className="auth-password-wrap"><input id="simorgh-signin-password" className="auth-input" type={showPassword ? 'text' : 'password'} minLength={10} autoComplete={mode === 'recovery' || mode === 'signup' ? 'new-password' : 'current-password'} required value={password} onChange={e => setPassword(e.target.value)} placeholder="حداقل ۱۰ نویسه" dir="ltr"/><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'پنهان‌کردن گذرواژه' : 'نمایش گذرواژه'}>{showPassword ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>
                 {(mode === 'recovery' || mode === 'signup') && <><label htmlFor="simorgh-confirm-password">تکرار گذرواژه</label><input id="simorgh-confirm-password" className="auth-input" type="password" autoComplete="new-password" required minLength={10} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="گذرواژه را دوباره وارد کن" dir="ltr"/></>}
               </>}
               {error && <div className="auth-feedback error" role="alert">{error}</div>}{notice && <div className="auth-feedback success" role="status">{notice}</div>}
               <button className="signin-submit" type="submit" disabled={busy || (mode !== 'recovery' && !email.trim()) || (mode !== 'reset' && !password) || (mode === 'signup' && (!phone.trim() || !confirmPassword))}>
                 {busy ? <><span className="signin-spinner" aria-hidden="true"/> در حال پردازش…</> : mode === 'reset' ? <>ارسال لینک بازیابی <RotateCcw size={16}/></> : mode === 'recovery' ? <>ذخیره گذرواژه جدید <Check size={17}/></> : mode === 'signup' ? <>ساخت حساب و فضای کاری <ArrowLeft size={17}/></> : <>ورود به فضای کار <ArrowLeft size={17}/></>}
               </button>
             </form>
             {mode === 'signin' && <><div className="signin-registration-cta"><span>برای مجموعه جدید حساب می‌خواهی؟</span><button type="button" onClick={() => {setMode('signup');setError('');setNotice('');navigate({pathname:location.pathname,search:location.search,hash:'#signup'},{replace:true});}}>ساخت حساب و فضای کاری</button></div></>}
             {(mode === 'reset' || mode === 'signup') && <button type="button" className="auth-text-action" onClick={() => {setMode('signin');setError('');setNotice('');navigate({pathname:location.pathname,search:location.search,hash:'#signin'},{replace:true});}}>بازگشت به ورود</button>}
             <div className="signin-form-foot"><span><Check size={13}/> کنترل دسترسی سمت سرور</span><span>مدار · فضای امن</span></div>
          </div>
        </div>
      </section>
    )}
  </>;
}
