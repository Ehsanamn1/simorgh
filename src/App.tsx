import type * as React from 'react';
import { Geolocation } from '@capacitor/geolocation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowLeft, ArrowUpLeft, Boxes, Building2, CalendarDays, CheckCircle2,
  ChevronDown, CircleHelp, ClipboardCheck, CreditCard, Factory, FileCheck2, FileText, House, LayoutDashboard,
  LockKeyhole, LogOut, MapPin, Menu, Monitor, Moon, Package, Plus, RefreshCw, Search, Settings2, ShieldCheck, Smartphone, Sun, Target, Truck, Users, Warehouse, X, Zap, MessageCircle,
} from 'lucide-react';
import { useAuth } from './lib/AuthContext';
import { useAppTheme } from './lib/ThemeContext';
import { dataApi } from './lib/dataClient';
import { api, isApiConfigured } from './lib/apiClient';
import { pageSectionLabel } from './lib/pageSections';
import { goalProgressPercent, isGoalOverdue } from './lib/goals';
import { evaluateSetupMilestones, summarizeSetupMilestones } from './lib/achievements';
import { OperationsWorkspacePage } from './OperationsPages';
import { MedarLogo as Logo } from './MedarLogo';
import { HelpGuide } from './HelpGuide';
import { BankReconciliationPanel } from './BankReconciliationPanel';
import { ContactImporter } from './ContactImporter';
import { ContactsHub } from './ContactsHub';
import { WorkspaceHome } from './WorkspaceHome';
import { OperationsRoleExperience } from './OperationsRoleExperience';
import { MedarConnect } from './MedarConnect';
import { OperationalExceptionInbox } from './OperationalExceptionInbox';
import type { AppRole, Membership, PageKey, Row } from './lib/types';
import { dateFa, dateTimeFa, moneyFa, numberFa, orderLabel, roleLabel, statusLabel, statusTone } from './lib/format';
import DemoWorkspace from './DemoWorkspace';

const PAGE_PERMISSION_MODULE: Record<PageKey, string> = {
  home: 'home', settings: 'home', connect: 'operational-tasks', exceptions: 'operational-tasks', contacts: 'contacts', command: 'command', agents: 'agents',
  orders: 'orders', 'purchase-orders': 'purchase-orders', customers: 'customers', suppliers: 'suppliers',
  products: 'products', inventory: 'inventory', capacity: 'capacity', quality: 'quality', shipments: 'shipments',
  finance: 'finance', members: 'members', audit: 'audit', catalog: 'products', 'my-orders': 'orders',
  'my-account': 'home', 'supplier-work': 'operational-tasks', 'supplier-capacity': 'capacity',
  'supplier-settlement': 'partner-settlements', 'driver-work': 'shipments', 'farm-sites': 'farm-sites',
  'flock-cycles': 'flock-cycles', 'production-batches': 'production-batches', 'daily-production': 'daily-production',
  'task-templates': 'task-templates', 'operational-tasks': 'operational-tasks', incidents: 'incidents',
  'partnership-agreements': 'partnership-agreements', 'partner-finance': 'partner-finance',
  'partner-settlements': 'partner-settlements', 'contacts-import': 'contacts', goals: 'goals',
};

const DEFERRED_NAV_KEYS = new Set<PageKey>(['agents', 'goals', 'audit', 'contacts-import', 'exceptions', 'quality', 'task-templates', 'partnership-agreements', 'partner-finance', 'partner-settlements', 'customers', 'contacts', 'orders', 'purchase-orders', 'products', 'inventory', 'finance', 'catalog', 'my-orders', 'my-account', 'supplier-settlement']);

const navDefinitions: { key: PageKey; label: string; group: string; icon: typeof LayoutDashboard; roles: AppRole[] }[] = [
  { key: 'home', label: 'صفحه من', group: 'شروع', icon: LayoutDashboard, roles: ['owner', 'admin', 'staff', 'supplier', 'driver', 'customer'] },
  { key: 'settings', label: 'تنظیمات', group: 'مدیریت و تنظیمات', icon: Settings2, roles: ['owner', 'admin', 'staff', 'supplier', 'driver', 'customer'] },
  { key: 'connect', label: 'مرکز ارتباطات', group: 'وظایف و رخدادها', icon: MessageCircle, roles: ['owner', 'admin', 'staff', 'supplier', 'driver', 'customer'] },
  { key: 'exceptions', label: 'صندوق مسائل', group: 'وظایف و رخدادها', icon: AlertTriangle, roles: ['owner', 'admin', 'staff'] },
  { key: 'command', label: 'مرکز فرمان', group: 'مدیریت', icon: LayoutDashboard, roles: ['owner', 'admin', 'staff'] },
  { key: 'orders', label: 'سفارش‌ها', group: 'مدیریت', icon: FileText, roles: ['owner', 'admin', 'staff'] },
  { key: 'goals', label: 'اهداف و برنامه', group: 'مدیریت', icon: Target, roles: ['owner', 'admin', 'staff'] },
  { key: 'contacts', label: 'دفترچه مخاطبین', group: 'مخاطبین', icon: Users, roles: ['owner', 'admin'] },
  { key: 'customers', label: 'مشتریان', group: 'فروش و تأمین', icon: Users, roles: ['owner', 'admin', 'staff'] },
  { key: 'suppliers', label: 'شبکه تأمین‌کنندگان', group: 'زنجیره تأمین', icon: Factory, roles: ['owner', 'admin', 'staff'] },
  { key: 'contacts-import', label: 'ورود فایل مخاطبین', group: 'مخاطبین', icon: FileCheck2, roles: ['owner', 'admin'] },
  { key: 'products', label: 'کاتالوگ و قیمت', group: 'فروش و تأمین', icon: Package, roles: ['owner', 'admin', 'staff'] },
  { key: 'purchase-orders', label: 'سفارش خرید و رسید', group: 'فروش و تأمین', icon: FileText, roles: ['owner', 'admin', 'staff'] },
  { key: 'inventory', label: 'موجودی و ثبت خرید', group: 'عملیات', icon: Warehouse, roles: ['owner', 'admin', 'staff'] },
  { key: 'capacity', label: 'برنامه ظرفیت', group: 'زنجیره تأمین', icon: Warehouse, roles: ['owner', 'admin', 'staff'] },
  { key: 'quality', label: 'کیفیت و محموله', group: 'عملیات', icon: ClipboardCheck, roles: ['owner', 'admin', 'staff'] },
  { key: 'shipments', label: 'حمل‌ونقل و رانندگان', group: 'زنجیره تأمین', icon: Truck, roles: ['owner', 'admin', 'staff'] },
  { key: 'finance', label: 'مالی و تسویه', group: 'کنترل', icon: CreditCard, roles: ['owner', 'admin', 'staff', 'supplier', 'customer'] },
  { key: 'members', label: 'دسترسی کاربران', group: 'کنترل', icon: ShieldCheck, roles: ['owner', 'admin'] },
  { key: 'audit', label: 'تاریخچه تغییرات', group: 'کنترل', icon: Activity, roles: ['owner', 'admin'] },
  { key: 'catalog', label: 'خرید سازمانی', group: 'خرید', icon: Boxes, roles: ['customer'] },
  { key: 'my-orders', label: 'سفارش‌های من', group: 'خرید', icon: FileText, roles: ['customer'] },
  { key: 'my-account', label: 'حساب سازمانی', group: 'خرید', icon: Building2, roles: ['customer'] },
  { key: 'supplier-work', label: 'کارهای واگذارشده', group: 'تأمین', icon: ClipboardCheck, roles: ['supplier'] },
  { key: 'supplier-capacity', label: 'ظرفیت من', group: 'تأمین', icon: Warehouse, roles: ['supplier'] },
  { key: 'supplier-settlement', label: 'تسویه‌های من', group: 'تأمین', icon: CreditCard, roles: ['supplier'] },
  { key: 'driver-work', label: 'محموله‌های من', group: 'ارسال', icon: Truck, roles: ['driver'] },
  { key: 'farm-sites', label: 'سایت‌های مزرعه', group: 'تولید مزرعه', icon: Warehouse, roles: ['owner', 'admin', 'staff', 'supplier'] },
  { key: 'flock-cycles', label: 'چرخه‌های کشت و پرورش', group: 'تولید مزرعه', icon: Factory, roles: ['owner', 'admin', 'staff', 'supplier'] },
  { key: 'production-batches', label: 'بچ‌های تولید', group: 'تولید مزرعه', icon: Package, roles: ['owner', 'admin', 'staff', 'supplier'] },
  { key: 'daily-production', label: 'ثبت روزانه تولید', group: 'تولید مزرعه', icon: Activity, roles: ['owner', 'admin', 'staff', 'supplier'] },
  { key: 'task-templates', label: 'دستورالعمل‌های کاری', group: 'وظایف و رخدادها', icon: ClipboardCheck, roles: ['owner', 'admin'] },
  { key: 'operational-tasks', label: 'وظایف عملیاتی', group: 'وظایف و رخدادها', icon: FileCheck2, roles: ['owner', 'admin', 'staff', 'supplier'] },
  { key: 'incidents', label: 'رخدادها و مغایرت‌ها', group: 'وظایف و رخدادها', icon: Activity, roles: ['owner', 'admin', 'staff', 'supplier'] },
  { key: 'partnership-agreements', label: 'قراردادهای مشارکت', group: 'مشارکت و مالی', icon: FileText, roles: ['owner', 'admin', 'supplier'] },
  { key: 'partner-finance', label: 'دفتر مالی شریک', group: 'مشارکت و مالی', icon: CreditCard, roles: ['owner', 'admin', 'supplier'] },
  { key: 'partner-settlements', label: 'دوره‌های تسویه', group: 'مشارکت و مالی', icon: ShieldCheck, roles: ['owner', 'admin', 'supplier'] },
];

function ConfigScreen() {
  return <main className="setup-screen" dir="rtl"><div className="setup-grid"><div className="setup-brand"><Logo/><span className="setup-chip"><span/> اتصال Worker نیازمند پیکربندی</span><h1>شبکه‌ی تأمین را<br/><em>با داده واقعی</em> اداره کنید.</h1><p>مدار برای اتصال سفارش، ظرفیت، کیفیت، ارسال و تسویه در یک جریان عملیاتی ساخته شده است. تا قبل از اتصال موفق API هیچ داده نمونه یا شاخص ساختگی نمایش داده نمی‌شود.</p><div className="setup-features"><span><ShieldCheck/> نشست امن HttpOnly</span><span><Activity/> ثبت تغییرات و پیگیری</span><span><Boxes/> فضای کاری مستقل</span></div></div><section className="setup-panel"><div className="setup-panel-icon"><Settings2/></div><span className="eyebrow">راه‌اندازی اولیه</span><h2>API مدار در دسترس نیست</h2><p>وب‌اپ باید از طریق Worker مستقرشده در Cloudflare به API مدار وصل شود. آدرس دیتابیس و تمام کلیدهای محرمانه فقط در secrets سرور قرار می‌گیرند.</p><div className="env-item"><label>DATABASE_URL</label><code>Cloudflare Worker Secret</code><button onClick={() => void navigator.clipboard?.writeText('wrangler secret put DATABASE_URL')}>کپی دستور تنظیم</button></div><div className="setup-warning"><ShieldCheck size={17}/><span>هرگز آدرس اتصال Neon یا رمز عبور دیتابیس را در متغیرهای VITE_ یا کد مرورگر قرار نده.</span></div><div className="setup-steps"><b>مراحل راه‌اندازی</b><span><i>۱</i> اجرای migrationهای Worker روی دیتابیس مقصد</span><span><i>۲</i> تنظیم DATABASE_URL به‌عنوان secret در Cloudflare</span><span><i>۳</i> استقرار Worker و آزمون /api/health</span></div></section></div><footer className="setup-footer"><span>مدار / راه‌اندازی سامانه</span><span>هیچ داده‌ای تا اتصال واقعی ساخته نشده است.</span></footer></main>;
}
function WaitingAccess({ membershipsError }: { membershipsError: string | null }) {
  const { user, signOut, refreshMemberships } = useAuth();
  return <main className="waiting-screen" dir="rtl"><Logo/><div className="waiting-mark"><ShieldCheck size={30}/></div><span className="eyebrow">بررسی دسترسی</span><h1>حساب شما هنوز به مجموعه‌ای متصل نیست.</h1><p>برای دسترسی به پنل، مالک یا مدیر باید حساب اختصاصی برایت بسازد؛ پس از آن با نام کاربری و رمز عبور وارد شو. انتخاب نقش به‌تنهایی مجوز عملیاتی ایجاد نمی‌کند.</p><div className="waiting-email"><span>نام کاربری</span><b dir="ltr">{user?.username}</b></div>{membershipsError && <div className="form-error">خواندن سطح دسترسی ناموفق بود: {membershipsError}</div>}<button className="button-primary" onClick={() => void refreshMemberships()}>بررسی دوباره دسترسی <Activity size={16}/></button><button className="button-ghost" onClick={() => void signOut()}>خروج از حساب <LogOut size={15}/></button><small>برای دریافت دسترسی، با مالک مجموعه تماس بگیر تا حساب اختصاصی با نام کاربری، رمز عبور و نقش مشخص برایت بسازد.</small></main>;
}

function MobileAccessScreen() {
  return <main className="mobile-access-screen" dir="rtl">
    <div className="mobile-access-mark"><Logo/></div>
    <span className="obsidian-eyebrow">مدار · فضای کاری خصوصی</span>
    <h1>مدار</h1>
    <p>مرکز عملیات شبکه‌ی تأمین</p>
    <div className="mobile-access-rule"><ShieldCheck size={17}/><span>اطلاعات عملیاتی فقط پس از تأیید هویت بارگذاری می‌شوند.</span></div>
  </main>;
}

function AppShell() {
  const { user, memberships, loading, error, refreshSession } = useAuth();
  const location = useLocation();
  const [membershipId, setMembershipId] = useState(''); const [mobileNav, setMobileNav] = useState(false); const [search, setSearch] = useState(''); const [guideOpen, setGuideOpen] = useState(false); const [profileOpen, setProfileOpen] = useState(false); const [profileFirstName, setProfileFirstName] = useState(''); const [profileLastName, setProfileLastName] = useState(''); const [profilePhone, setProfilePhone] = useState(''); const [profileProvince, setProfileProvince] = useState(''); const [profileCity, setProfileCity] = useState(''); const [profileAddress, setProfileAddress] = useState(''); const [profileBusy, setProfileBusy] = useState(false); const [profileError, setProfileError] = useState(''); const [mobileSearchOpen, setMobileSearchOpen] = useState(false); const [navSearch, setNavSearch] = useState(''); const searchInputRef = useRef<HTMLInputElement>(null);
  const [moduleReadPermissions, setModuleReadPermissions] = useState<Record<string, boolean> | null>(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [taskCelebration, setTaskCelebration] = useState('');
  const { theme, setTheme } = useAppTheme();
  useEffect(() => {
    const updateNetworkState = () => setIsOnline(navigator.onLine);
    const markApiOnline = () => setIsOnline(true);
    const markApiOffline = () => setIsOnline(false);
    window.addEventListener('online', updateNetworkState);
    window.addEventListener('offline', updateNetworkState);
    window.addEventListener('medar:api-online', markApiOnline);
    window.addEventListener('medar:api-offline', markApiOffline);
    return () => {
      window.removeEventListener('online', updateNetworkState);
      window.removeEventListener('offline', updateNetworkState);
      window.removeEventListener('medar:api-online', markApiOnline);
      window.removeEventListener('medar:api-offline', markApiOffline);
    };
  }, []);
  useEffect(() => {
    let timer: number | undefined;
    const handleTaskCompleted = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: string }>).detail;
      setTaskCelebration(detail?.title || 'وظیفه عملیاتی');
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => setTaskCelebration(''), 4200);
    };
    window.addEventListener('medar:task-completed', handleTaskCompleted);
    return () => {
      window.removeEventListener('medar:task-completed', handleTaskCompleted);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
  const membership = memberships.find(m => m.id === membershipId) ?? memberships[0];
  const role = membership?.role;
  useEffect(() => { if (membership && membershipId !== membership.id) setMembershipId(membership.id); }, [membership?.id, membershipId]);
  useEffect(() => {
    if (!user || !memberships.length) {
      setProfileOpen(false);
      setProfileFirstName(''); setProfileLastName(''); setProfilePhone('');
      setProfileProvince(''); setProfileCity(''); setProfileAddress('');
      return;
    }
    const name = user.full_name.trim();
    const incomplete = !user.phone.trim() || !name || name.toLocaleLowerCase('en') === user.username.toLocaleLowerCase('en') || (membership?.role === 'supplier' && !membership.supplier_id);
    if (incomplete) {
      setProfileFirstName(name && name !== user.username ? name.split(/\s+/)[0] : '');
      setProfileLastName(name && name !== user.username ? name.split(/\s+/).slice(1).join(' ') : '');
      setProfilePhone(user.phone || '');
      setProfileProvince(''); setProfileCity(''); setProfileAddress('');
      setProfileOpen(true);
    } else {
      setProfileOpen(false);
      setProfileProvince(''); setProfileCity(''); setProfileAddress('');
    }
  }, [user?.id, user?.full_name, user?.phone, user?.username, memberships.length, membership?.id, membership?.role, membership?.supplier_id]);
  // Help is opt-in: keep the workspace clear and open contextual guidance only on request.
  const saveInitialProfile = async () => {
    setProfileBusy(true); setProfileError('');
    try {
      await api.post('/api/profile/complete', { companyId: membership?.company_id, firstName: profileFirstName, lastName: profileLastName, phone: profilePhone, province: profileProvince, city: profileCity, address: profileAddress });
      setProfileOpen(false);
      await refreshSession();
    } catch (caught) {
      setProfileError(caught instanceof Error ? caught.message : 'ذخیره مشخصات حساب ناموفق بود.');
    } finally { setProfileBusy(false); }
  };
  useEffect(() => {
    let active = true;
    setModuleReadPermissions(null);
    if (!membership) return () => { active = false; };
    void api.get<{ permissions: Record<string, boolean> }>('/api/workspace/my-module-permissions?companyId=' + encodeURIComponent(membership.company_id))
      .then(result => { if (active) setModuleReadPermissions(result.permissions ?? {}); })
      .catch(() => { if (active) setModuleReadPermissions(null); });
    return () => { active = false; };
  }, [membership?.id, membership?.company_id]);
  // Keep the first release focused on daily operations. Advanced/AI pages remain in the codebase
  // but are removed from the active release and their routes redirect to the role home.
  const navItems = useMemo(() => navDefinitions.filter(n =>
    !DEFERRED_NAV_KEYS.has(n.key) && Boolean(role && n.roles.includes(role)) &&
    (n.key === 'settings' || moduleReadPermissions === null || moduleReadPermissions[PAGE_PERMISSION_MODULE[n.key]] !== false)
  ), [role, moduleReadPermissions]);
  const filteredNavItems = useMemo(() => {
    const query = navSearch.trim().toLocaleLowerCase('fa-IR');
    return query ? navItems.filter(item => (item.label + ' ' + item.group).toLocaleLowerCase('fa-IR').includes(query)) : navItems;
  }, [navItems, navSearch]);
  const navGroups = useMemo(() => {
    // Three predictable areas reduce navigation decisions without removing any enabled route.
    const groupFor = (key: PageKey): string => {
      if (['home', 'command', 'connect', 'exceptions', 'operational-tasks', 'incidents'].includes(key)) return 'خانه و پیگیری';
      if (['suppliers', 'capacity', 'shipments', 'supplier-work', 'supplier-capacity', 'driver-work', 'farm-sites', 'flock-cycles', 'production-batches', 'daily-production'].includes(key)) return 'عملیات روزانه';
      return 'مدیریت مجموعه';
    };
    const order = ['خانه و پیگیری', 'عملیات روزانه', 'مدیریت مجموعه'];
    const grouped = new Map<string, typeof navItems>();
    for (const item of filteredNavItems) {
      const label = groupFor(item.key);
      grouped.set(label, [...(grouped.get(label) ?? []), item]);
    }
    return [...grouped.entries()]
      .map(([label, items]) => ({ label, items }))
      .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  }, [filteredNavItems]);
  useEffect(() => { if (mobileSearchOpen) searchInputRef.current?.focus(); }, [mobileSearchOpen]);
  useEffect(() => { setMobileSearchOpen(false); }, [location.pathname]);
  // Every role lands on a compact, role-specific home with only its authorized shortcuts.
  const homeKey: PageKey = 'home';
  const homeDestination = navItems.some(n => n.key === homeKey) ? homeKey : (navItems[0]?.key ?? 'command');
  const routeKey = location.pathname.split('/').pop() as PageKey;
  // Deferred modules are not only hidden from navigation; their routes are disabled until explicitly re-enabled.
  const allowed = navItems.some(n => n.key === routeKey);
  const active = navItems.find(n => n.key === location.pathname.split('/').pop()) ?? navItems[0];
  if (!user) return <MobileAccessScreen/>;
  if (loading) return <LoadingScreen label="در حال بررسی نشست و دسترسی…"/>;
  if (!memberships.length) return <WaitingAccess membershipsError={error}/>;
  if (profileOpen) return <div className="profile-completion-gate" dir="rtl"><div className="profile-completion-card"><span className="profile-completion-mark"><Users size={24}/></span><span className="eyebrow">تکمیل حساب اختصاصی</span><h1>قبل از ورود، مشخصاتت را تکمیل کن</h1><p>حساب و نقش را مدیر مجموعه ساخته است. این اطلاعات برای تماس و پیگیری عملیات استفاده می‌شود و فقط در فضای کاری مجاز نمایش داده می‌شود.</p><form className="record-form" onSubmit={event => { event.preventDefault(); void saveInitialProfile(); }}><label>نام<input required maxLength={60} autoComplete="given-name" value={profileFirstName} onChange={event=>setProfileFirstName(event.target.value)} /></label><label>نام خانوادگی<input required maxLength={80} autoComplete="family-name" value={profileLastName} onChange={event=>setProfileLastName(event.target.value)} /></label><label className="full-span">شماره تلفن همراه<input required type="tel" inputMode="tel" autoComplete="tel" maxLength={24} placeholder="مثلاً ۰۹۱۲… یا +98912…" value={profilePhone} onChange={event=>setProfilePhone(event.target.value)} /></label>{role==='supplier'&&<><label>استان<input required maxLength={80} value={profileProvince} onChange={event=>setProfileProvince(event.target.value)} placeholder="استان محل فعالیت"/></label><label>شهر<input required maxLength={80} value={profileCity} onChange={event=>setProfileCity(event.target.value)} placeholder="شهر محل فعالیت"/></label><label className="full-span">نشانی دقیق محل فعالیت<input required maxLength={240} value={profileAddress} onChange={event=>setProfileAddress(event.target.value)} placeholder="خیابان، محدوده و نشانی قابل پیگیری"/></label></>}{profileError&&<div className="form-error full-span">{profileError}</div>}<div className="modal-actions full-span"><Button type="submit" disabled={profileBusy||profileFirstName.trim().length<1||profileLastName.trim().length<1||profilePhone.trim().length<7||(role==='supplier'&&(profileProvince.trim().length<2||profileCity.trim().length<2||profileAddress.trim().length<5))}>{profileBusy?'در حال ذخیره مشخصات…':'تأیید و ورود به پنل'}</Button></div></form><small>نام کاربری: <b dir="ltr">@{user.username}</b> · نقش دسترسی توسط مدیر تعیین شده و از این فرم قابل تغییر نیست.</small></div></div>;
  const companyName = membership?.company?.name || 'مجموعه مدار';
  return <div className="app-frame" dir="rtl">
    <aside className={`app-sidebar ${mobileNav ? 'open' : ''}`}><div className="sidebar-brand"><div className="sidebar-brand-lockup"><Logo/><span className="sidebar-parent-brand">محصول دیجیتال راز صحرا</span></div><button type="button" className="sidebar-close" aria-label="بستن پنل" onClick={() => setMobileNav(false)}><X size={17}/></button></div><button className="workspace-switch" disabled={memberships.length <= 1} onClick={() => memberships.length > 1 && setMembershipId(memberships[(memberships.findIndex(m => m.id === membership?.id) + 1) % memberships.length].id)}><span className="workspace-avatar">{companyName.slice(0,1)}</span><span><b>{companyName}</b><small>{roleLabel[role ?? '']}</small></span>{memberships.length > 1 ? <ChevronDown size={15}/> : <span className="workspace-lock"><ShieldCheck size={14}/></span>}</button><div className="nav-caption">فضای کاری</div>
      <label className="sidebar-search"><Search size={16}/><input value={navSearch} onChange={event => setNavSearch(event.target.value)} placeholder="جست‌وجوی بخش‌ها…" aria-label="جست‌وجو در فهرست بخش‌ها"/>{navSearch && <button type="button" onClick={() => setNavSearch('')} aria-label="پاک‌کردن جست‌وجوی بخش‌ها"><X size={14}/></button>}</label>
      <div className="nav-tools-box"><div className="nav-tools-box-heading"><span><Boxes size={15}/> منوی اصلی</span><small>{filteredNavItems.length.toLocaleString('fa-IR')}</small></div><div className="nav-groups">{navGroups.map(group => <details className="nav-group" key={group.label} open={Boolean(navSearch.trim()) || group.items.some(item => item.key === active?.key) || (role === 'supplier' && group.items.some(item => item.key === 'supplier-work')) || (role === 'driver' && group.items.some(item => item.key === 'driver-work')) || (role === 'customer' && group.items.some(item => ['catalog', 'my-orders', 'my-account'].includes(item.key)))}><summary><span>{group.label}</span><small>{group.items.length.toLocaleString('fa-IR')}</small></summary><nav className="side-nav">{group.items.map(item => {const Icon = item.icon; const current = active?.key === item.key; return <Link to={'/app/' + item.key} key={item.key} onClick={() => setMobileNav(false)} className={[current ? 'selected' : '', item.key === 'members' ? 'nav-primary-access' : '', item.key === 'connect' ? 'nav-primary-connect' : ''].filter(Boolean).join(' ')}><Icon size={17}/><span>{item.label}</span></Link>;})}</nav></details>)}</div></div></aside>
        <button type="button" className="floating-help-trigger" onClick={() => setGuideOpen(open => !open)} aria-label={guideOpen ? 'بستن راهنمای این بخش' : 'بازکردن راهنمای این بخش'} aria-expanded={guideOpen} title="راهنمای این بخش">{guideOpen ? <X size={19}/> : <CircleHelp size={20}/>}<span>راهنما</span></button>
        {guideOpen && <HelpGuide key={location.pathname} role={role} section={routeKey} onClose={() => setGuideOpen(false)}/>} 
    {mobileNav && <button aria-label="بستن منو" className="mobile-scrim" onClick={() => setMobileNav(false)}/>} 
    <main className="app-main"><header className="app-topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="بازکردن منو"><Menu size={19}/></button><div className="breadcrumbs"><span>مدار</span><i>/</i><b>{active?.label ?? 'مرکز فرمان'}</b></div><Link to={'/app/' + homeDestination} className="topbar-home-link" aria-label="بازگشت به صفحه اصلی" title="صفحه اصلی"><House size={17}/><span>صفحه اصلی</span></Link><div className="topbar-tools"><button type="button" className="icon-action mobile-search-toggle" onClick={() => setMobileSearchOpen(open => !open)} aria-label={mobileSearchOpen ? "بستن جست‌وجو" : "بازکردن جست‌وجو"} aria-expanded={mobileSearchOpen}>{mobileSearchOpen ? <X size={17}/> : <Search size={17}/>}</button><label className={"global-search" + (mobileSearchOpen ? " mobile-open" : "")}><Search size={16}/><input ref={searchInputRef} placeholder="جست‌وجو در بخش فعلی…" value={search} onChange={e => setSearch(e.target.value)} aria-label="جست‌وجو در بخش فعلی"/></label><span className={`network-status ${isOnline ? 'is-online' : 'is-offline'}`} aria-label={isOnline ? 'اتصال برقرار است' : 'اتصال قطع است'} title={isOnline ? 'اتصال برقرار است' : 'آفلاین؛ داده‌های جدید تا همگام‌سازی قطعی نیستند'} aria-live="polite"><i/></span><button className="icon-action theme-toggle" type="button" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'فعال‌کردن حالت روشن' : 'فعال‌کردن حالت تاریک'} aria-label="تغییر حالت نمایش" aria-pressed={theme === 'light'}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button><span className="topbar-sep"/><span className="topbar-user"><b>{companyName}</b><small><span className="topbar-role">{roleLabel[role ?? '']}</span><span> · {new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium'}).format(new Date())}</span></small></span></div></header>{taskCelebration&&<div className="task-celebration-toast" role="status" aria-live="polite"><span className="task-celebration-icon"><CheckCircle2 size={19}/></span><span><b>آفرین! کار تأیید و تکمیل شد</b><small>{taskCelebration}</small></span><Zap size={17} className="task-celebration-spark"/></div>}{!isOnline&&<div className="offline-notice" role="status"><AlertTriangle size={17}/><span><b>حالت آفلاین</b> آخرین داده‌های ذخیره‌شده برای مشاهده در دسترس‌اند؛ ثبت یا تغییرات جدید تا تأیید سرور قطعی نیستند. پس از اتصال دوباره، وضعیت را تازه‌سازی کن.</span></div>}<div className="page-container">{!allowed ? <Navigate to={`/app/${homeDestination}`} replace/> : <Routes><Route path="home" element={(['owner','admin'].includes(String(role)) ? <OperationsRoleExperience role="manager" membership={membership!}><WorkspaceHome membership={membership!} userName={String(user.full_name || user.username || '')}/></OperationsRoleExperience> : <WorkspaceHome membership={membership!} userName={String(user.full_name || user.username || '')}/>)}/><Route path="settings" element={<SettingsPage membership={membership!}/>}/><Route path="connect" element={<MedarConnect membership={membership!}/>}/><Route path="exceptions" element={<Navigate to={'/app/' + homeDestination} replace/>}/><Route path="command" element={<Dashboard membership={membership!}/>}/><Route path="orders" element={<Navigate to={'/app/' + homeDestination} replace/>}/><Route path="goals" element={<Navigate to={'/app/' + homeDestination} replace/>}/><Route path="customers" element={<Navigate to={'/app/' + homeDestination} replace/>}/><Route path="suppliers" element={<EntityPage membership={membership!} table="suppliers" title="شبکه تأمین" description="پرونده تأمین‌کننده با استان، شهر و نشانی قابل‌فهم؛ استان و شهر کافی است؛ در صورت داشتن لینک کامل Google Maps یا OpenStreetMap، نقطه از لینک استخراج می‌شود و نیازی به واردکردن عرض/طول نیست." fields={[{name:'name',label:'نام تأمین‌کننده',required:true},{name:'province',label:'استان'},{name:'city',label:'شهر'},{name:'address',label:'نشانی یا لینک کامل نقشه (اختیاری)'},{name:'phone',label:'شماره تماس',type:'tel'},{name:'farm_registration',label:'شناسه یا مجوز مزرعه'}]} columns={[{key:'name',label:'تأمین‌کننده'},{key:'province',label:'استان'},{key:'city',label:'شهر'},{key:'address',label:'نشانی / نقشه',render:r=>{const value=String(r.address??'');return /^https?:\/\//i.test(value)?<a href={value} target="_blank" rel="noreferrer">بازکردن نقشه</a>:value||'—';}},{key:'phone',label:'تلفن'},{key:'farm_registration',label:'شناسه مزرعه'},{key:'active',label:'وضعیت'}]} search={search}/>}/><Route path="products" element={<Navigate to={'/app/' + homeDestination} replace/>}/><Route path="purchase-orders" element={<Navigate to={'/app/' + homeDestination} replace/>}/><Route path="inventory" element={<InventoryPage membership={membership!} search={search}/>}/><Route path="capacity" element={<CapacityPage membership={membership!} search={search}/>}/><Route path="quality" element={<QualityPage membership={membership!} search={search}/>}/><Route path="shipments" element={<ShipmentsPage membership={membership!} search={search}/>}/><Route path="finance" element={<Navigate to={'/app/' + homeDestination} replace/>}/><Route path="members" element={<MembersPage membership={membership!} search={search}/>}/><Route path="audit" element={<AuditPage membership={membership!} search={search}/>}/><Route path="contacts" element={<Navigate to={'/app/' + homeDestination} replace/>}/><Route path="contacts-import" element={<Navigate to={'/app/' + homeDestination} replace/>}/><Route path="catalog" element={<Navigate to={'/app/' + homeDestination} replace/>}/><Route path="my-orders" element={<Navigate to={'/app/' + homeDestination} replace/>}/><Route path="my-account" element={<Navigate to={'/app/' + homeDestination} replace/>}/><Route path="supplier-work" element={<OperationsRoleExperience role="supplier" membership={membership!}><SupplierWork membership={membership!} search={search}/></OperationsRoleExperience>}/><Route path="supplier-capacity" element={<SupplierCapacityPage membership={membership!} search={search}/>}/><Route path="supplier-settlement" element={<SupplierSettlementPage membership={membership!} search={search}/>}/><Route path="driver-work" element={<OperationsRoleExperience role="driver" membership={membership!}><ShipmentsPage membership={membership!} search={search} driverMode/></OperationsRoleExperience>}/><Route path="farm-sites" element={<OperationsWorkspacePage kind="farm-sites" membership={membership!} search={search}/>}/><Route path="flock-cycles" element={<OperationsWorkspacePage kind="flock-cycles" membership={membership!} search={search}/>}/><Route path="production-batches" element={<OperationsWorkspacePage kind="production-batches" membership={membership!} search={search}/>}/><Route path="daily-production" element={<OperationsWorkspacePage kind="daily-production" membership={membership!} search={search}/>}/><Route path="task-templates" element={<OperationsWorkspacePage kind="task-templates" membership={membership!} search={search}/>}/><Route path="operational-tasks" element={<OperationsWorkspacePage kind="operational-tasks" membership={membership!} search={search}/>}/><Route path="incidents" element={<OperationsWorkspacePage kind="incidents" membership={membership!} search={search}/>}/><Route path="partnership-agreements" element={<OperationsWorkspacePage kind="partnership-agreements" membership={membership!} search={search}/>}/><Route path="partner-finance" element={<OperationsWorkspacePage kind="partner-finance" membership={membership!} search={search}/>}/><Route path="partner-settlements" element={<OperationsWorkspacePage kind="partner-settlements" membership={membership!} search={search}/>}/><Route path="*" element={<Navigate to={`/app/${homeDestination}`} replace/>}/></Routes>}</div>{['owner','admin','staff'].includes(String(role))?<nav className="mobile-workspace-nav" aria-label="ناوبری سریع موبایل"><Link to="/app/command" aria-current={active?.key==='command'?'page':undefined}><LayoutDashboard size={18}/><span>نمای کلی</span></Link><Link to="/app/connect" aria-current={active?.key==='connect'?'page':undefined}><MessageCircle size={18}/><span>مرکز ارتباطات</span></Link><Link to="/app/shipments" aria-current={active?.key==='shipments'?'page':undefined}><Truck size={18}/><span>ارسال‌ها</span></Link><button type="button" aria-label="بازکردن فهرست ماژول‌ها" onClick={()=>setMobileNav(true)}><Menu size={19}/><span>بخش‌ها</span></button></nav>:String(role)==='supplier'?<nav className="mobile-workspace-nav" aria-label="ناوبری سریع موبایل"><Link to="/app/operational-tasks" aria-current={active?.key==='operational-tasks'?'page':undefined}><FileCheck2 size={18}/><span>وظایف</span></Link><Link to="/app/daily-production" aria-current={active?.key==='daily-production'?'page':undefined}><Activity size={18}/><span>ثبت تولید</span></Link><Link to="/app/connect" aria-current={active?.key==='connect'?'page':undefined}><MessageCircle size={18}/><span>مرکز ارتباطات</span></Link><button type="button" aria-label="بازکردن فهرست ماژول‌ها" onClick={()=>setMobileNav(true)}><Menu size={19}/><span>بخش‌ها</span></button></nav>:String(role)==='driver'?<nav className="mobile-workspace-nav" aria-label="ناوبری سریع موبایل"><Link to="/app/driver-work" aria-current={active?.key==='driver-work'?'page':undefined}><Truck size={18}/><span>محموله‌ها</span></Link><Link to="/app/driver-work#driver-map"><MapPin size={18}/><span>نقشه</span></Link><Link to="/app/driver-work#driver-proof"><FileText size={18}/><span>مدرک</span></Link><button type="button" aria-label="بازکردن فهرست ماژول‌ها" onClick={()=>setMobileNav(true)}><Menu size={19}/><span>بخش‌ها</span></button></nav>:null}<footer className="app-footer"><span><Logo compact/> <b>مدار</b> · محصول عملیاتی راز صحرا</span><span>تاریخچه تغییرات فعال <i/> داده‌های واقعی پایگاه داده</span></footer></main>
  </div>;
}

type PwaInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
};

function SettingsPage({ membership }: { membership: Membership }) {
  const { theme, setTheme } = useAppTheme(); const { user, signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false); const [passwordError, setPasswordError] = useState(''); const [passwordNotice, setPasswordNotice] = useState('');
  const [health, setHealth] = useState<SystemHealthSnapshot | null>(null); const [clients, setClients] = useState<ClientPresenceRow[]>([]);
  const [connectionLoading, setConnectionLoading] = useState(false); const [connectionError, setConnectionError] = useState('');
  const [installPrompt, setInstallPrompt] = useState<PwaInstallPromptEvent | null>(null);
  const [pwaInstalled, setPwaInstalled] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as PwaInstallPromptEvent);
    };
    const handleInstalled = () => {
      setPwaInstalled(true);
      setInstallPrompt(null);
      setShowInstallHelp(false);
    };
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setPwaInstalled(standalone);
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);
  const canManage = membership.role === 'owner' || membership.role === 'admin';
  const refreshConnection = useCallback(async () => {
    setConnectionLoading(true); setConnectionError('');
    const checks = await Promise.allSettled([api.get<SystemHealthSnapshot>('/api/health'), canManage ? api.get<{ clients: ClientPresenceRow[] }>('/api/admin/system/clients?companyId=' + encodeURIComponent(membership.company_id)) : Promise.resolve({ clients: [] as ClientPresenceRow[] })]);
    const issues: string[] = [];
    if (checks[0].status === 'fulfilled') setHealth(checks[0].value); else { setHealth(null); issues.push('وضعیت سرویس مرکزی دریافت نشد.'); }
    if (checks[1].status === 'fulfilled') setClients(checks[1].value.clients ?? []); else { setClients([]); issues.push('وضعیت دستگاه‌های این مجموعه دریافت نشد.'); }
    setConnectionError(issues.join(' ')); setConnectionLoading(false);
  }, [canManage, membership.company_id]);
  useEffect(() => { void refreshConnection(); }, [refreshConnection]);
  async function requestInstall() {
    if (!installPrompt) {
      setShowInstallHelp(value => !value);
      return;
    }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setPwaInstalled(true);
      setInstallPrompt(null);
      setShowInstallHelp(choice.outcome !== 'accepted');
    } catch {
      setShowInstallHelp(true);
    }
  }
  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPasswordError(''); setPasswordNotice('');
    if (newPassword.length < 8 || newPassword.length > 128) { setPasswordError('گذرواژه جدید باید بین ۸ تا ۱۲۸ نویسه باشد.'); return; }
    if (newPassword !== confirmNewPassword) { setPasswordError('تکرار گذرواژه جدید یکسان نیست.'); return; }
    setPasswordBusy(true);
    try { const result = await api.post<{ ok: boolean; message?: string }>('/api/auth/password/change', { currentPassword, newPassword }); setCurrentPassword(''); setNewPassword(''); setConfirmNewPassword(''); setPasswordNotice(result.message || 'گذرواژه با موفقیت تغییر کرد.'); }
    catch (caught) { setPasswordError(caught instanceof Error ? caught.message : 'تغییر گذرواژه ناموفق بود.'); } finally { setPasswordBusy(false); }
  }
  return <div className="medar-settings-page" dir="rtl">
    <PageHeading eyebrow="حساب و ترجیحات" title="تنظیمات مدار" description="امنیت حساب، وضعیت اتصال و ظاهر برنامه را از یک محل مدیریت کن."/>
    <section className="settings-section settings-install">
      <div className="settings-section-heading">
        <span className="settings-icon"><Smartphone size={19}/></span>
        <div><h2>نصب مدار روی دستگاه</h2><p>مدار را به صفحهٔ اصلی گوشی یا رایانه اضافه کن؛ حساب‌ها و داده‌ها از همان سرویس امن مشترک استفاده می‌کنند.</p></div>
      </div>
      <div className="settings-form-actions">
        {pwaInstalled
          ? <span className="form-success" role="status"><CheckCircle2 size={16}/> مدار روی این دستگاه نصب است.</span>
          : <Button variant="primary" onClick={() => void requestInstall()}><Smartphone size={16}/>{installPrompt ? 'نصب مدار' : 'راهنمای نصب مدار'}</Button>}
        <span>برای نصب وب‌اپ، آدرس باید از HTTPS باز شده باشد.</span>
      </div>
      {showInstallHelp && !pwaInstalled && <div className="settings-install-help" role="status">
        <b>افزودن مدار به صفحهٔ اصلی</b>
        <p><strong>اندروید و رایانه:</strong> در Chrome یا Edge منوی مرورگر را باز کن و «Install app / نصب برنامه» یا «Add to Home screen / افزودن به صفحهٔ اصلی» را انتخاب کن.</p>
        <p><strong>iPhone و iPad:</strong> صفحه را در Safari باز کن، Share (اشتراک‌گذاری) را بزن و «Add to Home Screen / افزودن به صفحهٔ اصلی» را انتخاب کن.</p>
        <p>اگر گزینهٔ نصب نمایش داده نمی‌شود، مطمئن شو از HTTPS استفاده می‌کنی و صفحهٔ برنامهٔ عملیاتی را باز کرده‌ای.</p>
      </div>}
    </section>
    <section className="settings-section settings-appearance"><div className="settings-section-heading"><span className="settings-icon"><Sun size={19}/></span><div><h2>ظاهر برنامه</h2><p>حالت نمایش برای همهٔ بخش‌های مدار ذخیره می‌شود.</p></div></div>
      <div className="settings-theme-options" role="group" aria-label="انتخاب حالت نمایش"><button type="button" className={theme === 'light' ? 'is-selected' : ''} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={18}/><span><b>حالت روشن</b><small>روشن و خوانا</small></span>{theme === 'light' && <CheckCircle2 size={17}/>}</button><button type="button" className={theme === 'dark' ? 'is-selected' : ''} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={18}/><span><b>حالت تاریک</b><small>آرام برای محیط کم‌نور</small></span>{theme === 'dark' && <CheckCircle2 size={17}/>}</button></div></section>
    <section className="settings-section settings-account-actions"><div className="settings-section-heading"><span className="settings-icon"><ShieldCheck size={19}/></span><div><h2>حساب کاربری</h2><p>خروج امن از حساب فقط از این بخش انجام می‌شود.</p></div></div><div className="settings-form-actions"><button type="button" className="button-danger" onClick={() => void signOut()}><LogOut size={16}/> خروج از حساب</button><span>نام کاربری: {String(user?.username || 'کاربر مدار')}</span></div></section>
    <section className="settings-section settings-security"><div className="settings-section-heading"><span className="settings-icon"><LockKeyhole size={19}/></span><div><h2>امنیت حساب</h2><p>تغییر گذرواژه در تنظیمات؛ فرم دیگر فضای پنل‌های عملیاتی را اشغال نمی‌کند.</p></div></div>
      <form className="settings-password-form" onSubmit={event => void changePassword(event)}><label htmlFor="settings-current-password">گذرواژه فعلی<input id="settings-current-password" type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}/></label><label htmlFor="settings-new-password">گذرواژه جدید<input id="settings-new-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)}/><small>حداقل ۸ نویسه؛ حداکثر ۱۲۸ نویسه</small></label><label htmlFor="settings-confirm-password">تکرار گذرواژه<input id="settings-confirm-password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmNewPassword} onChange={event => setConfirmNewPassword(event.target.value)}/></label>
        {passwordError && <div className="form-error" role="alert">{passwordError}</div>}{passwordNotice && <div className="form-success" role="status">{passwordNotice}</div>}<div className="settings-form-actions"><button className="button-primary" type="submit" disabled={passwordBusy || !currentPassword || !newPassword || !confirmNewPassword}>{passwordBusy ? 'در حال ذخیره…' : 'ذخیره گذرواژه جدید'}</button><span>حساب: {String(user?.full_name || user?.username || 'کاربر مدار')}</span></div>
      </form></section>
    <section className="settings-section settings-connection"><div className="settings-section-heading"><span className="settings-icon"><Activity size={19}/></span><div><h2>اتصال مدار</h2><p>وضعیت واقعی سرویس و پایگاه داده؛ وضعیت سبز فقط پس از پاسخ موفق سرور نمایش داده می‌شود.</p></div><button className="button-soft settings-refresh" type="button" onClick={() => void refreshConnection()} disabled={connectionLoading}><RefreshCw size={15}/>{connectionLoading ? 'در حال بررسی…' : 'بررسی دوباره'}</button></div>
      <div className="settings-connection-grid"><article><span>سرویس مرکزی</span><b className={health?.ok ? 'is-healthy' : 'is-unhealthy'}>{connectionLoading && !health ? 'در حال بررسی…' : health?.ok ? 'پاسخ‌گو' : 'تأیید نشده'}</b><small>{health?.service === 'medar-ops' ? 'محیط عملیاتی' : health?.service === 'medar-api' ? 'محیط API' : 'بررسی زنده از سرور'}</small></article><article><span>پایگاه داده</span><b className={health?.database ? 'is-healthy' : 'is-unhealthy'}>{connectionLoading && !health ? 'در حال بررسی…' : health?.database ? 'متصل' : 'تأیید نشده'}</b><small>نتیجهٔ بررسی Worker</small></article>{canManage && <article><span>دستگاه‌های شناخته‌شده</span><b>{connectionLoading && clients.length === 0 ? '—' : numberFa(clients.length)}</b><small>وب، اندروید و iOS</small></article>}{canManage && <article><span>فعال در ۳ دقیقهٔ اخیر</span><b>{numberFa(clients.filter(client => client.online).length)}</b><small>بر اساس heartbeat اخیر</small></article>}</div>
      {connectionError && <div className="settings-error" role="alert">{connectionError}</div>}{canManage && <div className="settings-devices"><h3>آخرین دستگاه‌ها</h3>{connectionLoading && clients.length === 0 ? <p>در حال دریافت اطلاعات…</p> : clients.length === 0 ? <p>هنوز دستگاهی برای این مجموعه ثبت نشده است.</p> : clients.slice(0, 6).map(client => { const DeviceIcon = client.platform === 'web' ? Monitor : Smartphone; const platformLabel = client.platform === 'web' ? 'وب' : client.platform === 'android' ? 'اندروید' : 'iOS'; return <div className="settings-device-row" key={client.clientId + ':' + client.username}><DeviceIcon size={17}/><span><b>{client.username}</b><small>{platformLabel} · نسخه {client.appVersion} · {roleLabel[client.role] ?? client.role}</small></span><span className={client.online ? 'is-healthy' : 'is-unhealthy'}>{client.online ? 'متصل' : 'اخیراً فعال بوده'}</span><time dateTime={client.lastSeenAt}>{dateTimeFa(client.lastSeenAt)}</time></div>;})}</div>}
    </section></div>;
}
function LoadingScreen({ label }: { label: string }) { return <div className="loading-screen" dir="rtl"><Logo/><span className="spinner"/><p>{label}</p></div>; }
function EmptyState({ title, description, icon: Icon = Boxes }: { title: string; description: string; icon?: typeof Boxes }) { return <div className="empty-state"><span><Icon size={25}/></span><b>{title}</b><p>{description}</p></div>; }
function InlineError({ error, retry }: { error: string; retry?: () => void }) { return <div className="inline-error"><span>!</span><div><b>دریافت اطلاعات ناموفق بود</b><p>{error}</p>{retry && <button onClick={retry}>تلاش دوباره</button>}</div></div>; }
function Badge({ value, type = 'status' }: { value: unknown; type?: 'status' | 'role' }) { const label = type === 'role' ? roleLabel[String(value)] : orderLabel[String(value)] ?? statusLabel[String(value)] ?? String(value ?? '—'); return <span className={`status-badge ${type === 'role' ? 'neutral' : statusTone(value)}`}><i/>{label}</span>; }
function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="page-heading"><div><div className="eyebrow"><span/>{pageSectionLabel(eyebrow)}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-heading-actions">{action}</div>}</div>; }
function Button({ children, onClick, variant = 'primary', disabled = false, type = 'button' }: { children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'soft' | 'ghost' | 'danger'; disabled?: boolean; type?: 'button' | 'submit' }) { return <button type={type} onClick={onClick} disabled={disabled} className={`button-${variant}`} >{children}</button>; }
function useDbRows(table: string, membership: Membership, options?: { select?: string; order?: string; ascending?: boolean; filters?: [string,string,unknown][]; enabled?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const refresh = async () => { if (!dataApi || options?.enabled === false) { setLoading(false); return; } setLoading(true); setError(''); let q = dataApi.from(table).select(options?.select ?? '*').eq('company_id', membership.company_id); for (const [column,op,value] of options?.filters ?? []) { if (op === 'eq') q = q.eq(column,value as string); } q = q.order(options?.order ?? 'created_at',{ascending:options?.ascending ?? false}); const {data,error:err}=await q.limit(250); if(err) { setError(err.message); setRows([]); } else setRows((data ?? []) as unknown as Row[]); setLoading(false); };
  useEffect(() => { void refresh(); // table reads are refreshed after mutations; intentionally not subscribing to every dependency.

  }, [table,membership.company_id, options?.enabled, options?.order]);
  return {rows,loading,error,refresh,setRows};
}
const farmSiteTypeLabels: Record<string,string> = {
  crop:'کشت زراعی', livestock:'دامداری', poultry:'پرورش طیور', aquaculture:'آبزی‌پروری',
  greenhouse:'گلخانه', orchard:'باغ', processing:'فرآوری', warehouse:'انبار',
  distribution:'توزیع', mixed:'چندمنظوره', other:'سایر',
};

function farmSiteIcon(siteType: unknown, size = 18) {
  switch (String(siteType ?? 'mixed')) {
    case 'warehouse': return <Warehouse size={size}/>;
    case 'distribution': return <Truck size={size}/>;
    case 'processing':
    case 'livestock':
    case 'poultry':
    case 'aquaculture':
    case 'greenhouse':
    case 'orchard':
    case 'crop': return <Factory size={size}/>;
    case 'mixed': return <Building2 size={size}/>;
    case 'supplier': return <Factory size={size}/>;
    default: return <MapPin size={size}/>;
  }
}

function FarmMapPanel({sites,schemaWarning,membership}:{sites:Row[];schemaWarning:string;membership:Membership}) {
  const mapped = useMemo(() => sites.filter(site => {
    const lat = site.latitude, lon = site.longitude;
    return lat !== null && lat !== undefined && lat !== '' && lon !== null && lon !== undefined && lon !== ''
      && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))
      && Number(lat) >= -90 && Number(lat) <= 90 && Number(lon) >= -180 && Number(lon) <= 180;
  }), [sites]);

  const [selectedId, setSelectedId] = useState('');
  const [fleetShipments,setFleetShipments] = useState<Row[]>([]);
  const [fleetLatest,setFleetLatest] = useState<Record<string,Row>>({});
  const [fleetLastRefresh,setFleetLastRefresh] = useState('');
  const [fleetNotice,setFleetNotice] = useState('');
  const canViewFleet = ['owner','admin','staff'].includes(membership.role);
  useEffect(()=>{
    if(!dataApi||!canViewFleet)return;
    let disposed=false;
    const refreshFleet=async()=>{
      try{
        const shipmentResult=await dataApi.from('shipments').select('id,driver_user_id,stage,vehicle,planned_departure').eq('company_id',membership.company_id).in('stage',['loading','in_transit','arrived']).limit(200);
        if(shipmentResult.error)throw new Error(shipmentResult.error.message);
        const active=(shipmentResult.data??[]) as Row[];
        if(disposed)return;
        setFleetShipments(active);
        if(!active.length){setFleetLatest({});setFleetLastRefresh(new Date().toISOString());setFleetNotice('');return;}
        const pointResult=await dataApi.from('shipment_locations').select('id,shipment_id,latitude,longitude,accuracy_m,captured_at,driver_user_id').eq('company_id',membership.company_id).in('shipment_id',active.map(row=>String(row.id))).order('captured_at',{ascending:false}).limit(600);
        if(pointResult.error)throw new Error(pointResult.error.message);
        if(disposed)return;
        const latest:Record<string,Row>={};
        for(const point of (pointResult.data??[]) as Row[]){
          const key=String(point.shipment_id);
          if(!latest[key])latest[key]=point;
        }
        setFleetLatest(latest);
        setFleetLastRefresh(new Date().toISOString());
        setFleetNotice('');
      }catch(caught){
        if(!disposed){setFleetNotice(caught instanceof Error?caught.message:'دریافت موقعیت ناوگان ممکن نشد.');setFleetLastRefresh(new Date().toISOString());}
      }
    };
    void refreshFleet();
    const timer=window.setInterval(()=>void refreshFleet(),15000);
    return ()=>{disposed=true;window.clearInterval(timer);};
  },[membership.company_id,membership.role,canViewFleet]);
  const freshFleetPoints = useMemo(() => Object.entries(fleetLatest).flatMap(([shipmentId, point]) => {
    const shipment = fleetShipments.find(item => String(item.id) === shipmentId);
    if (!shipment) return [];
    const latitude = Number(point.latitude), longitude = Number(point.longitude);
    const capturedAt = Date.parse(String(point.captured_at ?? ''));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
        !Number.isFinite(capturedAt) || Date.now() - capturedAt > 5 * 60 * 1000 || capturedAt > Date.now() + 60 * 1000) return [];
    return [{ shipmentId, shipment, point, latitude, longitude, capturedAt }];
  }), [fleetLatest, fleetShipments, fleetLastRefresh]);

  // Only real map tiles and recorded coordinates are shown; no schematic map.
  const visibleMapped = mapped;
  const visibleFleetPoints = freshFleetPoints;
  useEffect(() => {
    setSelectedId(old => visibleMapped.some(site => String(site.id) === old) ? old : String(visibleMapped[0]?.id ?? ''));
  }, [visibleMapped]);

  const bounds = useMemo(() => {
    const clampLatitude = (value:number) => Math.min(85.0511,Math.max(-85.0511,value));
    const mapPoints = [
      ...visibleMapped.map(site => ({ latitude: Number(site.latitude), longitude: Number(site.longitude) })),
      ...visibleFleetPoints.map(item => ({ latitude: item.latitude, longitude: item.longitude })),
    ];
    if (!mapPoints.length) return {west:43,east:65,south:24,north:41};
    const latitudes = mapPoints.map(point=>clampLatitude(point.latitude));
    const longitudes = mapPoints.map(point=>point.longitude);
    const rawSouth=Math.min(...latitudes),rawNorth=Math.max(...latitudes);
    const rawWest=Math.min(...longitudes),rawEast=Math.max(...longitudes);
    const latPad=Math.max(0.12,(rawNorth-rawSouth)*0.18);
    const lonPad=Math.max(0.12,(rawEast-rawWest)*0.18);
    let south=Math.max(-85.0511,rawSouth-latPad),north=Math.min(85.0511,rawNorth+latPad);
    let west=Math.max(-180,rawWest-lonPad),east=Math.min(180,rawEast+lonPad);
    if(north-south<0.12){south=Math.max(-85.0511,rawSouth-0.12);north=Math.min(85.0511,rawNorth+0.12);}
    if(east-west<0.12){west=Math.max(-180,rawWest-0.12);east=Math.min(180,rawEast+0.12);}
    return {west,east,south,north};
  }, [visibleMapped, visibleFleetPoints]);
  const mapY = (latitude:number) => {
    const project=(value:number)=>Math.log(Math.tan(Math.PI/4+Math.min(85.0511,Math.max(-85.0511,value))*Math.PI/360));
    const north=project(bounds.north),south=project(bounds.south);
    return south===north?50:(project(latitude)-north)/(south-north)*100;
  };
  const bbox=[bounds.west,bounds.south,bounds.east,bounds.north].map(value=>value.toFixed(6)).join('%2C');
  const mapUrl=`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik`;
  const siteName=(site:Row)=>String(site.name??site.site_code??'سایت بدون نام');
  const markerPosition=(site:Row)=>({
    x:Math.min(98,Math.max(2,(Number(site.longitude)-bounds.west)/(bounds.east-bounds.west)*100)),
    y:Math.min(98,Math.max(2,mapY(Number(site.latitude)))),
  });
  return <section className="panel farm-map-panel">
    <div className="panel-heading">
      <div><span className="section-number">۰۳</span><div><h3>نقشه‌ی عملیات و سایت‌ها</h3><p>نشانگرها از موقعیت‌های واقعی ثبت‌شده خوانده می‌شوند؛ برای انتخاب هر موقعیت، روی نشانگر یا نام آن بزن.</p></div></div>
      <span className="status-badge neutral">{numberFa(visibleMapped.length + visibleFleetPoints.length)} موقعیت زنده/ثبت‌شده</span>
    </div>
    {schemaWarning && <div className="farm-map-warning"><MapPin size={18}/><div><b>داده‌های مختصات هنوز کامل نیستند</b><p>{schemaWarning}</p><small>پس از ثبت موقعیت نقشه یا دریافت GPS مجاز راننده، نشانگر واقعی نمایش داده می‌شود.</small></div></div>}
    {(mapped.length > 0 || fleetShipments.length > 0) ? <div className="farm-map-layout">
      <div className="farm-map-canvas">
        <iframe title="نقشه‌ی جغرافیایی سایت‌های مجموعه" src={mapUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade"/>
        {visibleMapped.map((site,index)=>{
          const {x,y}=markerPosition(site);
          const active=String(site.id)===selectedId;
          return <button type="button" key={String(site.id)} className={'farm-map-marker'+(active?' active':'')} style={{left:x+'%',top:y+'%'}} aria-label={'انتخاب '+siteName(site)} aria-pressed={active} title={siteName(site)} onClick={()=>setSelectedId(String(site.id))}>
            <span className="farm-map-marker-icon">{farmSiteIcon(site.site_type,18)}</span>
            {active&&<span className="farm-map-marker-label">{siteName(site)}</span>}
            <span className="sr-only">نشانگر {numberFa(index+1)}</span>
          </button>;
        })}
        {canViewFleet&&visibleFleetPoints.map(({shipmentId,shipment,point})=>{
          const position=markerPosition(point);
          const label='مأموریت '+String(shipment.vehicle??String(shipmentId).slice(0,8).toUpperCase());
          const capturedAt=String(point.captured_at??'');
          return <button type="button" key={'gps-'+shipmentId} className="farm-map-driver-marker" style={{left:position.x+'%',top:position.y+'%'}} title={label+' · '+dateTimeFa(capturedAt)} aria-label={label+' · '+dateTimeFa(capturedAt)} onClick={()=>setSelectedId('gps:'+shipmentId)}>
            <span className="farm-map-driver-marker-icon"><Truck size={15}/></span><span className="farm-map-driver-marker-label">{label}</span>
          </button>;
        })}
      </div>
      {visibleMapped.length ? <div className="farm-map-sites" aria-label="فهرست موقعیت‌های ثبت‌شده">{visibleMapped.map(site=><button type="button" key={String(site.id)} className={'farm-map-site'+(String(site.id)===selectedId?' active':'')} aria-pressed={String(site.id)===selectedId} onClick={()=>setSelectedId(String(site.id))}><span className="farm-map-pin">{farmSiteIcon(site.site_type,16)}</span><span><b>{siteName(site)}</b><small>{[site.city,site.province].filter(Boolean).map(String).join(' · ') || 'نشانی ثبت نشده'}</small><small>{farmSiteTypeLabels[String(site.site_type ?? 'mixed')] ?? 'سایر'}</small></span></button>)}</div> : <div className="farm-map-sites farm-map-sites-empty"><EmptyState title="موقعیت ثبت‌شده‌ای در محدوده ایران نیست" description="برای نمایش نشانگر مزرعه، موقعیت نقشه باید ثبت شود؛ استان و شهر به‌تنهایی برای تعیین نقطه دقیق کافی نیستند." icon={MapPin}/></div>}      <div className="farm-map-sites farm-map-fleet-list" aria-label="رانندگان و موقعیت مأموریت‌های فعال">
        <div className="farm-map-fleet-heading"><Truck size={15}/><b>مأموریت‌های در حال حرکت</b><span>{numberFa(Object.keys(fleetLatest).length)} موقعیت</span></div>
        {fleetNotice&&<p className="farm-map-fleet-notice">{fleetNotice}</p>}
        {fleetShipments.length===0?<p className="helper-note">در حال حاضر مأموریت فعالی برای نمایش نیست.</p>:fleetShipments.map(shipment=>{
          const point=fleetLatest[String(shipment.id)];
          const stamp=point?Date.parse(String(point.captured_at??'')):NaN;
          const future=Number.isFinite(stamp)&&stamp>Date.now()+60*1000;
          const stale=!Number.isFinite(stamp)||Date.now()-stamp>5*60*1000||future;
          return <div className="farm-map-fleet-row" key={'fleet-'+String(shipment.id)}>
            <span className={'farm-map-fleet-dot'+(point&&!stale?' live':'')}></span>
            <span><b>{String(shipment.vehicle??('محموله '+String(shipment.id).slice(0,8).toUpperCase()))}</b><small>{point?dateTimeFa(String(point.captured_at)):'هنوز موقعیت ثبت نشده'}</small>{point&&stale&&<small className="stale">{future?'زمان ثبت موقعیت نامعتبر است؛ نقطه زنده نمایش داده نمی‌شود':'آخرین نقطه قدیمی است؛ نقطه زنده روی نقشه نمایش داده نمی‌شود'}</small>}</span>
            <Badge value={String(shipment.stage??'in_transit')}/>
          </div>;
        })}
        <small className="farm-map-fleet-updated">آخرین بررسی: {fleetLastRefresh?dateTimeFa(fleetLastRefresh):'در حال دریافت'}</small>
      </div>
    </div>
    : <EmptyState title="هنوز نقطه‌ای برای نمایش روی نقشه ثبت نشده" description="برای راننده‌ها موقعیت فقط از GPS واقعی و با اجازه دستگاه نمایش داده می‌شود. برای سایت‌ها می‌توان استان، شهر و نشانی را بدون مختصات دقیق ثبت کرد؛ در این حالت نقطه‌ای حدس زده نمی‌شود." icon={MapPin}/>}
    <div className="farm-map-operational-note"><ShieldCheck size={14}/><span>نقاط راننده فقط از GPS واقعی ثبت‌شده با اجازهٔ دستگاه دریافت می‌شوند؛ مختصات قدیمی‌تر از ۵ دقیقه از نقشهٔ زنده پنهان می‌شوند. ردیابی خودکار فقط هنگام فعال‌بودن صفحهٔ راننده ادامه دارد.</span></div>
    <div className="farm-map-footer"><span>نقشه‌ی واقعی OpenStreetMap · موقعیت‌های ثبت‌شده</span><Link to="/app/farm-sites">مدیریت سایت‌ها <ArrowLeft size={14}/></Link></div>
  </section>;
}

type ClientPresenceRow = {
  clientId: string;
  platform: 'web' | 'android' | 'ios';
  appVersion: string;
  username: string;
  role: string;
  firstSeenAt: string;
  lastSeenAt: string;
  online: boolean;
};

type SystemHealthSnapshot = { ok?: boolean; database?: boolean; service?: string };

function Dashboard({ membership }: { membership: Membership }) {
  const [mapSites, setMapSites] = useState<Row[]>([]);
  const [mapError, setMapError] = useState('');
  const [counts, setCounts] = useState({ suppliers: 0, shipments: 0, capacity: 0, openTasks: 0, members: 0, overdueTasks: 0, reviewTasks: 0, incidents: 0, failedShipments: 0, expiringLicenses: 0 });
  const [signals, setSignals] = useState({ overdueTasks: [] as Row[], reviewTasks: [] as Row[], incidents: [] as Row[], failedShipments: [] as Row[], expiringLicenses: [] as Row[], audit: [] as Row[] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const canManage = membership.role === 'owner' || membership.role === 'admin';

  const load = async () => {
    if (!dataApi) return;
    setLoading(true);
    setError('');
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    const horizonParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() + 30 * 86400000)).map(part => [part.type, part.value]));
    const horizon = `${horizonParts.year}-${horizonParts.month}-${horizonParts.day}`;
    const now = new Date().toISOString();
    const company = membership.company_id;
    const [s, sh, cap, openTasks, members, due, review, incidents, failed, licenses, audit, map, supplierMap] = await Promise.all([
      dataApi.from('suppliers').select('id', { count: 'exact', head: true }).eq('company_id', company).eq('active', true),
      dataApi.from('shipments').select('id', { count: 'exact', head: true }).eq('company_id', company).not('stage', 'in', '(delivered,returned,failed)'),
      dataApi.from('capacity_commitments').select('id', { count: 'exact', head: true }).eq('company_id', company).in('status', ['confirmed','committed']).gte('period_end', today),
      dataApi.from('operational_tasks').select('id', { count: 'exact', head: true }).eq('company_id', company).not('status', 'in', '(approved,cancelled)'),
      dataApi.from('memberships').select('id', { count: 'exact', head: true }).eq('company_id', company).eq('active', true).not('role', 'in', '(owner,admin)'),
      dataApi.from('operational_tasks').select('id,title,status,priority,due_at', { count: 'exact' }).eq('company_id', company).lt('due_at', now).not('status', 'in', '(approved,cancelled)').order('due_at', { ascending: true }).limit(4),
      dataApi.from('operational_tasks').select('id,title,status,priority,due_at,submitted_at', { count: 'exact' }).eq('company_id', company).eq('status', 'submitted').order('submitted_at', { ascending: true }).limit(4),
      dataApi.from('operational_incidents').select('id,title,severity,status,created_at', { count: 'exact' }).eq('company_id', company).not('status', 'in', '(resolved,closed,cancelled)').order('created_at', { ascending: false }).limit(4),
      dataApi.from('shipments').select('id,stage,failure_reason,order_id', { count: 'exact' }).eq('company_id', company).eq('stage', 'failed').order('updated_at', { ascending: false }).limit(3),
      dataApi.from('farm_sites').select('id,name,license_expires_on', { count: 'exact' }).eq('company_id', company).eq('active', true).not('license_expires_on', 'is', null).lte('license_expires_on', horizon).order('license_expires_on', { ascending: true }).limit(3),
      dataApi.from('audit_events').select('id,table_name,action,record_id,occurred_at', { count: 'exact' }).eq('company_id', company).order('occurred_at', { ascending: false }).limit(8),
      dataApi.from('farm_sites').select('id,name,site_type,city,province,latitude,longitude', { count: 'exact' }).eq('company_id', company).eq('active', true).not('latitude', 'is', null).not('longitude', 'is', null).order('name').limit(30),
      dataApi.from('suppliers').select('id,name,city,province,address,latitude,longitude', { count: 'exact' }).eq('company_id', company).eq('active', true).not('latitude', 'is', null).not('longitude', 'is', null).order('name').limit(200),
    ]);
    const dbError = s.error ?? sh.error ?? cap.error ?? openTasks.error ?? due.error ?? review.error ?? incidents.error ?? failed.error ?? licenses.error ?? audit.error;
    if (dbError) setError(dbError.message);
    setMapError(map.error || supplierMap.error ? 'برای نمایش سایت‌ها و تأمین‌کنندگان روی نقشه، مهاجرت‌های موقعیت را روی پایگاه داده اجرا کن.' : '');
    const rowCount = (result: { count: number | null; data: unknown[] | null }) => result.count ?? result.data?.length ?? 0;
    setMapSites([...((map.data ?? []) as Row[]), ...((supplierMap.data ?? []) as Row[]).map(site => ({ ...site, site_type: 'supplier' }))]);
    setCounts({
      suppliers: rowCount(s), shipments: rowCount(sh), capacity: rowCount(cap), openTasks: rowCount(openTasks),
      members: canManage ? rowCount(members) : 0, overdueTasks: rowCount(due), reviewTasks: canManage ? rowCount(review) : 0,
      incidents: rowCount(incidents), failedShipments: rowCount(failed), expiringLicenses: rowCount(licenses),
    });
    setSignals({
      overdueTasks: (due.data ?? []) as Row[], reviewTasks: (review.data ?? []) as Row[],
      incidents: (incidents.data ?? []) as Row[], failedShipments: (failed.data ?? []) as Row[],
      expiringLicenses: (licenses.data ?? []) as Row[], audit: (audit.data ?? []) as Row[],
    });
    setLastUpdated(new Date().toISOString());
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [membership.company_id, membership.role]);
  const alerts: { id: string; title: string; detail: string; to: string; tone: 'critical' | 'warning' | 'info'; rank: number }[] = [];
  signals.incidents.forEach(row => alerts.push({ id: 'incident-' + String(row.id), title: 'رخداد نیازمند بررسی: ' + String(row.title ?? 'بدون عنوان'), detail: 'شدت: ' + String(row.severity ?? 'ثبت‌نشده') + ' · وضعیت: ' + (statusLabel[String(row.status)] ?? String(row.status ?? 'ثبت‌نشده')), to: '/app/incidents', tone: ['critical','high','urgent'].includes(String(row.severity).toLowerCase()) ? 'critical' : 'warning', rank: 1 }));
  signals.failedShipments.forEach(row => alerts.push({ id: 'shipment-' + String(row.id), title: 'محموله با وضعیت خطا ثبت شده است', detail: String(row.failure_reason ?? 'علت خطا ثبت نشده') + ' · شناسه ' + String(row.id).slice(0, 8), to: '/app/shipments', tone: 'critical', rank: 2 }));
  if (canManage) signals.reviewTasks.forEach(row => alerts.push({ id: 'review-task-' + String(row.id), title: 'وظیفه منتظر بررسی مدیر: ' + String(row.title ?? 'بدون عنوان'), detail: 'اولویت: ' + (statusLabel[String(row.priority)] ?? String(row.priority ?? 'ثبت‌نشده')) + ' · ارسال: ' + dateTimeFa(String(row.submitted_at ?? row.due_at ?? '')), to: '/app/operational-tasks', tone: 'warning', rank: 5 }));
  signals.overdueTasks.forEach(row => alerts.push({ id: 'due-task-' + String(row.id), title: 'وظیفه از موعد گذشته: ' + String(row.title ?? 'بدون عنوان'), detail: 'سررسید: ' + dateTimeFa(String(row.due_at ?? '')) + ' · وضعیت: ' + (statusLabel[String(row.status)] ?? String(row.status ?? '')), to: '/app/operational-tasks', tone: 'warning', rank: 6 }));
  signals.expiringLicenses.forEach(row => { const expiry = String(row.license_expires_on ?? ''); const expired = expiry !== '' && expiry < todayForDisplay(); alerts.push({ id: 'license-' + String(row.id), title: (expired ? 'مجوز سایت منقضی شده: ' : 'مجوز سایت نزدیک به انقضا: ') + String(row.name ?? 'بدون نام'), detail: 'انقضا: ' + dateFa(expiry), to: '/app/farm-sites', tone: expired ? 'critical' : 'warning', rank: 7 }); });
  alerts.sort((a,b) => a.rank - b.rank);
  const visibleAlerts = alerts.slice(0,12);
  const actionCount = counts.overdueTasks + counts.reviewTasks + counts.incidents + counts.failedShipments + counts.expiringLicenses;
  const setupMilestones = evaluateSetupMilestones({
    suppliers: counts.suppliers,
    capacity: counts.capacity,
    members: counts.members,
    tasks: counts.openTasks,
    shipments: counts.shipments,
  });
  const setupSummary = summarizeSetupMilestones(setupMilestones);
  const setupMilestoneIcons = { suppliers: Factory, capacity: Warehouse, members: Users, tasks: ClipboardCheck, shipments: Truck };

  return <>
    <PageHeading eyebrow="مدیریت عملیات" title="مرکز فرمان شبکه" description="نمای عملیاتی بر مبنای رکوردهای واقعی؛ هشدارهای برجسته به محل پیگیری متصل هستند." action={<Button variant="soft" onClick={() => void load()} disabled={loading}><Activity size={15}/> {loading ? 'در حال تازه‌سازی…' : 'تازه‌سازی داده‌ها'}</Button>}/>
    {error && <InlineError error={error} retry={() => void load()}/>}
    <div className="tower-freshness"><span className="tower-live-dot"/><span>آخرین دریافت: {lastUpdated ? dateTimeFa(lastUpdated) : 'در انتظار دریافت'}</span><span>شاخص‌ها بر پایه‌ی رکوردهای ثبت‌شده به‌روز می‌شوند.</span></div>
    <section className="stats-grid tower-stats">
      <article className="stat-card"><div className="stat-card-top"><span>تأمین‌کنندگان فعال</span><span className="stat-icon"><Factory size={17}/></span></div><b>{loading ? '—' : numberFa(counts.suppliers)}</b><small>شبکه تأمین ثبت‌شده</small></article>
      <article className="stat-card"><div className="stat-card-top"><span>محموله‌های فعال</span><span className="stat-icon"><Truck size={17}/></span></div><b>{loading ? '—' : numberFa(counts.shipments)}</b><small>تحویل‌نشده و در جریان</small></article>
      <article className="stat-card"><div className="stat-card-top"><span>تعهدهای ظرفیت</span><span className="stat-icon"><Warehouse size={17}/></span></div><b>{loading ? '—' : numberFa(counts.capacity)}</b><small>تأییدشده یا متعهد و جاری</small></article>
      <article className="stat-card"><div className="stat-card-top"><span>وظایف باز</span><span className="stat-icon"><ClipboardCheck size={17}/></span></div><b>{loading ? '—' : numberFa(counts.openTasks)}</b><small>نیازمند پیگیری و تکمیل</small></article>
      <article className="stat-card"><div className="stat-card-top"><span>همکاران عملیاتی</span><span className="stat-icon"><Users size={17}/></span></div><b>{loading ? '—' : numberFa(counts.members)}</b><small>تأمین‌کنندگان، رانندگان و کارشناسان</small></article>
    </section>
    <section className="tower-quick-access" aria-label="دسترسی سریع">
      <div className="tower-quick-head"><div><span className="section-number">۰۱</span><div><h3>دسترسی سریع</h3><p>مسیرهای اصلی زنجیره تأمین و مدیریت همکاران</p></div></div></div>
      <div className="tower-quick-grid">
        <Link to="/app/suppliers"><span><Factory size={18}/></span><b>شبکه تأمین‌کنندگان</b><small>پرونده‌ها و ظرفیت</small><ArrowLeft size={14}/></Link>
        <Link to="/app/members"><span><Users size={18}/></span><b>دسترسی کاربران</b><small>حساب‌ها و نقش‌ها</small><ArrowLeft size={14}/></Link>
        <Link to="/app/connect"><span><MessageCircle size={18}/></span><b>مرکز ارتباطات</b><small>مأموریت و پیگیری</small><ArrowLeft size={14}/></Link>
        <Link to="/app/shipments"><span><Truck size={18}/></span><b>حمل‌ونقل و رانندگان</b><small>مسیر و وضعیت تحویل</small><ArrowLeft size={14}/></Link>
        <Link to="/app/capacity"><span><Warehouse size={18}/></span><b>ظرفیت تأمین</b><small>تعهدهای تأییدشده</small><ArrowLeft size={14}/></Link>
        <Link to="/app/operational-tasks"><span><ClipboardCheck size={18}/></span><b>وظایف و مأموریت‌ها</b><small>واگذاری و تکمیل کار</small><ArrowLeft size={14}/></Link>
      </div>
    </section>
    {counts.suppliers === 0 && counts.capacity === 0 && counts.shipments === 0 && <div className="tower-onboarding"><ShieldCheck size={18}/><div><b>راه‌اندازی زنجیره تأمین را شروع کن</b><p>برای شروع، یک تأمین‌کننده ثبت کن، ظرفیت قابل اتکا را مشخص کن و حساب همکاران را از پنل مالک بساز. سامانه تا آن زمان عدد ساختگی نمایش نمی‌دهد.</p></div><div className="tower-onboarding-links"><Link to="/app/suppliers">ثبت تأمین‌کننده</Link><Link to="/app/capacity">ثبت ظرفیت</Link><Link to="/app/members">ساخت حساب همکار</Link></div></div>}
    <details className="dashboard-disclosure"><summary className="dashboard-disclosure-summary"><span><Zap size={17}/> پیشرفت راه‌اندازی مجموعه</span><small>{loading ? 'در حال بررسی' : numberFa(String(setupSummary.percentage)) + '٪ تکمیل'}</small></summary><section className="panel tower-achievements" aria-labelledby="tower-achievements-title">
      <div className="panel-heading">
        <div><span className="section-number">۰۳</span><div><h3 id="tower-achievements-title">نشان‌های پیشرفت مجموعه</h3><p>هر نشان از روی رکورد واقعی این فضای کاری باز می‌شود؛ امتیاز نمایشی یا پاداش مالی نیست.</p></div></div>
        <span className="tower-achievement-phase">{loading ? 'در حال بررسی' : setupSummary.phase}</span>
      </div>
      <div className="tower-achievement-summary">
        <div className="tower-achievement-summary-main">
          <div className="tower-achievement-count"><b>{loading ? '—' : numberFa(String(setupSummary.achieved))}</b><span>از {numberFa(String(setupSummary.total))} نشان</span></div>
          <div className="tower-achievement-meter" role="progressbar" aria-label="پیشرفت راه‌اندازی مجموعه" aria-valuemin={0} aria-valuemax={100} aria-valuenow={loading ? 0 : setupSummary.percentage} aria-valuetext={loading ? 'در حال دریافت داده‌ها' : numberFa(String(setupSummary.percentage)) + ' درصد'}>
            <span style={{ width: (loading ? 0 : setupSummary.percentage) + '%' }} />
          </div>
          <small>{loading ? 'در حال دریافت داده‌های مجموعه…' : 'پیشرفت راه‌اندازی پایه: ' + numberFa(String(setupSummary.percentage)) + '٪'}</small>
        </div>
        <span className="tower-achievement-emblem" aria-hidden="true"><Zap size={20}/></span>
      </div>
      <div className="tower-achievement-grid">
        {setupMilestones.map(milestone => {
          const MilestoneIcon = setupMilestoneIcons[milestone.id];
          return <Link
            key={milestone.id}
            to={milestone.route}
            className={'tower-achievement-card ' + (milestone.achieved ? 'is-earned' : 'is-pending')}
            aria-label={milestone.title + (loading ? '، در حال بررسی' : milestone.achieved ? '، نشان باز شده' : '، گام پیشنهادی بعدی')}
          >
            <span className="tower-achievement-icon"><MilestoneIcon size={18}/></span>
            <span className="tower-achievement-copy"><b>{milestone.title}</b><small>{milestone.description}</small><em>{loading ? 'در حال بررسی' : milestone.achieved ? 'نشان باز شد' : 'گام بعدی'}</em></span>
            <span className="tower-achievement-state">{loading ? <span className="spinner small"/> : milestone.achieved ? <CheckCircle2 size={16}/> : <span className="tower-achievement-lock" aria-hidden="true"><LockKeyhole size={15}/></span>}</span>
          </Link>;
        })}
      </div>
    </section></details>
    <div className="dashboard-grid tower-map-grid"><FarmMapPanel sites={mapSites} schemaWarning={mapError} membership={membership}/></div>
    <div className="dashboard-grid tower-main-grid">
      <section className="panel tower-recent-activity"><div className="panel-heading"><div><span className="section-number">۰۲</span><div><h3>فعالیت‌های اخیر مجموعه</h3><p>ثبت‌ها و تغییرهای واقعی کاربران، به ترتیب زمان</p></div></div><Link className="tower-panel-link" to="/app/members">کاربران <ArrowLeft size={14}/></Link></div>
        {loading ? <div className="panel-loading"><span className="spinner small"/></div> : signals.audit.length ? <div className="tower-recent-activity-list">{signals.audit.map(row => {
          const tableKey = String(row.table_name ?? '');
          const tableLabels: Record<string,string> = { suppliers:'تأمین‌کنندگان', memberships:'دسترسی کاربران', shipments:'حمل‌ونقل', operational_tasks:'وظایف عملیاتی', capacity_commitments:'ظرفیت تأمین', farm_sites:'موقعیت‌های کاری', operational_incidents:'رخدادها', medar_conversations:'مرکز ارتباطات', medar_messages:'پیام‌ها' };
          const routeMap: Record<string,string> = { suppliers:'/app/suppliers', memberships:'/app/members', shipments:'/app/shipments', operational_tasks:'/app/operational-tasks', capacity_commitments:'/app/capacity', farm_sites:'/app/farm-sites', operational_incidents:'/app/incidents', medar_conversations:'/app/connect', medar_messages:'/app/connect' };
          const action = String(row.action ?? '').toLowerCase();
          const actionLabel = action === 'insert' || action === 'create' ? 'ثبت' : action === 'delete' ? 'حذف' : action === 'update' ? 'ویرایش' : 'به‌روزرسانی';
          return <Link to={routeMap[tableKey] ?? '/app/command'} className="tower-recent-activity-row" key={String(row.id)}><span className="tower-recent-activity-icon"><Activity size={15}/></span><span><b>{actionLabel} · {tableLabels[tableKey] ?? tableKey}</b><small>{dateTimeFa(String(row.occurred_at ?? ''))}</small></span><ArrowLeft size={14}/></Link>;
        })}</div> : <EmptyState title="فعالیتی برای نمایش ثبت نشده" description="با ایجاد حساب همکاران، ثبت ظرفیت و واگذاری مأموریت، سوابق واقعی در این بخش نمایش داده می‌شوند." icon={Activity}/>}
      </section>
      <section className="panel action-panel"><div className="panel-heading"><div><span className="section-number orange">۰۲</span><div><h3>استثناهای نیازمند اقدام</h3><p>با لینک مستقیم به محل پیگیری</p></div></div><Badge value={numberFa(actionCount) + ' وضعیت'}/></div>
        {loading ? <div className="panel-loading"><span className="spinner small"/></div> : visibleAlerts.length ? <div className="tower-alert-list">{visibleAlerts.map(alert => <Link className={'tower-alert-row ' + alert.tone} to={alert.to} key={alert.id}><span className="tower-alert-mark"><AlertTriangle size={16}/></span><span className="tower-alert-copy"><b>{alert.title}</b><small>{alert.detail}</small></span><span className="tower-alert-go">پیگیری <ArrowLeft size={14}/></span></Link>)}</div> : <EmptyState title="استثنای فعالی برای نمایش پیدا نشد" description="بر اساس داده‌های موجود، وضعیت بازِ قابل نمایش در دسته‌های پیگیری پیدا نشد." icon={CheckCircle2}/>}
        {actionCount > visibleAlerts.length && <div className="tower-alert-foot">حداکثر ۱۲ ردیف برجسته نمایش داده می‌شود. ممکن است یک رکورد هم‌زمان چند وضعیت پیگیری داشته باشد.</div>}
      </section>
    </div>
    <details className="dashboard-disclosure"><summary className="dashboard-disclosure-summary"><span><ShieldCheck size={17}/> تاریخچه‌ی رویدادهای ثبت‌شده</span><small>{loading ? 'در حال دریافت' : numberFa(signals.audit.length) + ' رویداد اخیر'}</small></summary><section className="panel tower-audit-panel"><div className="panel-heading"><div><span className="section-number">۰۳</span><div><h3>آخرین رویدادهای ممیزی</h3><p>عملیات ثبت‌شده در audit log موجود</p></div></div><Button variant="soft" onClick={() => void load()}><Activity size={15}/> تازه‌سازی</Button></div>
      {loading ? <div className="panel-loading"><span className="spinner small"/></div> : signals.audit.length ? <div className="tower-audit-list">{signals.audit.map(row => <div className="tower-audit-row" key={String(row.id)}><span className="tower-audit-mark"><Activity size={15}/></span><div><b>{({INSERT:'ایجاد',UPDATE:'ویرایش',DELETE:'حذف'} as Record<string,string>)[String(row.action).toUpperCase()] ?? String(row.action ?? 'رویداد')} · {pageSectionLabel(String(row.table_name ?? ''))}</b><small>شناسه رکورد: {String(row.record_id ?? '—').slice(0,12)}</small></div><time>{dateTimeFa(String(row.occurred_at ?? ''))}</time></div>)}</div> : <EmptyState title="رویداد ممیزی ثبت نشده" description="پس از تغییر جدول‌های تحت ممیزی، رویدادهای واقعی اینجا ظاهر می‌شوند." icon={Activity}/>}
    </section></details>
  </>;
}
function todayForDisplay() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part => [part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
type Column = {key:string;label:string;render?:(row:Row)=>React.ReactNode};
function DataTable({ columns, rows, actions }: { columns:Column[]; rows:Row[]; actions?:(row:Row)=>React.ReactNode }) { return <div className="table-scroll"><table className="data-table"><thead><tr>{columns.map(c=><th key={c.key}>{c.label}</th>)}{actions&&<th>اقدام</th>}</tr></thead><tbody>{rows.map((r,i)=><tr key={String(r.id??i)}>{columns.map(c=><td key={c.key}>{c.render?c.render(r):formatCell(r[c.key],c.key)}</td>)}{actions&&<td>{actions(r)}</td>}</tr>)}</tbody></table></div>; }
function formatCell(v:unknown,key:string) { if(v===null||v===undefined||v==='')return '—'; if(key==='active') return v ? <Badge value="فعال"/> : <Badge value="غیرفعال"/>; if(key.includes('price')||key.includes('amount')||key==='credit_limit'||key==='paid_amount')return moneyFa(String(v)); if(key.endsWith('_at')||key.endsWith('_date')||['due_date','produced_on','best_before','period_start','period_end','requested_delivery','valid_from','valid_to'].includes(key))return dateFa(String(v)); if(key==='status'||key==='stage'||key==='result'||key==='role')return <Badge value={v} type={key==='role'?'role':'status'}/>; if(typeof v==='boolean')return v?'بله':'خیر'; return String(v); }
function coordinatesFromMapReference(value: string): { latitude: number; longitude: number } | null {
  const patterns = [
    /@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center)=(-?\d{1,2}(?:\.\d+)?)(?:,|%2C|%20|\s)+(-?\d{1,3}(?:\.\d+)?)/i,
    /[?&]mlat=(-?\d{1,2}(?:\.\d+)?).*?[?&]mlon=(-?\d{1,3}(?:\.\d+)?)/i,
    /#map=\d+\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]), longitude = Number(match[2]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) return { latitude, longitude };
  }
  return null;
}

function EntityPage({membership,table,title,description,fields,columns,search}:{membership:Membership;table:string;title:string;description:string;fields:FieldDef[];columns:Column[];search:string}) {
 const [rows,setRows]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [form,setForm]=useState<Record<string,string>>({});const [editing,setEditing]=useState<Row|null>(null);
 const load=async(silent=false)=>{if(!dataApi)return;if(!silent)setLoading(true);setError('');const {data,error:err}=await dataApi.from(table).select('*').eq('company_id',membership.company_id).order('created_at',{ascending:false}).limit(300);if(err){setError(err.message);setRows([])}else{setRows((data??[]) as Row[])}setLoading(false)};
 useEffect(()=>{void load()},[table,membership.company_id]);
 const shown=rows.filter(r=>!search||Object.values(r).some(v=>String(v??'').toLocaleLowerCase().includes(search.toLocaleLowerCase())));
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!dataApi)return;setBusy(true);setError('');const record:Record<string,unknown>={company_id:membership.company_id};for(const f of fields){const v=(form[f.name]??(f.type==='select'?f.options?.[0]?.value:'' )??'').trim();if(!v&&f.required){setError(`فیلد «${f.label}» الزامی است.`);setBusy(false);return;}if(!v){continue;}if(f.type==='number'){const n=Number(v);if(!Number.isFinite(n)||n<0){setError(`${f.label} باید عدد معتبر و غیرمنفی باشد.`);setBusy(false);return;}record[f.name]=n;}else if(f.type==='checkbox')record[f.name]=v==='true';else record[f.name]=v;}
 if(table==='suppliers'){const coordinates=coordinatesFromMapReference(String(record.address??''));record.latitude=coordinates?.latitude??null;record.longitude=coordinates?.longitude??null;}
 const result=editing?await dataApi.from(table).update(record).eq('id',String(editing.id)).eq('company_id',membership.company_id):await dataApi.from(table).insert(record);
 if(result.error){setError(result.error.message)}else{setOpen(false);setEditing(null);setForm({});await load()}setBusy(false);};
 const remove=async(row:Row)=>{if(!dataApi||!window.confirm(`«${String(row.name??row.code??row.reference??row.id)}» حذف شود؟ حذف اطلاعات ممکن است روی سوابق مرتبط اثر بگذارد.`))return;const {error:err}=await dataApi.from(table).delete().eq('id',String(row.id)).eq('company_id',membership.company_id);if(err)setError(err.message);else await load();};
 const startEdit=(r:Row)=>{setEditing(r);setForm(Object.fromEntries(fields.map(f=>[f.name,String(r[f.name]??'')])));setOpen(true);};
 return <><PageHeading eyebrow={title} title={title} description={description} action={<Button onClick={()=>{setEditing(null);setForm({});setError('');setOpen(true)}}><Plus size={16}/> افزودن رکورد</Button>}/>{error&&<InlineError error={error} retry={()=>void load()}/>}<section className="panel entity-panel"><div className="entity-toolbar"><div><b>{numberFa(shown.length)} رکورد</b><small>فقط داده‌هایی که مجوز مشاهده آن‌ها را داری.</small></div><Button variant="soft" onClick={()=>void load()}><Activity size={15}/> تازه‌سازی</Button></div>{loading?<div className="panel-loading"><span className="spinner small"/></div>:shown.length?<DataTable rows={shown} columns={columns} actions={r=><div className="row-actions"><button title="ویرایش" onClick={()=>startEdit(r)}><Settings2 size={15}/></button><button title="حذف" onClick={()=>void remove(r)}><X size={15}/></button></div>}/>:<EmptyState title="رکوردی برای نمایش نیست" description="از افزودن رکورد جدید شروع کن. اطلاعات در دیتابیس ذخیره می‌شوند و در این مرورگر به‌صورت آزمایشی نگهداری نمی‌شوند."/>}</section>{open&&<Modal title={editing?'ویرایش اطلاعات':'ثبت اطلاعات جدید'} subtitle={title} onClose={()=>{setOpen(false);setEditing(null);setError('')}}><form className="record-form" onSubmit={submit}>{fields.map(f=><label key={f.name}>{f.label}{f.type==='select'?<select value={form[f.name]??f.options?.[0]?.value??''} onChange={e=>setForm({...form,[f.name]:e.target.value})} required={f.required}>{f.options?.map(o=><option value={o.value} key={o.value}>{o.label}</option>)}</select>:f.type==='textarea'?<textarea value={form[f.name]??''} onChange={e=>setForm({...form,[f.name]:e.target.value})} rows={3} required={f.required}/>:<input type={f.type??'text'} value={form[f.name]??''} min={f.type==='number'?0:undefined} onChange={e=>setForm({...form,[f.name]:e.target.value})} required={f.required} dir={f.type==='number'||f.type==='date'||f.type==='tel'?'ltr':undefined} />}</label>)}{error&&<div className="form-error full-span">{error}</div>}<div className="modal-actions"><Button variant="soft" onClick={()=>setOpen(false)}>انصراف</Button><Button type="submit" disabled={busy}>{busy?'در حال ذخیره…':editing?'ذخیره تغییرات':'ثبت رکورد'}</Button></div></form></Modal>}</>;
}
type FieldDef={name:string;label:string;type?:string;required?:boolean;options?:{value:string;label:string}[]};
function Modal({title,subtitle,children,onClose}:{title:string;subtitle?:string;children:React.ReactNode;onClose:()=>void}) { return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section className="modal-card" role="dialog" aria-modal="true"><header className="modal-heading"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button onClick={onClose}><X size={18}/></button></header>{children}</section></div>; }
function productKindLabel(kind: unknown) {
  const labels: Record<string,string> = {
    farm_product:'محصول مزرعه', crop:'محصول زراعی', livestock:'دام و فرآورده دامی',
    poultry:'طیور', aquaculture:'آبزی‌پروری', dairy:'لبنیات', eggs:'تخم‌مرغ', meat:'گوشت',
    honey:'عسل', forestry:'محصول جنگلی', greenhouse:'محصول گلخانه‌ای', orchard:'محصول باغی',
    input:'نهاده و مواد اولیه', feed:'خوراک', equipment:'تجهیزات', processed:'محصول فرآوری‌شده',
    service:'خدمات', other:'سایر',
  };
  return labels[String(kind??'')] ?? 'سایر';
}
function ProductsPage({membership,search}:{membership:Membership;search:string}) {
 return <><EntityPage membership={membership} table="products" title="کاتالوگ و مشخصات محصول" description="محصول، واحد فروش و اطلاعات بسته‌بندی. قیمت اختصاصی هر مشتری در توافق قیمت تعریف می‌شود." fields={[{name:'sku',label:'کد محصول',required:true},{name:'name',label:'نام محصول',required:true},{name:'kind',label:'نوع محصول',type:'select',required:true,options:[{value:'farm_product',label:'محصول مزرعه'},{value:'crop',label:'محصول زراعی'},{value:'livestock',label:'دام و فرآورده دامی'},{value:'poultry',label:'طیور'},{value:'aquaculture',label:'آبزی‌پروری'},{value:'dairy',label:'لبنیات'},{value:'eggs',label:'تخم‌مرغ'},{value:'meat',label:'گوشت'},{value:'honey',label:'عسل'},{value:'forestry',label:'محصول جنگلی'},{value:'greenhouse',label:'محصول گلخانه‌ای'},{value:'orchard',label:'محصول باغی'},{value:'input',label:'نهاده و مواد اولیه'},{value:'feed',label:'خوراک'},{value:'equipment',label:'تجهیزات'},{value:'processed',label:'محصول فرآوری‌شده'},{value:'service',label:'خدمات'},{value:'other',label:'سایر'}]},{name:'unit',label:'واحد فروش',required:true},{name:'pack_size',label:'اندازه بسته (اختیاری)',type:'number'},{name:'shelf_life_days',label:'ماندگاری (روز)',type:'number'},{name:'storage_note',label:'شرایط نگهداری',type:'textarea'}]} columns={[{key:'sku',label:'کد'},{key:'name',label:'محصول'},{key:'kind',label:'گروه',render:r=>productKindLabel(r.kind)},{key:'unit',label:'واحد'},{key:'pack_size',label:'اندازه بسته'},{key:'active',label:'وضعیت'},{key:'created_at',label:'تاریخ ثبت'}]} search={search}/><PriceAgreements membership={membership} search={search}/></>;
}
function PriceAgreements({membership,search}:{membership:Membership;search:string}) {
 const [rows,setRows]=useState<Row[]>([]);const [customers,setCustomers]=useState<Row[]>([]);const [products,setProducts]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [form,setForm]=useState({customer_id:'',product_id:'',unit_price:'',min_qty:'1',valid_from:new Date().toISOString().slice(0,10),valid_to:''});
 const load=async(silent=false)=>{if(!dataApi)return;if(!silent)setLoading(true);const [a,c,p]=await Promise.all([dataApi.from('price_agreements').select('*,customers(name),products(name,unit,sku)').eq('company_id',membership.company_id).order('valid_from',{ascending:false}).limit(500),dataApi.from('customers').select('id,name').eq('company_id',membership.company_id).eq('active',true).order('name'),dataApi.from('products').select('id,name,unit,sku').eq('company_id',membership.company_id).eq('active',true).order('name')]);const err=a.error??c.error??p.error;if(err)setError(err.message);setRows((a.data??[]) as Row[]);setCustomers((c.data??[]) as Row[]);setProducts((p.data??[]) as Row[]);setLoading(false);};useEffect(()=>{void load();const refresh=window.setInterval(()=>void load(true),60000);return()=>window.clearInterval(refresh)},[membership.company_id]);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!dataApi)return;setBusy(true);setError('');if(Number(form.unit_price)<=0||Number(form.min_qty)<=0){setError('قیمت و حداقل مقدار باید بزرگ‌تر از صفر باشند.');setBusy(false);return;}const {error:e2}=await dataApi.from('price_agreements').insert({company_id:membership.company_id,customer_id:form.customer_id,product_id:form.product_id,unit_price:Number(form.unit_price),min_qty:Number(form.min_qty),valid_from:form.valid_from,valid_to:form.valid_to||null,created_by:membership.user_id});if(e2)setError(e2.message);else{setOpen(false);setForm({...form,unit_price:'',min_qty:'1',valid_to:''});await load()}setBusy(false);};
 const remove=async(r:Row)=>{if(!dataApi||!window.confirm('این توافق قیمت حذف شود؟ سفارش‌های قبلی تغییر نمی‌کنند؛ ثبت سفارش جدید بدون قیمت فعال رد می‌شود.'))return;const {error:e}=await dataApi.from('price_agreements').delete().eq('id',String(r.id)).eq('company_id',membership.company_id);if(e)setError(e.message);else await load();};
 const visible=rows.filter(r=>!search||`${(r.customers as any)?.name??''} ${(r.products as any)?.name??''}`.toLowerCase().includes(search.toLowerCase()));
 return <section className="panel recent-panel"><div className="panel-heading"><div><span className="section-number orange">۰۲</span><div><h3>توافق قیمت مشتریان</h3><p>قیمت و حداقل مقدار بر اساس قرارداد واقعی حساب سازمانی</p></div></div><Button onClick={()=>{setError('');setOpen(true)}}><Plus size={15}/> توافق جدید</Button></div>{error&&<InlineError error={error} retry={()=>void load()}/>}{loading?<div className="panel-loading"><span className="spinner small"/></div>:visible.length?<DataTable rows={visible} columns={[{key:'customers',label:'مشتری',render:r=>(r.customers as any)?.name??'—'},{key:'products',label:'محصول',render:r=><div><b>{String((r.products as any)?.name??'—')}</b><small>{String((r.products as any)?.sku??'')}</small></div>},{key:'unit_price',label:'قیمت واحد',render:r=>moneyFa(String(r.unit_price))},{key:'min_qty',label:'حداقل مقدار',render:r=>numberFa(String(r.min_qty))},{key:'valid_from',label:'معتبر از'},{key:'valid_to',label:'معتبر تا',render:r=>r.valid_to?dateFa(String(r.valid_to)):'بدون پایان'},{key:'state',label:'اعتبار',render:r=><Badge value={(!r.valid_to||String(r.valid_to)>=new Date().toISOString().slice(0,10))&&String(r.valid_from)<=new Date().toISOString().slice(0,10)?'active':'inactive'}/> }]} actions={r=><Button variant="danger" onClick={()=>void remove(r)}>حذف توافق</Button>}/>:<EmptyState title="توافق قیمت ثبت نشده" description="برای فعال‌کردن کاتالوگ مشتری و ثبت سفارش با قیمت واقعی، توافق قیمت را ثبت کن." icon={CreditCard}/ >}{open&&<Modal title="توافق قیمت جدید" subtitle="قیمت به واحد تومان و حداقل مقدار به واحد ثبت‌شده محصول است." onClose={()=>setOpen(false)}><form className="record-form" onSubmit={submit}><label className="full-span">مشتری سازمانی<select required value={form.customer_id} onChange={e=>setForm({...form,customer_id:e.target.value})}><option value="">انتخاب مشتری…</option>{customers.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}</select></label><label className="full-span">محصول<select required value={form.product_id} onChange={e=>setForm({...form,product_id:e.target.value})}><option value="">انتخاب محصول…</option>{products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)} · {String(p.unit)}</option>)}</select></label><label>قیمت هر واحد (تومان)<input type="number" min="1" step="1" required value={form.unit_price} onChange={e=>setForm({...form,unit_price:e.target.value})} dir="ltr"/></label><label>حداقل مقدار<input type="number" min="1" step="1" required value={form.min_qty} onChange={e=>setForm({...form,min_qty:e.target.value})} dir="ltr"/></label><label>معتبر از<input type="date" required value={form.valid_from} onChange={e=>setForm({...form,valid_from:e.target.value})}/></label><label>معتبر تا (اختیاری)<input type="date" value={form.valid_to} onChange={e=>setForm({...form,valid_to:e.target.value})}/></label>{error&&<div className="form-error full-span">{error}</div>}<div className="modal-actions"><Button variant="soft" onClick={()=>setOpen(false)}>انصراف</Button><Button type="submit" disabled={busy||!customers.length||!products.length}>{busy?'در حال ذخیره…':'ثبت توافق قیمت'}</Button></div></form>{(!customers.length||!products.length)&&<p className="helper-note">ابتدا مشتری و محصول فعال ثبت کن.</p>}</Modal>}</section>;
}
const allowedOrderTransitions: Record<string,string[]> = { draft: ['submitted','cancelled'], submitted: ['confirmed','cancelled'], confirmed: ['allocated','cancelled'], allocated: ['in_fulfillment','cancelled'], in_fulfillment: ['dispatched','cancelled'], dispatched: ['delivered'], delivered: [], cancelled: [] };
function OrdersPage({membership,search}:{membership:Membership;search:string}) {
 const [rows,setRows]=useState<Row[]>([]);const [customers,setCustomers]=useState<Row[]>([]);const [products,setProducts]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [open,setOpen]=useState(false);const [allocTarget,setAllocTarget]=useState<Row|null>(null);const [busy,setBusy]=useState(false);const [form,setForm]=useState({customer_id:'',product_id:'',quantity:'',requested_delivery:'',delivery_address:'',notes:''});
 const load=async()=>{if(!dataApi)return;setLoading(true);setError('');const [o,c,p]=await Promise.all([dataApi.from('orders').select('id,reference,status,requested_delivery,delivery_address,notes,created_at,customers(name)').eq('company_id',membership.company_id).order('created_at',{ascending:false}).limit(300),dataApi.from('customers').select('id,name').eq('company_id',membership.company_id).eq('active',true).order('name'),dataApi.from('products').select('id,name,sku,unit,kind').eq('company_id',membership.company_id).eq('active',true).order('name')]);const err=o.error??c.error??p.error;if(err)setError(err.message);setRows((o.data??[]) as Row[]);setCustomers((c.data??[]) as Row[]);setProducts((p.data??[]) as Row[]);setLoading(false);};useEffect(()=>{void load()},[membership.company_id]);
 const create=async(e:React.FormEvent)=>{e.preventDefault();if(!dataApi)return;if(!form.customer_id||!form.product_id||Number(form.quantity)<=0){setError('مشتری، محصول و مقدار معتبر را انتخاب کن.');return;}setBusy(true);setError('');const today=new Date().toISOString().slice(0,10);const {data:agreement,error:pe}=await dataApi.from('price_agreements').select('unit_price,min_qty').eq('company_id',membership.company_id).eq('customer_id',form.customer_id).eq('product_id',form.product_id).lte('valid_from',today).or(`valid_to.is.null,valid_to.gte.${today}`).lte('min_qty',Number(form.quantity)).order('valid_from',{ascending:false}).limit(1).maybeSingle();if(pe||!agreement){setError(pe?.message??'برای این مشتری و محصول قرارداد قیمت فعال و حداقل مقدار معتبر وجود ندارد. ابتدا در «کاتالوگ و قیمت» توافق را ثبت کن.');setBusy(false);return;}const {data:order,error:oe}=await dataApi.from('orders').insert({company_id:membership.company_id,customer_id:form.customer_id,status:'draft',requested_delivery:form.requested_delivery||null,delivery_address:form.delivery_address||null,notes:form.notes||null,created_by:membership.user_id}).select('id').single();if(oe){setError(oe.message);setBusy(false);return;}const {error:ie}=await dataApi.from('order_items').insert({company_id:membership.company_id,order_id:order.id,product_id:form.product_id,quantity:Number(form.quantity),unit_price:Number(agreement.unit_price)});if(ie){await dataApi.from('orders').delete().eq('id',order.id).eq('company_id',membership.company_id);setError(ie.message);setBusy(false);return;}setOpen(false);setForm({customer_id:'',product_id:'',quantity:'',requested_delivery:'',delivery_address:'',notes:''});await load();setBusy(false);};
 const updateStatus=async(r:Row,next:string)=>{if(!dataApi)return;if(!window.confirm(`وضعیت سفارش ${String(r.reference)} به «${orderLabel[next]}» تغییر کند؟`))return;const {error:e}=await dataApi.from('orders').update({status:next}).eq('id',String(r.id)).eq('company_id',membership.company_id);if(e)setError(e.message);else await load();};
 const visible=rows.filter(r=>!search||`${r.reference} ${(r.customers as any)?.name??''} ${r.status}`.toLowerCase().includes(search.toLowerCase()));
 return <><PageHeading eyebrow="SALES / ORDERS" title="سفارش‌ها" description="از ثبت درخواست تا تأیید تأمین، آماده‌سازی، ارسال و تحویل؛ هر تغییر وضعیت مطابق قواعد عملیاتی کنترل می‌شود." action={<Button onClick={()=>{setError('');setOpen(true)}}><Plus size={16}/> سفارش جدید</Button>}/>{error&&<InlineError error={error} retry={()=>void load()}/>}<section className="panel entity-panel"><div className="entity-toolbar"><div><b>{numberFa(visible.length)} سفارش</b><small>جزئیات هر سفارش در دیتابیس نگهداری می‌شود.</small></div><Button variant="soft" onClick={()=>void load()}><Activity size={15}/> تازه‌سازی</Button></div>{loading?<div className="panel-loading"><span className="spinner small"/></div>:visible.length?<DataTable rows={visible} columns={[{key:'reference',label:'شماره سفارش'},{key:'customers',label:'مشتری',render:r=>(r.customers as any)?.name??'—'},{key:'status',label:'وضعیت',render:r=><Badge value={r.status}/>},{key:'requested_delivery',label:'موعد تحویل',render:r=>dateFa(String(r.requested_delivery??''))},{key:'created_at',label:'ثبت',render:r=>dateTimeFa(String(r.created_at??''))}]} actions={r=><div className="row-actions">{['confirmed','allocated'].includes(String(r.status))&&<Button variant="soft" onClick={()=>setAllocTarget(r)}><Warehouse size={13}/> تخصیص تأمین</Button>}<select aria-label="تغییر وضعیت سفارش" value={String(r.status)} onChange={e=>void updateStatus(r,e.target.value)}><option value={String(r.status)}>{orderLabel[String(r.status)]??String(r.status)}</option>{(allowedOrderTransitions[String(r.status)]??[]).map(s=><option key={s} value={s}>{orderLabel[s]}</option>)}</select></div>}/>:<EmptyState title="سفارشی ثبت نشده" description="از دکمه سفارش جدید یک درخواست واقعی بساز. در صورت نبود قرارداد قیمت فعال، ثبت اقلام توسط دیتابیس رد می‌شود." icon={FileText}/>}</section>{allocTarget&&<AllocationModal membership={membership} order={allocTarget} onClose={()=>setAllocTarget(null)} onDone={async()=>{await load();}}/>}{open&&<Modal title="ثبت سفارش جدید" subtitle="مرحله اول، پیش‌نویس سفارش است." onClose={()=>setOpen(false)}><form className="record-form" onSubmit={create}><label>مشتری<select required value={form.customer_id} onChange={e=>setForm({...form,customer_id:e.target.value})}><option value="">انتخاب مشتری…</option>{customers.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}</select></label><label>محصول<select required value={form.product_id} onChange={e=>setForm({...form,product_id:e.target.value})}><option value="">انتخاب محصول…</option>{products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)} · {String(p.unit)}</option>)}</select></label><label>مقدار<input type="number" min="0.001" step="0.001" required value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})} dir="ltr"/></label><label>تاریخ درخواستی تحویل<input type="date" value={form.requested_delivery} onChange={e=>setForm({...form,requested_delivery:e.target.value})}/></label><label className="full-span">نشانی تحویل<input value={form.delivery_address} onChange={e=>setForm({...form,delivery_address:e.target.value})}/></label><label className="full-span">یادداشت<textarea rows={2} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>{error&&<div className="form-error full-span">{error}</div>}<div className="modal-actions"><Button variant="soft" onClick={()=>setOpen(false)}>انصراف</Button><Button type="submit" disabled={busy||!customers.length||!products.length}>{busy?'در حال ثبت…':'ساخت پیش‌نویس سفارش'}</Button></div></form>{(!customers.length||!products.length)&&<p className="helper-note">برای ثبت سفارش ابتدا یک مشتری فعال و حداقل یک محصول بساز.</p>}</Modal>}</>;
}
function AllocationModal({membership,order,onClose,onDone}:{membership:Membership;order:Row;onClose:()=>void;onDone:()=>Promise<void>}) {
 const [items,setItems]=useState<Row[]>([]);const [capacities,setCapacities]=useState<Row[]>([]);const [choices,setChoices]=useState<Record<string,string>>({});const [loading,setLoading]=useState(true);const [busy,setBusy]=useState('');const [error,setError]=useState('');
 const load=async()=>{if(!dataApi)return;setLoading(true);setError('');const [i,c]=await Promise.all([
  dataApi.from('order_items').select('id,quantity,product_id,supplier_id,capacity_commitment_id,products(name,unit),suppliers(name),capacity_commitments(period_start,period_end,confirmed_qty,committed_qty,status)').eq('company_id',membership.company_id).eq('order_id',String(order.id)).order('created_at'),
  dataApi.from('capacity_commitments').select('id,supplier_id,product_id,period_start,period_end,declared_qty,confirmed_qty,committed_qty,status,suppliers(name),products(name,unit)').eq('company_id',membership.company_id).in('status',['confirmed','committed']).order('period_start')
 ]);const issue=i.error??c.error;if(issue)setError(issue.message);setItems((i.data??[]) as Row[]);setCapacities((c.data??[]) as Row[]);setLoading(false);};
 useEffect(()=>{void load()},[membership.company_id,String(order.id)]);
 const due=String(order.requested_delivery??new Date().toISOString().slice(0,10));
 const matches=(item:Row)=>capacities.filter(cap=>String(cap.product_id)===String(item.product_id)&&String(cap.period_start)<=due&&String(cap.period_end)>=due&&Number(cap.confirmed_qty??0)-Number(cap.committed_qty??0)>=Number(item.quantity)&&String(cap.status)==='confirmed');
 const allocate=async(item:Row)=>{if(!dataApi)return;const cap=choices[String(item.id)];if(!cap){setError('برای این ردیف یک ظرفیت تأییدشده با مقدار آزاد کافی انتخاب کن.');return;}if(!window.confirm(`تخصیص ${numberFa(String(item.quantity))} واحد از این محصول به تأمین‌کننده انتخاب‌شده ثبت شود؟ این عملیات ظرفیت را به‌صورت اتمیک متعهد می‌کند.`))return;setBusy(String(item.id));setError('');const {error:e}=await dataApi.rpc('allocate_order_item',{_company:membership.company_id,_order_item:String(item.id),_capacity:cap});if(e)setError(e.message);else{await load();await onDone()}setBusy('');};
 const pending=items.filter(i=>!i.supplier_id&&!i.capacity_commitment_id);
 return <Modal title={`تخصیص ظرفیت به سفارش ${String(order.reference??'')}`} subtitle="تخصیص فقط از ظرفیت تأییدشده و با بررسی موجودی آزاد انجام می‌شود." onClose={onClose}><div className="allocation-modal-body">{error&&<InlineError error={error} retry={()=>void load()}/>}{loading?<div className="panel-loading"><span className="spinner small"/></div>:!items.length?<EmptyState title="این سفارش قلمی ندارد" description="برای تخصیص تأمین، ابتدا حداقل یک قلم محصول به سفارش اضافه شود." icon={Package}/>:<><div className="allocation-order-meta"><span>موعد تحویل</span><b>{dateFa(due)}</b><span>وضعیت سفارش</span><Badge value={String(order.status)}/></div>{items.map(item=>{const p=item.products as any;const assigned=Boolean(item.supplier_id||item.capacity_commitment_id);const options=matches(item);const current=item.capacity_commitments as any;return <article className="allocation-item" key={String(item.id)}><div className="allocation-item-title"><div><b>{String(p?.name??'محصول')}</b><small>{numberFa(String(item.quantity))} {String(p?.unit??'واحد')}</small></div>{assigned?<Badge value="تخصیص‌یافته"/>:<Badge value={options.length?'آماده تخصیص':'ظرفیت کافی نیست'}/>}</div>{assigned?<div className="allocation-assigned"><CheckCircle2 size={15}/><span>تخصیص به {String((item.suppliers as any)?.name??'تأمین‌کننده')} · {current?.period_start?`${dateFa(String(current.period_start))} تا ${dateFa(String(current.period_end))}`:'ظرفیت متعهدشده'}</span></div>:<div className="allocation-select-row"><select value={choices[String(item.id)]??''} onChange={e=>setChoices(v=>({...v,[String(item.id)]:e.target.value}))} disabled={!options.length||busy===String(item.id)}><option value="">انتخاب ظرفیت تأییدشده…</option>{options.map(cap=><option value={String(cap.id)} key={String(cap.id)}>{String((cap.suppliers as any)?.name??'تأمین‌کننده')} · آزاد {numberFa(String(Number(cap.confirmed_qty??0)-Number(cap.committed_qty??0)))} · {dateFa(String(cap.period_start))} تا {dateFa(String(cap.period_end))}</option>)}</select><Button onClick={()=>void allocate(item)} disabled={!options.length||busy===String(item.id)}>{busy===String(item.id)?'در حال تخصیص…':'تخصیص اتمیک'}</Button></div>}</article>})}{!pending.length&&<div className="form-success allocation-done"><CheckCircle2 size={17}/> تمام اقلام این سفارش تخصیص یافته‌اند؛ وضعیت سفارش پس از آخرین تخصیص در دیتابیس به‌روزرسانی می‌شود.</div>}</> }<div className="allocation-modal-foot"><ShieldCheck size={16}/><span>دیتابیس دوباره محصول، موعد تحویل و ظرفیت آزاد را بررسی می‌کند و جلوی تخصیص هم‌زمان بیش از ظرفیت را می‌گیرد.</span></div></div></Modal>;
}


const inventoryMovementLabels: Record<string,string> = {
  purchase_in: 'رسید خرید / ورود',
  sale_out: 'خروج بابت سفارش',
  adjustment_in: 'اصلاح افزایشی',
  adjustment_out: 'اصلاح کاهشی',
  waste_out: 'ضایعات',
  return_in: 'مرجوعی / برگشت',
};


const purchaseOrderStatusLabel: Record<string,string> = {
  draft: 'پیش‌نویس',
  approved: 'تأییدشده برای خرید',
  partially_received: 'دریافت جزئی',
  received: 'دریافت کامل',
  cancelled: 'لغوشده',
};

function PurchaseOrdersPage({membership,search}:{membership:Membership;search:string}) {
  const [orders,setOrders]=useState<Row[]>([]);
  const [suppliers,setSuppliers]=useState<Row[]>([]);
  const [products,setProducts]=useState<Row[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [createOpen,setCreateOpen]=useState(false);
  const [draftSupplier,setDraftSupplier]=useState('');
  const [draftReference,setDraftReference]=useState('');
  const [expectedDelivery,setExpectedDelivery]=useState('');
  const [draftNote,setDraftNote]=useState('');
  const [draftItems,setDraftItems]=useState<{product_id:string;quantity:string;unit_cost:string}[]>([{product_id:'',quantity:'',unit_cost:''}]);
  const [receiptOrder,setReceiptOrder]=useState<Row|null>(null);
  const [receiptQuantities,setReceiptQuantities]=useState<Record<string,string>>({});
  const [receiptReference,setReceiptReference]=useState('');
  const [receiptNote,setReceiptNote]=useState('');

  const load=async()=>{
    if(!dataApi){setError('اتصال پایگاه داده پیکربندی نشده است.');setLoading(false);return;}
    setLoading(true);setError('');
    const [o,s,p]=await Promise.all([
      dataApi.from('purchase_orders').select('*,suppliers(name),purchase_order_items(id,product_id,ordered_quantity,received_quantity,unit_cost,products(name,sku,unit))').eq('company_id',membership.company_id).order('created_at',{ascending:false}).limit(250),
      dataApi.from('suppliers').select('id,name,active').eq('company_id',membership.company_id).eq('active',true).order('name').limit(300),
      dataApi.from('products').select('id,sku,name,unit,active').eq('company_id',membership.company_id).eq('active',true).order('name').limit(500),
    ]);
    const firstError=o.error??s.error??p.error;
    if(firstError){setError(firstError.message);setOrders([]);}
    else setOrders((o.data??[]) as Row[]);
    setSuppliers((s.data??[]) as Row[]);
    setProducts((p.data??[]) as Row[]);
    setLoading(false);
  };
  useEffect(()=>{void load();},[membership.company_id]);

  const resetDraft=()=>{
    setDraftSupplier('');
    setDraftReference('PO-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,6).toUpperCase());
    setExpectedDelivery('');
    setDraftNote('');
    setDraftItems([{product_id:'',quantity:'',unit_cost:''}]);
  };
  const createDraft=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!dataApi)return;
    setError('');setNotice('');
    if(!draftSupplier){setError('ابتدا تأمین‌کننده را انتخاب کن.');return;}
    if(draftItems.some(item=>!item.product_id||!item.quantity||!item.unit_cost)){
      setError('محصول، مقدار و بهای واحد برای تمام ردیف‌ها الزامی است.');return;
    }
    const ids=draftItems.map(item=>item.product_id);
    if(new Set(ids).size!==ids.length){setError('هر محصول را فقط یک بار وارد کن؛ برای همان محصول یک ردیف را اصلاح کن.');return;}
    const parsed=draftItems.map(item=>({product_id:item.product_id,quantity:Number(item.quantity),unit_cost:Number(item.unit_cost)}));
    if(parsed.some(item=>!Number.isFinite(item.quantity)||item.quantity<=0||!Number.isFinite(item.unit_cost)||item.unit_cost<0)){
      setError('مقدار باید مثبت و بهای واحد صفر یا بیشتر باشد.');return;
    }
    setBusy(true);
    try{
      const {error:rpcError}=await dataApi.rpc('create_purchase_order',{
        _company:membership.company_id,
        _supplier:draftSupplier,
        _reference:draftReference.trim(),
        _items:JSON.stringify(parsed),
        _expected_delivery:expectedDelivery||null,
        _note:draftNote.trim()||null,
      });
      if(rpcError)throw new Error(rpcError.message);
      setNotice('پیش‌نویس سفارش خرید ثبت شد. برای ارسال سفارش به تأمین‌کننده، مالک یا مدیر باید آن را تأیید کند.');
      setCreateOpen(false);
      await load();
    }catch(caught){
      setError(caught instanceof Error?caught.message:'ساخت سفارش خرید ناموفق بود.');
    }finally{setBusy(false);}
  };
  const approve=async(order:Row)=>{
    if(!dataApi||!window.confirm('سفارش خرید «'+String(order.reference)+'» برای ارسال به تأمین‌کننده تأیید شود؟'))return;
    setBusy(true);setError('');setNotice('');
    try{
      const {error:rpcError}=await dataApi.rpc('approve_purchase_order',{_company:membership.company_id,_purchase_order:String(order.id)});
      if(rpcError)throw new Error(rpcError.message);
      setNotice('سفارش خرید تأیید شد؛ می‌توانی دریافت کالا را به‌صورت جزئی یا کامل ثبت کنی.');
      await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'تأیید سفارش خرید ناموفق بود.');}
    finally{setBusy(false);}
  };
  const openReceipt=(order:Row)=>{
    const lines=(order.purchase_order_items??[]) as Row[];
    const next:Record<string,string>={};
    for(const line of lines){
      const remaining=Math.max(0,Number(line.ordered_quantity)-Number(line.received_quantity??0));
      if(remaining>0)next[String(line.id)]=String(remaining);
    }
    setReceiptQuantities(next);setReceiptReference('');setReceiptNote('');
    setReceiptOrder(order);setError('');setNotice('');
  };
  const receive=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!dataApi||!receiptOrder)return;
    const lines=(receiptOrder.purchase_order_items??[]) as Row[];
    const receiptItems=lines.map(line=>({
      purchase_order_item_id:String(line.id),
      quantity_received:Number(receiptQuantities[String(line.id)]??0),
    })).filter(line=>line.quantity_received>0);
    if(!receiptItems.length||receiptItems.some(line=>!Number.isFinite(line.quantity_received)||line.quantity_received<=0)){
      setError('حداقل یک قلم با مقدار دریافتی مثبت وارد کن.');return;
    }
    setBusy(true);setError('');setNotice('');
    try{
      const {error:rpcError}=await dataApi.rpc('receive_purchase_order',{
        _company:membership.company_id,
        _purchase_order:String(receiptOrder.id),
        _items:JSON.stringify(receiptItems),
        _reference:receiptReference.trim()||null,
        _note:receiptNote.trim()||null,
      });
      if(rpcError)throw new Error(rpcError.message);
      setNotice('رسید ثبت شد و دفتر موجودی به‌صورت اتمیک به‌روزرسانی شد.');
      setReceiptOrder(null);
      await load();
    }catch(caught){setError(caught instanceof Error?caught.message:'ثبت رسید سفارش خرید ناموفق بود.');}
    finally{setBusy(false);}
  };
  const internal=['owner','admin','staff'].includes(membership.role);
  const canApprove=['owner','admin'].includes(membership.role);
  const visible=orders.filter(order=>{
    const lines=(order.purchase_order_items??[]) as Row[];
    const supplier=(order.suppliers as Row|null)?.name??'';
    const haystack=[order.reference,supplier,order.status,...lines.flatMap(line=>[(line.products as Row|null)?.name,(line.products as Row|null)?.sku])].map(v=>String(v??'')).join(' ').toLowerCase();
    return !search||haystack.includes(search.toLowerCase());
  });
  const totalValue=(order:Row)=>((order.purchase_order_items??[]) as Row[]).reduce((sum,line)=>sum+Number(line.ordered_quantity??0)*Number(line.unit_cost??0),0);
  return <>
    <PageHeading eyebrow="PROCUREMENT / PURCHASE ORDERS" title="سفارش خرید و رسید انبار" description="چرخه‌ی مستند خرید: پیش‌نویس، تأیید مالک/مدیر، دریافت جزئی یا کامل و ثبت اتمیک در دفتر موجودی." action={internal&&<Button onClick={()=>{setError('');setNotice('');resetDraft();setCreateOpen(true);}} disabled={!suppliers.length||!products.length}><Plus size={16}/> سفارش خرید جدید</Button>}/>
    {error&&<InlineError error={error} retry={()=>void load()}/>}
    {notice&&<div className="form-success notice-wide"><CheckCircle2 size={16}/>{notice}</div>}
    <div className="rule-banner"><ShieldCheck size={18}/><p><b>کنترل سمت سرور</b><span>ساخت سفارش با قلم‌های همان شرکت اعتبارسنجی می‌شود؛ تأیید فقط برای مالک/مدیر است و رسید بیش از مقدار باقیمانده رد می‌شود. موجودی فقط با رسید واقعی تغییر می‌کند.</span></p></div>
    <section className="stats-grid tower-stats">
      <article className="stat-card"><div className="stat-card-top"><span>سفارش‌های ثبت‌شده</span><i className="stat-icon"><FileText size={18}/></i></div><b>{numberFa(String(orders.length))}</b><small>برای همین فضای کاری</small></article>
      <article className="stat-card"><div className="stat-card-top"><span>در انتظار دریافت</span><i className="stat-icon"><Package size={18}/></i></div><b>{numberFa(String(orders.filter(o=>['approved','partially_received'].includes(String(o.status))).length))}</b><small>سفارش تأییدشده یا دریافت جزئی</small></article>
      <article className="stat-card"><div className="stat-card-top"><span>ارزش سفارش‌ها</span><i className="stat-icon"><CreditCard size={18}/></i></div><b>{moneyFa(orders.reduce((sum,order)=>sum+totalValue(order),0))}</b><small>ارزش ثبت‌شده اقلام؛ نه پرداخت بانکی</small></article>
    </section>
    <div className="purchase-order-collection">
      {loading?<div className="panel-loading"><span className="spinner small"/></div>:visible.length?visible.map(order=>{
        const lines=(order.purchase_order_items??[]) as Row[];
        const remaining=lines.reduce((sum,line)=>sum+Math.max(0,Number(line.ordered_quantity)-Number(line.received_quantity??0)),0);
        return <section className="panel entity-panel purchase-order-card" key={String(order.id)}>
          <div className="panel-heading">
            <div><span className="section-number">PURCHASE</span><div><h3 dir="ltr">{String(order.reference)}</h3><p>{String((order.suppliers as Row|null)?.name??'تأمین‌کننده')} · ثبت {dateTimeFa(String(order.created_at??''))}</p></div></div>
            <span className="status-badge neutral">{purchaseOrderStatusLabel[String(order.status)]??String(order.status)}</span>
          </div>
          <div className="purchase-order-meta">
            <span>ارزش سفارش <b>{moneyFa(totalValue(order))}</b></span>
            <span>باقی‌مانده برای دریافت <b>{numberFa(String(remaining))} واحد از اقلام</b></span>
            <span>موعد تحویل <b>{order.expected_delivery?dateFa(String(order.expected_delivery)):'ثبت نشده'}</b></span>
          </div>
          {lines.length?<div className="table-scroll"><DataTable rows={lines} columns={[
            {key:'product_id',label:'محصول',render:line=><span>{String((line.products as Row|null)?.name??'محصول')}<small className="cell-subtitle">{String((line.products as Row|null)?.sku??'')}</small></span>},
            {key:'ordered_quantity',label:'سفارش',render:line=>numberFa(String(line.ordered_quantity))},
            {key:'received_quantity',label:'دریافت‌شده',render:line=>numberFa(String(line.received_quantity??0))},
            {key:'unit_cost',label:'بهای واحد',render:line=>moneyFa(Number(line.unit_cost??0))},
            {key:'line_total',label:'ارزش ردیف',render:line=>moneyFa(Number(line.ordered_quantity??0)*Number(line.unit_cost??0))},
          ]}/></div>:<EmptyState title="سفارش فاقد اقلام است" description="برای این سفارش قلمی پیدا نشد." icon={Package}/>}
          {typeof order.notes==='string'&&order.notes.length>0&&<p className="purchase-order-note">{order.notes}</p>}
          <div className="purchase-order-actions">
            {canApprove&&order.status==='draft'&&<Button disabled={busy} onClick={()=>void approve(order)}><CheckCircle2 size={15}/> تأیید سفارش</Button>}
            {internal&&['approved','partially_received'].includes(String(order.status))&&<Button disabled={busy||remaining<=0} onClick={()=>openReceipt(order)}><Package size={15}/> ثبت رسید انبار</Button>}
            {order.status==='received'&&<span className="status-badge success"><i/>همه‌ی اقلام دریافت شده‌اند</span>}
          </div>
        </section>;
      }):<section className="panel"><EmptyState title="سفارش خریدی ثبت نشده" description="با انتخاب تأمین‌کننده، کالاها و مقدار موردنیاز، پیش‌نویس بساز. پس از تأیید مدیر، رسید جزئی یا نهایی از همین صفحه ثبت می‌شود." icon={FileText}/></section>}
    </div>

    {createOpen&&<Modal title="ساخت سفارش خرید" subtitle="ساخت سفارش موجودی را تغییر نمی‌دهد؛ موجودی پس از ثبت رسید معتبر افزایش می‌یابد." onClose={()=>!busy&&setCreateOpen(false)}>
      <form className="record-form" onSubmit={createDraft}>
        <label>تأمین‌کننده<select required value={draftSupplier} onChange={e=>setDraftSupplier(e.target.value)}><option value="">انتخاب تأمین‌کننده…</option>{suppliers.map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}</select></label>
        <label>شماره سفارش<input required minLength={3} maxLength={80} value={draftReference} onChange={e=>setDraftReference(e.target.value)} dir="ltr"/></label>
        <label>موعد تحویل مورد انتظار<input type="date" value={expectedDelivery} onChange={e=>setExpectedDelivery(e.target.value)}/></label>
        <div className="full-span purchase-line-editor">
          <div className="panel-heading"><div><h3>اقلام سفارش</h3><p>حداکثر ۱۰۰ قلم؛ تکرار یک محصول در ردیف جدا پذیرفته نمی‌شود.</p></div><Button variant="soft" disabled={draftItems.length>=100} onClick={()=>setDraftItems(old=>[...old,{product_id:'',quantity:'',unit_cost:''}])}><Plus size={14}/> افزودن قلم</Button></div>
          {draftItems.map((line,index)=><div className="purchase-line-row" key={index}>
            <label>محصول<select required value={line.product_id} onChange={e=>setDraftItems(old=>old.map((item,i)=>i===index?{...item,product_id:e.target.value}:item))}><option value="">انتخاب کالا…</option>{products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.sku)} · {String(p.name)} ({String(p.unit)})</option>)}</select></label>
            <label>مقدار سفارش<input type="number" min="0.001" max="999999999" step="0.001" required value={line.quantity} onChange={e=>setDraftItems(old=>old.map((item,i)=>i===index?{...item,quantity:e.target.value}:item))} dir="ltr"/></label>
            <label>بهای واحد (تومان)<input type="number" min="0" max="999999999999" step="0.01" required value={line.unit_cost} onChange={e=>setDraftItems(old=>old.map((item,i)=>i===index?{...item,unit_cost:e.target.value}:item))} dir="ltr"/></label>
            {draftItems.length>1&&<Button variant="danger" onClick={()=>setDraftItems(old=>old.filter((_,i)=>i!==index))}>حذف ردیف</Button>}
          </div>)}
        </div>
        <label className="full-span">یادداشت / شرایط خرید<textarea rows={2} maxLength={2000} value={draftNote} onChange={e=>setDraftNote(e.target.value)} placeholder="شرایط تحویل یا توضیحی که در سند بماند…"/></label>
        <div className="modal-actions"><Button variant="soft" disabled={busy} onClick={()=>setCreateOpen(false)}>انصراف</Button><Button type="submit" disabled={busy||!suppliers.length||!products.length}>{busy?'در حال ثبت…':'ثبت پیش‌نویس'}</Button></div>
      </form>
    </Modal>}

    {receiptOrder&&<Modal title={'ثبت رسید · '+String(receiptOrder.reference)} subtitle="فقط مقدار تحویل‌شده‌ی واقعی را وارد کن؛ هر قلم با مانده سفارش کنترل می‌شود." onClose={()=>!busy&&setReceiptOrder(null)}>
      <form className="record-form" onSubmit={receive}>
        {((receiptOrder.purchase_order_items??[]) as Row[]).filter(line=>Number(line.ordered_quantity)>Number(line.received_quantity??0)).map(line=>{
          const remaining=Number(line.ordered_quantity)-Number(line.received_quantity??0);
          return <label className="full-span purchase-receipt-line" key={String(line.id)}><span>{String((line.products as Row|null)?.name??'محصول')}<small>باقی‌مانده: {numberFa(String(remaining))} {String((line.products as Row|null)?.unit??'واحد')}</small></span><input aria-label={'مقدار دریافتی '+String((line.products as Row|null)?.name??line.id)} type="number" min="0" max={remaining} step="0.001" value={receiptQuantities[String(line.id)]??'0'} onChange={e=>setReceiptQuantities(old=>({...old,[String(line.id)]:e.target.value}))} dir="ltr"/></label>;
        })}
        <label>شماره رسید / فاکتور<input maxLength={120} value={receiptReference} onChange={e=>setReceiptReference(e.target.value)} dir="ltr" placeholder={String(receiptOrder.reference)}/></label>
        <label>یادداشت رسید<textarea rows={2} maxLength={2000} value={receiptNote} onChange={e=>setReceiptNote(e.target.value)} placeholder="کسری، وضعیت بسته‌بندی یا توضیح تحویل…"/></label>
        <div className="modal-actions"><Button variant="soft" disabled={busy} onClick={()=>setReceiptOrder(null)}>انصراف</Button><Button type="submit" disabled={busy}>{busy?'در حال ثبت رسید…':'ثبت رسید و افزایش موجودی'}</Button></div>
      </form>
    </Modal>}
  </>;
}

function InventoryPage({membership,search}:{membership:Membership;search:string}) {
  const [balances,setBalances]=useState<Row[]>([]);
  const [movements,setMovements]=useState<Row[]>([]);
  const [products,setProducts]=useState<Row[]>([]);
  const [suppliers,setSuppliers]=useState<Row[]>([]);
  const [orders,setOrders]=useState<Row[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [open,setOpen]=useState(false);
  const [form,setForm]=useState({product_id:'',movement_type:'purchase_in',quantity:'',unit_cost:'',supplier_id:'',order_id:'',reference_code:'',note:''});

  const load=async()=>{
    if(!dataApi){setError('اتصال پایگاه داده پیکربندی نشده است.');setLoading(false);return;}
    setLoading(true);setError('');
    const [b,m,p,s,o]=await Promise.all([
      dataApi.from('inventory_balances').select('*').eq('company_id',membership.company_id).order('product_name').limit(500),
      dataApi.from('inventory_movements').select('*').eq('company_id',membership.company_id).order('occurred_at',{ascending:false}).limit(250),
      dataApi.from('products').select('id,sku,name,unit,active').eq('company_id',membership.company_id).eq('active',true).order('name').limit(500),
      dataApi.from('suppliers').select('id,name,active').eq('company_id',membership.company_id).eq('active',true).order('name').limit(300),
      dataApi.from('orders').select('id,reference,status').eq('company_id',membership.company_id).not('status','in','(cancelled,delivered)').order('created_at',{ascending:false}).limit(300),
    ]);
    const firstError=b.error??m.error??p.error??s.error??o.error;
    if(firstError){setError(firstError.message);setBalances([]);setMovements([]);}
    else {setBalances((b.data??[]) as Row[]);setMovements((m.data??[]) as Row[]);}
    setProducts((p.data??[]) as Row[]);
    setSuppliers((s.data??[]) as Row[]);
    setOrders((o.data??[]) as Row[]);
    setLoading(false);
  };
  useEffect(()=>{void load();},[membership.company_id]);

  const movementSubmit=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!dataApi)return;
    setBusy(true);setError('');setNotice('');
    try {
      const movementType=form.movement_type;
      const {error:rpcError}=await dataApi.rpc('record_inventory_movement',{
        _company:membership.company_id,
        _product:form.product_id,
        _movement_type:movementType,
        _quantity:Number(form.quantity),
        _unit_cost:movementType==='purchase_in'&&form.unit_cost!==''?Number(form.unit_cost):null,
        _supplier:movementType==='purchase_in'?(form.supplier_id||null):null,
        _order:movementType==='sale_out'?(form.order_id||null):null,
        _lot:null,
        _reference_code:form.reference_code.trim()||null,
        _note:form.note.trim()||null,
      });
      if(rpcError)throw new Error(rpcError.message);
      setNotice('گردش انبار در پایگاه داده ثبت شد. سوابق قبلی حذف یا بازنویسی نمی‌شوند.');
      setOpen(false);
      setForm({product_id:'',movement_type:'purchase_in',quantity:'',unit_cost:'',supplier_id:'',order_id:'',reference_code:'',note:''});
      await load();
    } catch(err) {
      setError(err instanceof Error?err.message:'ثبت گردش انبار انجام نشد.');
    } finally {setBusy(false);}
  };

  const visibleBalances=balances.filter(r=>!search||`${r.sku??''} ${r.product_name??''} ${r.unit??''}`.toLowerCase().includes(search.toLowerCase()));
  const visibleMovements=movements.filter(r=>{
    const product=products.find(p=>String(p.id)===String(r.product_id));
    const supplier=suppliers.find(s=>String(s.id)===String(r.supplier_id));
    const order=orders.find(o=>String(o.id)===String(r.order_id));
    return !search||`${product?.sku??''} ${product?.name??''} ${supplier?.name??''} ${order?.reference??''} ${r.reference_code??''} ${r.note??''} ${r.movement_type??''}`.toLowerCase().includes(search.toLowerCase());
  });
  const positiveCount=balances.filter(r=>Number(r.quantity_on_hand)>0).length;
  const totalUnitsLabel=balances.length?'محاسبه برحسب واحد هر محصول':'هنوز محصولی برای ردیابی نیست';

  return <>
    <PageHeading eyebrow="WAREHOUSE / STOCK LEDGER" title="موجودی و ثبت خرید" description="مانده از دفتر ورود و خروج محاسبه می‌شود؛ خروج بیش از موجودی از سمت دیتابیس رد می‌شود و سوابق تغییرناپذیر می‌مانند." action={<Button onClick={()=>{setError('');setNotice('');setOpen(true);}}><Plus size={16}/> ثبت گردش</Button>}/>
    {error&&<InlineError error={error} retry={()=>void load()}/>}
    {notice&&<div className="form-success notice-wide"><CheckCircle2 size={16}/>{notice}</div>}
    <section className="stats-grid tower-stats inventory-stats">
      <article className="stat-card"><div className="stat-card-top"><span>محصولات ثبت‌شده</span><i className="stat-icon"><Package size={18}/></i></div><b>{numberFa(String(balances.length))}</b><small>از کاتالوگ شرکت</small></article>
      <article className="stat-card"><div className="stat-card-top"><span>دارای موجودی مثبت</span><i className="stat-icon"><Warehouse size={18}/></i></div><b>{numberFa(String(positiveCount))}</b><small>{totalUnitsLabel}</small></article>
      <article className="stat-card"><div className="stat-card-top"><span>گردش‌های اخیر</span><i className="stat-icon"><Activity size={18}/></i></div><b>{numberFa(String(movements.length))}</b><small>حداکثر ۲۵۰ گردش ثبت‌شده اخیر</small></article>
    </section>
    <section className="panel entity-panel">
      <div className="panel-heading"><div><span className="section-number">۰۱</span><div><h3>مانده موجودی</h3><p>موجودی واقعی از جمع گردش‌های ثبت‌شده</p></div></div><Button variant="soft" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> تازه‌سازی</Button></div>
      {loading?<div className="panel-loading"><span className="spinner small"/></div>:visibleBalances.length?<DataTable rows={visibleBalances} columns={[
        {key:'sku',label:'کد کالا'},
        {key:'product_name',label:'محصول'},
        {key:'unit',label:'واحد'},
        {key:'quantity_on_hand',label:'موجودی',render:r=><strong className={Number(r.quantity_on_hand)>0?'inventory-positive':'inventory-zero'}>{numberFa(String(r.quantity_on_hand??0))}</strong>},
        {key:'latest_unit_cost',label:'آخرین بهای واحد',render:r=>r.latest_unit_cost==null?'—':moneyFa(Number(r.latest_unit_cost))},
        {key:'last_movement_at',label:'آخرین گردش',render:r=>dateTimeFa(String(r.last_movement_at??''))},
        {key:'product_active',label:'وضعیت کالا',render:r=><Badge value={r.product_active?'active':'inactive'}/>}
      ]}/>:<EmptyState title="دفتر موجودی هنوز خالی است" description="از «ثبت گردش» رسید خرید یا اصلاح موجودی مستند را ثبت کن. تا وقتی سندی ثبت نشود، موجودی مثبت فرض نمی‌شود." icon={Warehouse}/>}
    </section>
    <section className="panel recent-panel">
      <div className="panel-heading"><div><span className="section-number">۰۲</span><div><h3>دفتر گردش انبار</h3><p>سوابق ثبت‌شده، بدون حذف یا ویرایش مستقیم</p></div></div></div>
      {loading?<div className="panel-loading"><span className="spinner small"/></div>:visibleMovements.length?<DataTable rows={visibleMovements} columns={[
        {key:'occurred_at',label:'زمان',render:r=>dateTimeFa(String(r.occurred_at??r.created_at??''))},
        {key:'movement_type',label:'نوع گردش',render:r=><span className="inventory-movement-type">{inventoryMovementLabels[String(r.movement_type)]??String(r.movement_type)}</span>},
        {key:'product_id',label:'محصول',render:r=>{const product=products.find(p=>String(p.id)===String(r.product_id));return <span>{String(product?.name??'—')}<small className="table-subtext">{String(product?.sku??'')}</small></span>}},
        {key:'quantity',label:'مقدار',render:r=>numberFa(String(r.quantity??0))},
        {key:'unit_cost',label:'بهای واحد',render:r=>r.unit_cost==null?'—':moneyFa(Number(r.unit_cost))},
        {key:'supplier_id',label:'تأمین‌کننده',render:r=>String(suppliers.find(s=>String(s.id)===String(r.supplier_id))?.name??'—')},
        {key:'order_id',label:'سفارش',render:r=>String(orders.find(o=>String(o.id)===String(r.order_id))?.reference??'—')},
        {key:'reference_code',label:'شماره سند',render:r=>String(r.reference_code??'—')},
        {key:'note',label:'توضیح',render:r=>String(r.note??'—')}
      ]}/>:<EmptyState title="هنوز گردش انباری ثبت نشده" description="رسید خرید، خروج سفارش، مرجوعی، ضایعات و اصلاحات با کاربر ثبت‌کننده و زمان واقعی در دفتر نگهداری می‌شوند." icon={FileText}/>}
    </section>
    {open&&<Modal title="ثبت گردش انبار" subtitle="ثبت نهایی در دیتابیس انجام می‌شود؛ خروجی که موجودی را منفی کند پذیرفته نمی‌شود." onClose={()=>setOpen(false)}>
      <form className="record-form" onSubmit={movementSubmit}>
        <label>نوع گردش<select required value={form.movement_type} onChange={e=>setForm({...form,movement_type:e.target.value})}>
          <option value="purchase_in">رسید خرید / ورود کالا</option><option value="sale_out">خروج بابت سفارش فروش</option>
          <option value="return_in">مرجوعی / برگشت به انبار</option><option value="adjustment_in">اصلاح افزایشی</option>
          <option value="adjustment_out">اصلاح کاهشی</option><option value="waste_out">ثبت ضایعات</option>
        </select></label>
        <label>محصول<select required value={form.product_id} onChange={e=>setForm({...form,product_id:e.target.value})}><option value="">انتخاب محصول…</option>{products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.sku)} · {String(p.name)} ({String(p.unit)})</option>)}</select></label>
        <label>مقدار<input type="number" min="0.001" step="0.001" required value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/></label>
        {form.movement_type==='purchase_in'&&<>
          <label>تأمین‌کننده<select required value={form.supplier_id} onChange={e=>setForm({...form,supplier_id:e.target.value})}><option value="">انتخاب تأمین‌کننده…</option>{suppliers.map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}</select></label>
          <label>بهای تمام‌شده هر واحد (تومان)<input type="number" min="0" step="0.01" required value={form.unit_cost} onChange={e=>setForm({...form,unit_cost:e.target.value})}/></label>
        </>}
        {form.movement_type==='sale_out'&&<label>سفارش فروش<select required value={form.order_id} onChange={e=>setForm({...form,order_id:e.target.value})}><option value="">انتخاب سفارش…</option>{orders.map(o=><option key={String(o.id)} value={String(o.id)}>{String(o.reference)} · {String(o.status)}</option>)}</select></label>}
        <label>شماره سند یا مرجع<input maxLength={120} value={form.reference_code} onChange={e=>setForm({...form,reference_code:e.target.value})} placeholder="فاکتور خرید، حواله، صورت‌جلسه…"/></label>
        <label className="full-span">یادداشت / دلیل{['adjustment_in','adjustment_out','waste_out'].includes(form.movement_type)&&<span className="required-note"> · اجباری</span>}<textarea rows={3} maxLength={2000} required={['adjustment_in','adjustment_out','waste_out'].includes(form.movement_type)} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="علت سند یا توضیح کالا را وارد کن…"/></label>
        <div className="modal-actions"><Button variant="soft" onClick={()=>setOpen(false)}>انصراف</Button><Button type="submit" disabled={busy||!products.length||(form.movement_type==='purchase_in'&&!suppliers.length)||(form.movement_type==='sale_out'&&!orders.length)}>{busy?'در حال ثبت…':'ثبت گردش در دفتر'}</Button></div>
      </form>
    </Modal>}
  </>;
}

function CapacityPage({membership,search}:{membership:Membership;search:string}) {
 const [rows,setRows]=useState<Row[]>([]);const [suppliers,setSuppliers]=useState<Row[]>([]);const [products,setProducts]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [evidenceFile,setEvidenceFile]=useState<File|null>(null);const [reviewRow,setReviewRow]=useState<Row|null>(null);const [preview,setPreview]=useState<{url:string;name:string;mime:string}|null>(null);const [reviewQty,setReviewQty]=useState('');const [reviewNote,setReviewNote]=useState('');
 const [form,setForm]=useState({supplier_id:'',product_id:'',period_start:new Date().toISOString().slice(0,10),period_end:new Date().toISOString().slice(0,10),declared_qty:'',note:''});
 const load=async()=>{if(!dataApi)return;setLoading(true);const [a,b,c]=await Promise.all([dataApi.from('capacity_commitments').select('*,suppliers(name),products(name,unit)').eq('company_id',membership.company_id).order('created_at',{ascending:false}).limit(300),dataApi.from('suppliers').select('id,name').eq('company_id',membership.company_id).eq('active',true).order('name'),dataApi.from('products').select('id,name,unit').eq('company_id',membership.company_id).eq('active',true).order('name')]);const err=a.error??b.error??c.error;if(err)setError(err.message);setRows((a.data??[]) as Row[]);setSuppliers((b.data??[]) as Row[]);setProducts((c.data??[]) as Row[]);setLoading(false);};
 useEffect(()=>{void load()},[membership.company_id]);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!dataApi)return;if(!evidenceFile){setError('برای ثبت ظرفیت از طرف مجموعه نیز مدرک پشتیبان الزامی است.');return;}if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(evidenceFile.type)||evidenceFile.size>10*1024*1024){setError('فقط PDF/JPG/PNG/WEBP تا ۱۰ مگابایت مجاز است.');return;}if(new Date(form.period_end)<new Date(form.period_start)){setError('پایان بازه نمی‌تواند قبل از شروع باشد.');return;}setBusy(true);setError('');const path=membership.company_id+'/'+form.supplier_id+'/capacity-'+Date.now()+'-'+evidenceFile.name.replace(/[^\w.-]/g,'_');const uploaded=await dataApi.storage.from('capacity-evidence').upload(path,evidenceFile,{upsert:false,contentType:evidenceFile.type});if(uploaded.error){setBusy(false);setError(uploaded.error.message);return;}const {error:e2}=await dataApi.from('capacity_commitments').insert({company_id:membership.company_id,supplier_id:form.supplier_id,product_id:form.product_id,period_start:form.period_start,period_end:form.period_end,declared_qty:Number(form.declared_qty),note:form.note||null,created_by:membership.user_id,status:'declared',evidence_path:path,evidence_name:evidenceFile.name,evidence_mime_type:evidenceFile.type,evidence_uploaded_at:new Date().toISOString(),evidence_review_status:'pending_review'});setBusy(false);if(e2){await dataApi.storage.from('capacity-evidence').remove([path]);setError(e2.message);return;}setOpen(false);setEvidenceFile(null);setForm({...form,declared_qty:'',note:''});await load();};
 const openEvidence=async(r:Row)=>{if(!dataApi||!r.evidence_path){setError('برای این ظرفیت مدرک قابل بررسی ثبت نشده است.');return;}setError('');const url=dataApi.storage.from('capacity-evidence').getPublicUrl(String(r.evidence_path)).data.publicUrl;if(!url){setError('پیوند مدرک ساخته نشد.');return;}setReviewRow(r);setPreview({url,name:String(r.evidence_name??'مدرک ظرفیت'),mime:String(r.evidence_mime_type??'')});setReviewQty(String(r.declared_qty??''));setReviewNote(String(r.evidence_review_note??''));};
 const approve=async()=>{if(!dataApi||!reviewRow)return;const n=Number(reviewQty);if(!Number.isFinite(n)||n<0||n>Number(reviewRow.declared_qty)){setError('مقدار تأییدشده باید بین صفر و ظرفیت اعلامی باشد.');return;}setBusy(true);const {error:e}=await dataApi.from('capacity_commitments').update({confirmed_qty:n,status:'confirmed',evidence_review_status:'approved',evidence_reviewed_by:membership.user_id,evidence_reviewed_at:new Date().toISOString(),evidence_review_note:reviewNote.trim()||'مدرک بررسی و تأیید شد.'}).eq('id',String(reviewRow.id)).eq('company_id',membership.company_id);setBusy(false);if(e){setError(e.message);return;}setReviewRow(null);setPreview(null);await load();};
 const reject=async()=>{if(!dataApi||!reviewRow)return;const reason=reviewNote.trim()||window.prompt('دلیل رد مدرک را بنویس:')?.trim()||'';if(!reason){setError('برای رد مدرک، دلیل مشخص ثبت کن.');return;}setBusy(true);const {error:e}=await dataApi.from('capacity_commitments').update({evidence_review_status:'rejected',evidence_reviewed_by:membership.user_id,evidence_reviewed_at:new Date().toISOString(),evidence_review_note:reason}).eq('id',String(reviewRow.id)).eq('company_id',membership.company_id);setBusy(false);if(e){setError(e.message);return;}setReviewRow(null);setPreview(null);await load();};
 const visible=rows.filter(r=>!search||`${(r.suppliers as any)?.name??''} ${(r.products as any)?.name??''} ${r.status} ${r.evidence_review_status??''}`.toLowerCase().includes(search.toLowerCase()));
 return <><PageHeading eyebrow="SUPPLY / CAPACITY" title="برنامه ظرفیت شبکه" description="مدارک تأمین‌کننده را بازبینی کن؛ تنها ظرفیت دارای مدرک و تأیید مدیر در تصمیم عملیاتی معتبر است." action={<Button onClick={()=>setOpen(true)}><Plus size={16}/> ثبت ظرفیت مستند</Button>}/>{error&&<InlineError error={error} retry={()=>void load()}/>}<div className="rule-banner"><Zap size={17}/><p><b>قاعده کنترل ظرفیت</b><span>مقدار تأیید قطعی نمی‌تواند از ظرفیت اعلامی بیشتر باشد. برای تأیید، مدرک را باز کن و مقدار قابل اثبات را ثبت کن.</span></p></div><section className="panel entity-panel"><div className="entity-toolbar"><div><b>{numberFa(visible.length)} بازه ظرفیت</b><small>مدرک، وضعیت بازبینی و مقادیر تأییدشده از رکوردهای واقعی خوانده می‌شوند.</small></div><Button variant="soft" onClick={()=>void load()}>تازه‌سازی</Button></div>{loading?<div className="panel-loading"><span className="spinner small"/></div>:visible.length?<DataTable rows={visible} columns={[{key:'supplier_id',label:'تأمین‌کننده',render:r=>(r.suppliers as any)?.name??'—'},{key:'product_id',label:'محصول',render:r=>(r.products as any)?.name??'—'},{key:'period_start',label:'از تاریخ',render:r=>dateFa(String(r.period_start??''))},{key:'period_end',label:'تا تاریخ',render:r=>dateFa(String(r.period_end??''))},{key:'declared_qty',label:'اعلامی',render:r=>numberFa(String(r.declared_qty))},{key:'confirmed_qty',label:'تأییدشده',render:r=>r.confirmed_qty==null?'در انتظار':numberFa(String(r.confirmed_qty))},{key:'مدرک',label:'مدرک',render:r=>r.evidence_path?<Button variant="soft" onClick={()=>void openEvidence(r)}>بازبینی مدرک</Button>:'مدرک ندارد'},{key:'evidence_review_status',label:'وضعیت مدرک',render:r=><Badge value={r.evidence_review_status??'missing'}/>},{key:'status',label:'وضعیت ظرفیت',render:r=><Badge value={r.status}/>}]} actions={r=>r.status==='declared'?(r.evidence_path&&r.evidence_review_status!=='approved'?<Button variant="soft" onClick={()=>void openEvidence(r)}>بررسی و تصمیم</Button>:<span className="muted-text">نیاز به مدرک</span>):<span className="muted-text">ثبت شده</span>}/>:<EmptyState title="ظرفیتی ثبت نشده" description="اعلام‌های مستند تأمین‌کنندگان پس از ثبت در اینجا نمایش داده می‌شوند." icon={Warehouse}/>}</section>{open&&<Modal title="ثبت ظرفیت مستند" subtitle="ثبت از طرف مدیر نیز به مدرک نیاز دارد؛ وضعیت اولیه در انتظار بررسی است." onClose={()=>{if(!busy)setOpen(false);}}><form className="record-form" onSubmit={submit}><label>تأمین‌کننده<select required value={form.supplier_id} onChange={e=>setForm({...form,supplier_id:e.target.value})}><option value="">انتخاب تأمین‌کننده…</option>{suppliers.map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}</select></label><label>محصول<select required value={form.product_id} onChange={e=>setForm({...form,product_id:e.target.value})}><option value="">انتخاب محصول…</option>{products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)} · {String(p.unit)}</option>)}</select></label><label>شروع بازه<input type="date" value={form.period_start} onChange={e=>setForm({...form,period_start:e.target.value})} required/></label><label>پایان بازه<input type="date" value={form.period_end} onChange={e=>setForm({...form,period_end:e.target.value})} required/></label><label>ظرفیت اعلامی<input type="number" min="0.001" step="0.001" value={form.declared_qty} onChange={e=>setForm({...form,declared_qty:e.target.value})} required dir="ltr"/></label><label className="full-span">عکس یا سند اثبات<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={e=>setEvidenceFile(e.target.files?.[0]??null)}/><small>حداکثر ۱۰ مگابایت</small></label><label className="full-span">توضیح<textarea rows={2} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label><div className="modal-actions"><Button variant="soft" onClick={()=>setOpen(false)} disabled={busy}>انصراف</Button><Button type="submit" disabled={busy||!suppliers.length||!products.length||!evidenceFile}>{busy?'در حال بارگذاری…':'ثبت ظرفیت مستند'}</Button></div></form></Modal>}{reviewRow&&preview&&<Modal title="راستی‌آزمایی ظرفیت" subtitle={`${String((reviewRow.suppliers as any)?.name??'تأمین‌کننده')} · ${String((reviewRow.products as any)?.name??'محصول')}`} onClose={()=>{if(!busy){setReviewRow(null);setPreview(null);}}}><div className="capacity-evidence-review"><div className="capacity-evidence-file"><b>{preview.name}</b>{preview.mime.startsWith('image/')?<img crossOrigin="use-credentials" src={preview.url} alt="مدرک ظرفیت تأمین‌کننده"/>:<a href={preview.url} target="_blank" rel="noreferrer">بازکردن سند در پنجره جدید</a>}</div><label>مقدار قابل تأیید<input type="number" min="0" max={String(reviewRow.declared_qty)} step="0.001" value={reviewQty} onChange={e=>setReviewQty(e.target.value)} dir="ltr"/></label><label>یادداشت بررسی<textarea rows={3} value={reviewNote} onChange={e=>setReviewNote(e.target.value)} placeholder="علت اختلاف، شرط تأیید یا دلیل رد"/></label><div className="modal-actions"><Button variant="danger" onClick={()=>void reject()} disabled={busy}>رد مدرک</Button><Button onClick={()=>void approve()} disabled={busy}>{busy?'در حال ذخیره…':'تأیید ظرفیت و مدرک'}</Button></div></div></Modal>}</>;
}

function QualityPage({membership,search}:{membership:Membership;search:string}) {
 const [lots,setLots]=useState<Row[]>([]);const [suppliers,setSuppliers]=useState<Row[]>([]);const [products,setProducts]=useState<Row[]>([]);const [reviews,setReviews]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [open,setOpen]=useState(false);const [review,setReview]=useState<Row|null>(null);const [busy,setBusy]=useState(false);const [form,setForm]=useState({supplier_id:'',product_id:'',code:'',produced_on:new Date().toISOString().slice(0,10),best_before:'',quantity:'',notes:''});const [reviewForm,setReviewForm]=useState({result:'pass',notes:''});
 const load=async()=>{if(!dataApi)return;setLoading(true);const [l,s,p,r]=await Promise.all([dataApi.from('lots').select('*,suppliers(name),products(name,unit)').eq('company_id',membership.company_id).order('created_at',{ascending:false}).limit(200),dataApi.from('suppliers').select('id,name').eq('company_id',membership.company_id).eq('active',true).order('name'),dataApi.from('products').select('id,name,unit').eq('company_id',membership.company_id).order('name'),dataApi.from('quality_reviews').select('*,lots(code)').eq('company_id',membership.company_id).order('reviewed_at',{ascending:false}).limit(100)]);const err=l.error??s.error??p.error??r.error;if(err)setError(err.message);setLots((l.data??[]) as Row[]);setSuppliers((s.data??[]) as Row[]);setProducts((p.data??[]) as Row[]);setReviews((r.data??[]) as Row[]);setLoading(false);};useEffect(()=>{void load()},[membership.company_id]);
 const createLot=async(e:React.FormEvent)=>{e.preventDefault();if(!dataApi)return;setBusy(true);const {error:e2}=await dataApi.from('lots').insert({company_id:membership.company_id,supplier_id:form.supplier_id,product_id:form.product_id,code:form.code.trim(),produced_on:form.produced_on,best_before:form.best_before||null,quantity:Number(form.quantity),status:'pending_review'});if(e2)setError(e2.message);else{setOpen(false);setForm({...form,code:'',quantity:'',notes:''});await load()}setBusy(false);};
 const submitReview=async(e:React.FormEvent)=>{e.preventDefault();if(!dataApi||!review)return;setBusy(true);const qualityResult=await dataApi.rpc('record_quality_review',{_company:membership.company_id,_lot:String(review.id),_result:reviewForm.result,_notes:reviewForm.notes||null,_checklist:{reviewed_in_app:true}});const e2=qualityResult.error;if(e2)setError(e2.message);else{setReview(null);setReviewForm({result:'pass',notes:''});await load()}setBusy(false);};
 const visible=lots.filter(r=>!search||`${r.code} ${(r.suppliers as any)?.name??''} ${(r.products as any)?.name??''} ${r.status}`.includes(search));
 return <><PageHeading eyebrow="QUALITY / TRACEABILITY" title="کیفیت و ردیابی محموله" description="هر سری محصول با کد، تاریخ تولید، تأمین‌کننده و تصمیم بازبینی ثبت می‌شود. مدارک تصویری به‌تنهایی تأیید سلامت نیستند." action={<Button onClick={()=>setOpen(true)}><Plus size={16}/> ثبت سری محصول</Button>}/>{error&&<InlineError error={error} retry={()=>void load()}/>}<div className="rule-banner"><ShieldCheck size={17}/><p><b>تصمیم کیفیت ثبت‌شده، نه پیشنهاد خودکار</b><span>تغییر وضعیت سری محصول نیازمند ثبت نتیجه توسط کاربر مجاز است. این سامانه جایگزین آزمایشگاه یا کنترل رسمی زنجیره سرد نیست.</span></p></div><section className="panel entity-panel"><div className="panel-heading"><div><span className="section-number">۰۱</span><div><h3>سری‌های محصول</h3><p>شناسه یکتا و وضعیت هر محموله</p></div></div><Button variant="soft" onClick={()=>void load()}>تازه‌سازی</Button></div>{loading?<div className="panel-loading"><span className="spinner small"/></div>:visible.length?<DataTable rows={visible} columns={[{key:'code',label:'کد سری'},{key:'suppliers',label:'تأمین‌کننده',render:r=>(r.suppliers as any)?.name??'—'},{key:'products',label:'محصول',render:r=>(r.products as any)?.name??'—'},{key:'produced_on',label:'تولید'},{key:'best_before',label:'بهترین زمان مصرف'},{key:'quantity',label:'مقدار',render:r=>numberFa(String(r.quantity))},{key:'status',label:'وضعیت',render:r=><Badge value={r.status}/> }]} actions={r=><Button variant="soft" onClick={()=>{setReview(r);setError('')}} disabled={['released','rejected','consumed'].includes(String(r.status))}>بازبینی</Button>}/>:<EmptyState title="سری محصولی ثبت نشده" description="برای ایجاد ردگیری، اطلاعات سری واقعی محصول و منبع آن را ثبت کن." icon={ClipboardCheck}/>}</section><section className="panel recent-panel"><div className="panel-heading"><div><span className="section-number">۰۲</span><div><h3>سوابق بازبینی کیفیت</h3><p>تصمیم‌ها و یادداشت‌های ثبت‌شده</p></div></div></div>{reviews.length?<DataTable rows={reviews.filter(r=>!search||`${(r.lots as any)?.code??''} ${r.result}`.includes(search))} columns={[{key:'lots',label:'کد سری',render:r=>(r.lots as any)?.code??'—'},{key:'result',label:'نتیجه',render:r=><Badge value={r.result}/>},{key:'notes',label:'توضیح'},{key:'reviewed_at',label:'زمان بررسی',render:r=>dateTimeFa(String(r.reviewed_at??''))}]}/>:<EmptyState title="هنوز بازبینی ثبت نشده" description="سوابق کیفیت پس از ثبت اولین بازبینی نمایش داده می‌شود." icon={ShieldCheck}/>}</section>{open&&<Modal title="ثبت سری محصول" subtitle="کد سری باید در همین شرکت یکتا باشد." onClose={()=>setOpen(false)}><form className="record-form" onSubmit={createLot}><label>تأمین‌کننده<select required value={form.supplier_id} onChange={e=>setForm({...form,supplier_id:e.target.value})}><option value="">انتخاب…</option>{suppliers.map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}</select></label><label>محصول<select required value={form.product_id} onChange={e=>setForm({...form,product_id:e.target.value})}><option value="">انتخاب…</option>{products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}</select></label><label>کد سری<input required value={form.code} onChange={e=>setForm({...form,code:e.target.value})} dir="ltr"/></label><label>مقدار<input type="number" min="0.001" step="0.001" required value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})} dir="ltr"/></label><label>تاریخ تولید<input type="date" required value={form.produced_on} onChange={e=>setForm({...form,produced_on:e.target.value})}/></label><label>بهترین زمان مصرف<input type="date" value={form.best_before} onChange={e=>setForm({...form,best_before:e.target.value})}/></label><div className="modal-actions"><Button variant="soft" onClick={()=>setOpen(false)}>انصراف</Button><Button type="submit" disabled={busy||!suppliers.length||!products.length}>{busy?'در حال ذخیره…':'ثبت سری محصول'}</Button></div></form></Modal>}{review&&<Modal title={`بازبینی سری ${String(review.code)}`} subtitle="تأیید فقط توسط کاربر مجاز و بر اساس بررسی واقعی." onClose={()=>setReview(null)}><form className="record-form" onSubmit={submitReview}><label>نتیجه بررسی<select value={reviewForm.result} onChange={e=>setReviewForm({...reviewForm,result:e.target.value})}><option value="pass">قبول</option><option value="conditional">مشروط / توقف تا تکمیل</option><option value="fail">رد</option></select></label><label className="full-span">یادداشت و مبنای تصمیم<textarea rows={4} value={reviewForm.notes} onChange={e=>setReviewForm({...reviewForm,notes:e.target.value})} required placeholder="مدرک، چک‌لیست و علت تصمیم را ثبت کن…"/></label><div className="modal-actions"><Button variant="soft" onClick={()=>setReview(null)}>انصراف</Button><Button type="submit" disabled={busy}>{busy?'در حال ثبت…':'ثبت نتیجه بازبینی'}</Button></div></form></Modal>}</>;
}
function ShipmentsPage({membership,search,driverMode=false}:{membership:Membership;search:string;driverMode?:boolean}) {
 const {user}=useAuth();const location=useLocation();const [rows,setRows]=useState<Row[]>([]);const [orders,setOrders]=useState<Row[]>([]);const [drivers,setDrivers]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [form,setForm]=useState({order_id:'',driver_user_id:'',vehicle:'',planned_departure:''});const [evidenceFor,setEvidenceFor]=useState<Row|null>(null);const [evidence,setEvidence]=useState({recipient_name:'',note:'',reading_celsius:''});const [file,setFile]=useState<File|null>(null);const [locationBusy,setLocationBusy]=useState('');const [gpsByShipment,setGpsByShipment]=useState<Record<string,Row>>({});const [locationNotice,setLocationNotice]=useState('');const [trackingShipmentId,setTrackingShipmentId]=useState('');const locationWatchRef=useRef<string|null>(null);const trackingShipmentRef=useRef('');const lastLocationWriteRef=useRef(0);const [trackingState,setTrackingState]=useState('');const autoTrackingAttemptRef=useRef('');
 const load=async()=>{if(!dataApi)return;setLoading(true);const [s,o,m]=await Promise.all([dataApi.from('shipments').select('*').eq('company_id',membership.company_id).order('created_at',{ascending:false}).limit(300),driverMode?Promise.resolve({data:[],error:null}):dataApi.from('orders').select('id,reference,customers(name)').eq('company_id',membership.company_id).not('status','in','(cancelled,delivered)').order('created_at',{ascending:false}).limit(200),driverMode?Promise.resolve({data:[],error:null}):dataApi.rpc('company_members',{_company:membership.company_id})]);const err=s.error??o.error??m.error;if(err)setError(err.message);const shipmentRows=(s.data??[]) as Row[];const allowedShipments=driverMode?shipmentRows.filter(row=>String(row.driver_user_id)===String(user?.id)):shipmentRows;setRows(allowedShipments);setOrders((o.data??[]) as Row[]);setDrivers(((m.data??[]) as Row[]).filter((r:any)=>r.role==='driver'&&r.active));if(allowedShipments.length){const gps=await dataApi.from('shipment_locations').select('id,shipment_id,latitude,longitude,accuracy_m,captured_at,driver_user_id').eq('company_id',membership.company_id).in('shipment_id',allowedShipments.map(r=>String(r.id))).order('captured_at',{ascending:false}).limit(600);if(gps.error)setError(gps.error.message);else{const latest:Record<string,Row>={};for(const point of (gps.data??[]) as Row[]){const key=String(point.shipment_id);if(!latest[key])latest[key]=point;}setGpsByShipment(latest);}}else setGpsByShipment({});setLoading(false);};useEffect(()=>{void load()},[membership.company_id,driverMode,user?.id]);
 useEffect(()=>{if(!driverMode||!location.hash)return;const anchor=decodeURIComponent(location.hash.slice(1));const timer=window.setTimeout(()=>document.getElementById(anchor)?.scrollIntoView({behavior:'smooth',block:'start'}),80);return()=>window.clearTimeout(timer)},[driverMode,location.hash,loading]);
 const saveGpsPoint=async(shipmentId:string,latitude:number,longitude:number,accuracy:number|null)=>{
  if(!dataApi||!user)return;
  const {error:insertError}=await dataApi.from('shipment_locations').insert({company_id:membership.company_id,shipment_id:shipmentId,driver_user_id:user.id,latitude,longitude,accuracy_m:accuracy});
  if(insertError)throw new Error(insertError.message);
  lastLocationWriteRef.current=Date.now();
  setGpsByShipment(current=>({...current,[shipmentId]:{shipment_id:shipmentId,latitude,longitude,accuracy_m:accuracy,captured_at:new Date().toISOString(),driver_user_id:user.id}}));
 };
 const stopLocationTracking=async(showNotice=true)=>{
  const watchId=locationWatchRef.current;
  locationWatchRef.current=null;
  trackingShipmentRef.current='';
  setTrackingShipmentId('');
  setTrackingState('');
  if(watchId){try{await Geolocation.clearWatch({id:watchId});}catch(caught){setTrackingState(caught instanceof Error?'توقف ردیابی تأیید نشد؛ مجوز GPS دستگاه را بررسی کن.':'توقف ردیابی کامل نشد.')}}
  if(showNotice)setLocationNotice('ردیابی موقعیت متوقف شد.');
 };
 useEffect(()=>()=>{const watchId=locationWatchRef.current;locationWatchRef.current=null;trackingShipmentRef.current='';if(watchId)void Geolocation.clearWatch({id:watchId}).catch(()=>{});},[]);
 const startLocationTracking=async(r:Row)=>{
  if(!dataApi||!user)return;
  const shipmentId=String(r.id);
  if(!driverMode||String(r.driver_user_id)!==String(user.id)){setError('فقط راننده تخصیص‌یافته می‌تواند موقعیت مأموریت خودش را ارسال کند.');return;}
  if(!['loading','in_transit'].includes(String(r.stage))){setError('ردیابی پیوسته فقط هنگام بارگیری یا حرکت محموله فعال می‌شود.');return;}
  if(locationWatchRef.current)await stopLocationTracking(false);
  setLocationBusy(shipmentId);setError('');setLocationNotice('');
  try{
   const permissions=await Geolocation.checkPermissions();
   if(permissions.location!=='granted'&&permissions.coarseLocation!=='granted'){
    const requested=await Geolocation.requestPermissions({permissions:['location']});
    if(requested.location!=='granted'&&requested.coarseLocation!=='granted')throw new Error('برای ارسال موقعیت باید اجازهٔ موقعیت دستگاه را بدهی.');
   }
   // Require a fresh successful location before declaring tracking active.
   const first=await Geolocation.getCurrentPosition({enableHighAccuracy:true,timeout:15000,maximumAge:0});
   await saveGpsPoint(shipmentId,first.coords.latitude,first.coords.longitude,Number.isFinite(first.coords.accuracy)?first.coords.accuracy:null);
   trackingShipmentRef.current=shipmentId;setTrackingShipmentId(shipmentId);
   const watchId=await Geolocation.watchPosition({enableHighAccuracy:true,timeout:20000,maximumAge:5000},(point,err)=>{
    if(err){setTrackingState('اتصال GPS ناپایدار است؛ آخرین نقطهٔ موفق حفظ شده.');return;}
    if(!point||trackingShipmentRef.current!==shipmentId)return;
    const now=Date.now();
    if(now-lastLocationWriteRef.current<15000)return;
    setTrackingState('');
    void saveGpsPoint(shipmentId,point.coords.latitude,point.coords.longitude,Number.isFinite(point.coords.accuracy)?point.coords.accuracy:null)
      .catch(caught=>setTrackingState(caught instanceof Error?caught.message:'ذخیرهٔ نقطهٔ GPS ناموفق بود.'));
   });
   locationWatchRef.current=watchId;
   setLocationNotice('ردیابی در پیش‌زمینه فعال است. نقطهٔ موقعیت تقریباً هر ۱۵ ثانیه، تا وقتی این صفحه و مأموریت فعال‌اند، ارسال می‌شود. برای توقف از دکمهٔ «توقف GPS» استفاده کن.');
   await load();
  }catch(err){
   await stopLocationTracking(false);
   const message=err instanceof Error?err.message:'شروع ردیابی GPS ناموفق بود.';
   setError(message+' اگر خطا ادامه دارد، مجوز موقعیت دستگاه و اتصال اینترنت را بررسی کن.');
  }finally{setLocationBusy('');}
 };
 useEffect(()=>{
   if(!driverMode||!user?.id||!rows.length||trackingShipmentId||locationBusy)return;
   const active=rows.find(row=>String(row.driver_user_id)===String(user.id)&&['loading','in_transit'].includes(String(row.stage)));
   if(!active)return;
   const shipmentId=String(active.id);
   if(autoTrackingAttemptRef.current===shipmentId)return;
   let cancelled=false;
   void Geolocation.checkPermissions().then(permission=>{
    if(cancelled||(permission.location!=='granted'&&permission.coarseLocation!=='granted'))return;
    autoTrackingAttemptRef.current=shipmentId;
    void startLocationTracking(active);
   }).catch(()=>{});
   return ()=>{cancelled=true;};
  // startLocationTracking validates the active assignment and only runs after OS permission was already granted.
    },[driverMode,user?.id,rows,trackingShipmentId,locationBusy]);
 const captureLocation=async(r:Row)=>{if(!dataApi||!user)return;if(!driverMode||String(r.driver_user_id)!==String(user.id)){setError('فقط راننده تخصیص‌یافته می‌تواند برای این محموله موقعیت ثبت کند.');return;}setLocationBusy(String(r.id));setError('');setLocationNotice('');try{const point=await Geolocation.getCurrentPosition({enableHighAccuracy:true,timeout:15000,maximumAge:0});await saveGpsPoint(String(r.id),point.coords.latitude,point.coords.longitude,Number.isFinite(point.coords.accuracy)?point.coords.accuracy:null);setLocationNotice('یک نقطهٔ GPS برای این محموله ثبت شد. ردیابی پیوسته فعال نیست.');await load();}catch(err){const message=err instanceof Error?err.message:'';setError(message||'ثبت موقعیت انجام نشد. مجوز موقعیت دستگاه، GPS و اتصال اینترنت را بررسی کن.');}finally{setLocationBusy('');}};
 const update=async(r:Row,next:string)=>{if(!dataApi)return;if(!window.confirm(`مرحله محموله ${String(r.id).slice(0,8)} به «${statusLabel[next]}» تغییر کند؟`))return;const {error:e}=await dataApi.from('shipments').update({stage:next,...(next==='failed'?{failure_reason:window.prompt('علت ناموفق بودن ارسال را بنویس:')??'ثبت نشده'}:{})}).eq('id',String(r.id)).eq('company_id',membership.company_id);if(e)setError(e.message);else await load();};
 const create=async(e:React.FormEvent)=>{e.preventDefault();if(!dataApi)return;setBusy(true);const {error:e2}=await dataApi.from('shipments').insert({company_id:membership.company_id,order_id:form.order_id,driver_user_id:form.driver_user_id||null,vehicle:form.vehicle||null,planned_departure:form.planned_departure?new Date(form.planned_departure).toISOString():null,stage:'planned'});if(e2)setError(e2.message);else{setOpen(false);setForm({order_id:'',driver_user_id:'',vehicle:'',planned_departure:''});await load()}setBusy(false);};
 const saveEvidence=async(e:React.FormEvent)=>{e.preventDefault();if(!dataApi||!evidenceFor)return;setBusy(true);try{let storagePath:string|null=null;if(file){const path=`${membership.company_id}/${String(evidenceFor.id)}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const {error:uploadError}=await dataApi.storage.from('delivery-evidence').upload(path,file,{contentType:file.type,upsert:false});if(uploadError)throw uploadError;storagePath=path;}const {error:e2}=await dataApi.from('delivery_evidence').insert({company_id:membership.company_id,shipment_id:String(evidenceFor.id),kind:evidence.reading_celsius!==''?'temperature_reading':file?(file.type.startsWith('video/')?'video':'photo'):'note',storage_path:storagePath,recipient_name:evidence.recipient_name||null,note:evidence.note||null,reading_celsius:evidence.reading_celsius===''?null:Number(evidence.reading_celsius),captured_by:user?.id});if(e2)throw e2;setEvidenceFor(null);setEvidence({recipient_name:'',note:'',reading_celsius:''});setFile(null);await load();}catch(err){setError(err instanceof Error?err.message:'ثبت مدرک تحویل انجام نشد.')}finally{setBusy(false)}};
 const visible=rows.filter(r=>!search||`${r.id} ${r.vehicle??''} ${r.stage}`.toLowerCase().includes(search.toLowerCase()));
 const nextMap:Record<string,string[]>={planned:['loading'],loading:['in_transit'],in_transit:['arrived','failed'],arrived:['delivered','failed','returned']};
 return <><PageHeading eyebrow="LOGISTICS / DELIVERY" title={driverMode?'محموله‌های من':'ارسال و تحویل'} description="مراحل حمل و تحویل با مسئول مشخص و ثبت مدرک دنبال می‌شود. وضعیت یا مدرک ساختگی وجود ندارد." action={!driverMode&&<Button onClick={()=>setOpen(true)}><Plus size={16}/> برنامه‌ریزی ارسال</Button>}/>{error&&<InlineError error={error} retry={()=>void load()}/>}<div className="rule-banner"><Truck size={17}/><p><b>مدرک تحویل و موقعیت GPS</b><span>وضعیت «تحویل‌شده» تنها با تأیید مسئول مجاز تغییر می‌کند. اگر اجازه موقعیت قبلاً داده شده باشد، هنگام بازکردن پنل راننده برای مأموریت فعال ردیابی در پیش‌زمینه خودکار شروع می‌شود؛ در غیر این صورت راننده باید «شروع ردیابی GPS» را بزند و اجازه دهد. ردیابی پس‌زمینه فعال نیست.</span></p></div>{locationNotice&&<div className="form-success notice-wide"><MapPin size={16}/>{locationNotice}</div>}{trackingState&&<div className="farm-map-warning"><MapPin size={16}/><span>{trackingState}</span></div>}<section id={driverMode?'driver-shipments':'shipments-admin-list'} className="panel entity-panel"><div className="entity-toolbar"><div><b>{numberFa(visible.length)} محموله قابل مشاهده</b><small>محدودیت نمایش بر اساس عضویت و دسترسی دیتابیس اعمال می‌شود.</small></div><Button variant="soft" onClick={()=>void load()}>تازه‌سازی</Button></div>{loading?<div className="panel-loading"><span className="spinner small"/></div>:visible.length?<DataTable rows={visible} columns={[{key:'id',label:'شناسه',render:r=><code>{String(r.id).slice(0,8).toUpperCase()}</code>},{key:'order_id',label:'سفارش',render:r=>String(orders.find(o=>o.id===r.order_id)?.reference ?? String(r.order_id).slice(0,8))},{key:'vehicle',label:'وسیله/پلاک'},{key:'stage',label:'مرحله',render:r=><Badge value={r.stage}/>},{key:'planned_departure',label:'زمان برنامه‌ریزی',render:r=>dateTimeFa(String(r.planned_departure??''))},{key:'delivered_at',label:'زمان تحویل',render:r=>dateTimeFa(String(r.delivered_at??''))},{key:'location',label:'آخرین GPS',render:r=>{const point=gpsByShipment[String(r.id)];return point?<a className="shipment-location-link" href={`https://maps.google.com/?q=${String(point.latitude)},${String(point.longitude)}`} target="_blank" rel="noreferrer"><MapPin size={13}/> مشاهده نقطه<small>{dateTimeFa(String(point.captured_at))}{point.accuracy_m!=null? ` · دقت ±${numberFa(String(Math.round(Number(point.accuracy_m))))} متر`:''}</small></a>:<span className="helper-note">ثبت نشده</span>;}}]} actions={r=><div className="row-actions wrap">{driverMode&&r.driver_user_id===user?.id&&['planned','loading','in_transit','arrived'].includes(String(r.stage))&&<>{['loading','in_transit'].includes(String(r.stage))&&<Button variant={trackingShipmentId===String(r.id)?'danger':'soft'} disabled={Boolean(locationBusy)&&locationBusy!==String(r.id)} onClick={()=>trackingShipmentId===String(r.id)?void stopLocationTracking():void startLocationTracking(r)}>{locationBusy===String(r.id)?'در حال اتصال GPS…':trackingShipmentId===String(r.id)?'توقف GPS':'شروع ردیابی GPS'}</Button>}{trackingShipmentId!==String(r.id)&&<Button variant="soft" disabled={Boolean(locationBusy)} onClick={()=>void captureLocation(r)}><MapPin size={14}/>{locationBusy===String(r.id)?'در حال تعیین موقعیت…':'ثبت یک نقطه GPS'}</Button>}</>}{(nextMap[String(r.stage)]??[]).map(next=><Button key={next} variant={next==='failed'?'danger':'soft'} onClick={()=>void update(r,next)}>{statusLabel[next]}</Button>)}<Button variant="ghost" onClick={()=>setEvidenceFor(r)}><Plus size={14}/> مدرک</Button></div>}/>:<EmptyState title="محموله‌ای ثبت نشده" description="برای برنامه‌ریزی ارسال، یک سفارش واقعی باید وجود داشته باشد." icon={Truck}/>}</section>{driverMode&&<section id="driver-map" className="panel entity-panel driver-mobile-panel"><div className="panel-heading"><div><span className="section-number">۰۱</span><div><h3>نقشه‌ی راهنما</h3><p>نقاط واقعی فقط از آخرین GPS محموله‌های واگذارشده</p></div></div><MapPin size={17}/></div><div className="driver-map-frame"><iframe title="نقشه راهنمای راننده" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=43.2%2C24.5%2C64.8%2C40.8&layer=mapnik"/></div><div className="driver-map-points">{rows.filter(r=>gpsByShipment[String(r.id)]).map(r=>{const point=gpsByShipment[String(r.id)];return <a key={String(r.id)} href={'https://maps.google.com/?q='+String(point.latitude)+','+String(point.longitude)} target="_blank" rel="noreferrer"><MapPin size={14}/><span><b>محموله {String(r.id).slice(0,8).toUpperCase()}</b><small>{dateTimeFa(String(point.captured_at))}</small></span><ArrowUpLeft size={14}/></a>})}{!rows.some(r=>gpsByShipment[String(r.id)])&&<p className="helper-note">هنوز GPS مجازی برای این محموله‌ها ثبت نشده است. موقعیت فقط با اقدام صریح راننده ذخیره می‌شود.</p>}</div></section>}{driverMode&&<section id="driver-proof" className="panel entity-panel driver-mobile-panel"><div className="panel-heading"><div><span className="section-number">۰۲</span><div><h3>ثبت مدرک تحویل</h3><p>مدرک را از روی مأموریت تخصیص‌یافته ثبت کن</p></div></div><FileText size={17}/></div>{rows.length?rows.map(r=><div className="driver-proof-row" key={String(r.id)}><span><b>محموله {String(r.id).slice(0,8).toUpperCase()}</b><small>{statusLabel[String(r.stage)]??String(r.stage)}</small></span><Button variant="soft" onClick={()=>setEvidenceFor(r)}><Plus size={14}/> ثبت مدرک</Button></div>):<EmptyState title="محموله‌ای در دسترس نیست" description="وقتی محموله‌ای به حساب شما تخصیص داده شود، امکان ثبت مدرک آن اینجا نمایش داده می‌شود." icon={FileText}/>}</section>}{open&&<Modal title="برنامه‌ریزی محموله" subtitle="این اقدام فقط پس از ثبت سفارش معتبر انجام می‌شود." onClose={()=>setOpen(false)}><form className="record-form" onSubmit={create}><label className="full-span">سفارش<select value={form.order_id} required onChange={e=>setForm({...form,order_id:e.target.value})}><option value="">انتخاب سفارش…</option>{orders.map(o=><option key={String(o.id)} value={String(o.id)}>{String(o.reference)} · {(o.customers as any)?.name??''}</option>)}</select></label><label className="full-span">راننده (اختیاری)<select value={form.driver_user_id} onChange={e=>setForm({...form,driver_user_id:e.target.value})}><option value="">بدون تخصیص راننده</option>{drivers.map(d=><option key={String(d.user_id)} value={String(d.user_id)}>{String(d.full_name??d.email)}</option>)}</select></label><label>خودرو/پلاک<input value={form.vehicle} onChange={e=>setForm({...form,vehicle:e.target.value})}/></label><label>زمان برنامه‌ریزی<input type="datetime-local" value={form.planned_departure} onChange={e=>setForm({...form,planned_departure:e.target.value})}/></label><div className="modal-actions"><Button variant="soft" onClick={()=>setOpen(false)}>انصراف</Button><Button type="submit" disabled={busy||!orders.length}>{busy?'در حال ثبت…':'ثبت محموله'}</Button></div></form>{!orders.length&&<p className="helper-note">سفارش قابل ارسال در دسترس نیست. ابتدا سفارش واقعی ثبت کن.</p>}</Modal>}{evidenceFor&&<Modal title="ثبت مدرک محموله" subtitle={`محموله ${String(evidenceFor.id).slice(0,8)}`} onClose={()=>setEvidenceFor(null)}><form className="record-form" onSubmit={saveEvidence}><label>نام تحویل‌گیرنده<input value={evidence.recipient_name} onChange={e=>setEvidence({...evidence,recipient_name:e.target.value})}/></label><label>دمای ثبت‌شده (°C)<input type="number" step="0.1" value={evidence.reading_celsius} onChange={e=>setEvidence({...evidence,reading_celsius:e.target.value})} dir="ltr"/></label><label className="full-span">یادداشت / مغایرت<textarea rows={3} value={evidence.note} onChange={e=>setEvidence({...evidence,note:e.target.value})}/></label><label className="full-span">تصویر یا ویدیوی مدرک (اختیاری)<input type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime" onChange={e=>setFile(e.target.files?.[0]??null)}/><small className="field-help">عکس یا ویدیوی MP4، WebM یا MOV تا ۵۰ مگابایت در فضای خصوصی ثبت می‌شود.</small></label><div className="modal-actions"><Button variant="soft" onClick={()=>setEvidenceFor(null)}>انصراف</Button><Button type="submit" disabled={busy}>{busy?'در حال ثبت…':'ذخیره مدرک'}</Button></div></form></Modal>}</>;
}

const goalCategoryLabels:Record<string,string>={operations:'عملیات',production:'تولید',sales:'فروش',quality:'کیفیت',logistics:'لجستیک',finance:'مالی',people:'منابع انسانی',growth:'توسعه',other:'سایر'};
const goalStatusLabels:Record<string,string>={planned:'برنامه‌ریزی‌شده',active:'در حال اجرا',at_risk:'در معرض ریسک',achieved:'محقق‌شده',paused:'متوقف',cancelled:'لغوشده'};
const goalPriorityLabels:Record<string,string>={low:'کم',normal:'عادی',high:'بالا',critical:'بحرانی'};
const emptyGoalForm={title:'',description:'',category:'operations',unit:'',baseline_value:'0',target_value:'',current_value:'0',priority:'normal',status:'planned',period_start:'',due_date:'',owner_user_id:''};

function GoalsPage({membership,search}:{membership:Membership;search:string}) {
 const {user}=useAuth();
 const [rows,setRows]=useState<Row[]>([]);
 const [members,setMembers]=useState<Row[]>([]);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [open,setOpen]=useState(false);
 const [editing,setEditing]=useState<string|null>(null);
 const [form,setForm]=useState({...emptyGoalForm});
 const canManage=membership.role==='owner'||membership.role==='admin';

 const load=async()=>{
  if(!dataApi){setError('اتصال پایگاه داده پیکربندی نشده است.');setLoading(false);return;}
  setLoading(true);setError('');
  const [g,m]=await Promise.all([
   dataApi.from('company_goals').select('*').eq('company_id',membership.company_id).order('created_at',{ascending:false}).limit(300),
   canManage ? dataApi.rpc('company_members',{_company:membership.company_id}) : Promise.resolve({data:[],error:null}),
  ]);
  const e=g.error??m.error;
  if(e)setError(e.message);
  setRows((g.data??[]) as Row[]);
  setMembers((m.data??[]) as Row[]);
  setLoading(false);
 };
 useEffect(()=>{
  void load();
  const timer=window.setInterval(()=>void load(),60_000);
  const onFocus=()=>void load();
  window.addEventListener('focus',onFocus);
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',onFocus);};
 },[membership.company_id]);

 const openNew=()=>{setEditing(null);setForm({...emptyGoalForm});setError('');setNotice('');setOpen(true);};
 const openEdit=(r:Row)=>{setEditing(String(r.id));setForm({
  title:String(r.title??''),description:String(r.description??''),category:String(r.category??'operations'),
  unit:String(r.unit??''),baseline_value:String(r.baseline_value??0),target_value:String(r.target_value??''),
  current_value:String(r.current_value??0),priority:String(r.priority??'normal'),status:String(r.status??'planned'),
  period_start:String(r.period_start??''),due_date:String(r.due_date??''),owner_user_id:String(r.owner_user_id??''),
 });setError('');setNotice('');setOpen(true);};
 const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!dataApi||!user)return;
  const target=Number(form.target_value),baseline=Number(form.baseline_value),current=Number(form.current_value);
  if(!Number.isFinite(target)||target<=baseline){setError('مقدار هدف باید از مقدار مبنا بیشتر باشد.');return;}
  if(!Number.isFinite(current)||current<0||baseline<0){setError('مقدار فعلی و مبنا باید عدد معتبر و غیرمنفی باشند.');return;}
  if(form.period_start&&form.due_date&&form.due_date<form.period_start){setError('موعد پایان نمی‌تواند قبل از شروع باشد.');return;}
  setBusy(true);setError('');setNotice('');
  const values={
   company_id:membership.company_id,title:form.title.trim(),description:form.description.trim(),
   category:form.category,unit:form.unit.trim(),baseline_value:baseline,target_value:target,current_value:current,
   priority:form.priority,status:form.status,period_start:form.period_start||null,due_date:form.due_date||null,
   owner_user_id:form.owner_user_id||null,updated_by:user.id,
  };
  try{
   const result=editing
    ? await dataApi.from('company_goals').update(values).eq('company_id',membership.company_id).eq('id',editing)
    : await dataApi.from('company_goals').insert({...values,created_by:user.id});
   if(result.error)throw new Error(result.error.message);
   setNotice(editing?'هدف ویرایش شد و تغییرات در تاریخچه ثبت شد.':'هدف جدید ثبت شد و در تاریخچه تغییرات ثبت شد.');
   setOpen(false);setEditing(null);setForm({...emptyGoalForm});
   await load();
  }catch(err){setError(err instanceof Error?err.message:'ذخیره هدف انجام نشد.');}
  finally{setBusy(false);}
 };
 const remove=async(r:Row)=>{
  if(!dataApi||!canManage)return;
  if(!window.confirm('این هدف حذف شود؟ حذف در تاریخچه تغییرات ثبت خواهد شد.'))return;
  setError('');setNotice('');
  const result=await dataApi.from('company_goals').delete().eq('company_id',membership.company_id).eq('id',String(r.id));
  if(result.error)setError(result.error.message);else{setNotice('هدف حذف شد و ردپای تغییر ثبت شد.');await load();}
 };
 const shown=rows.filter(r=>!search||`${r.title??''} ${r.description??''} ${goalCategoryLabels[String(r.category)]??r.category??''} ${goalStatusLabels[String(r.status)]??r.status??''}`.toLowerCase().includes(search.toLowerCase()));
 const today=todayForDisplay();
 const activeCount=rows.filter(r=>['active','at_risk'].includes(String(r.status))).length;
 const overdueCount=rows.filter(r=>r.due_date&&String(r.due_date)<today&&!['achieved','cancelled','paused'].includes(String(r.status))).length;
 const achievedCount=rows.filter(r=>r.status==='achieved').length;

 return <>
  <PageHeading eyebrow="مدیریت / اهداف" title="اهداف و برنامه" description="هدف قابل‌اندازه‌گیری، مقدار مبنا، شاخص فعلی، مسئول، موعد و گام بعدی؛ با ردپای تغییرات." action={<Button onClick={openNew} disabled={!canManage}><Plus size={16}/> ثبت هدف</Button>}/>
  {error&&<InlineError error={error} retry={()=>void load()}/>}
  {notice&&<div className="form-success notice-wide"><CheckCircle2 size={16}/>{notice}</div>}
  {!canManage&&<div className="rule-banner"><ShieldCheck size={17}/><p><b>دسترسی مشاهده</b><span>ثبت، ویرایش و حذف اهداف فقط برای مالک یا مدیر مجموعه فعال است.</span></p></div>}
  <section className="stats-grid tower-stats goal-stats">
   <article className="stat-card"><div className="stat-card-top"><span>کل اهداف</span><span className="stat-icon"><Target size={17}/></span></div><b>{loading?'—':numberFa(String(rows.length))}</b><small>اهداف ثبت‌شده در این مجموعه</small></article>
   <article className="stat-card"><div className="stat-card-top"><span>در حال اجرا</span><span className="stat-icon"><Activity size={17}/></span></div><b>{loading?'—':numberFa(String(activeCount))}</b><small>فعال یا در معرض ریسک</small></article>
   <article className="stat-card"><div className="stat-card-top"><span>عقب‌مانده از موعد</span><span className="stat-icon"><AlertTriangle size={17}/></span></div><b>{loading?'—':numberFa(String(overdueCount))}</b><small>نیازمند بازبینی برنامه</small></article>
   <article className="stat-card"><div className="stat-card-top"><span>محقق‌شده</span><span className="stat-icon"><CheckCircle2 size={17}/></span></div><b>{loading?'—':numberFa(String(achievedCount))}</b><small>با وضعیت ثبت‌شده‌ی محقق‌شده</small></article>
  </section>
  <section className="panel goal-workspace-panel">
   <div className="panel-heading"><div><span className="section-number">۰۱</span><div><h3>برنامه و شاخص‌ها</h3><p>اطلاعات از پایگاه داده و به‌صورت خودکار هر ۶۰ ثانیه تازه می‌شود.</p></div></div><Button variant="soft" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> تازه‌سازی</Button></div>
   {loading?<div className="panel-loading"><span className="spinner small"/></div>:shown.length?<div className="goal-card-grid">{shown.map(r=>{
    const baseline=Number(r.baseline_value??0),target=Number(r.target_value??0),current=Number(r.current_value??0);
    const progress=goalProgressPercent(baseline,target,current);
    const overdue=isGoalOverdue(r.due_date?String(r.due_date):null,today,String(r.status));
    const owner=members.find(m=>String(m.user_id)===String(r.owner_user_id));
    return <article className={`goal-card ${overdue?'overdue':''}`} key={String(r.id)}>
     <header className="goal-card-head"><span className="goal-category">{goalCategoryLabels[String(r.category)]??'سایر'}</span><Badge value={goalStatusLabels[String(r.status)]??r.status}/></header>
     <h3>{String(r.title??'هدف بدون عنوان')}</h3>
     {String(r.description??'').trim()!==''&&<p className="goal-description">{String(r.description)}</p>}
     <div className="goal-progress-meta"><span>پیشرفت ثبت‌شده</span><b>{progress===null?'—':numberFa(String(Math.round(progress)))+'٪'}</b></div>
     <div className="goal-progress-track"><span style={{width:(progress??0)+'%'}}/></div>
     <div className="goal-value-row"><span>مقدار فعلی <b>{numberFa(String(current))}{r.unit?' '+String(r.unit):''}</b></span><span>هدف <b>{numberFa(String(target))}{r.unit?' '+String(r.unit):''}</b></span></div>
     <div className="goal-meta-row"><span><CalendarDays size={13}/> {r.due_date?dateFa(String(r.due_date)):'بدون موعد'}</span><span><Users size={13}/> {String(owner?.full_name??owner?.username??'مسئول تعیین نشده')}</span></div>
     {overdue&&<div className="goal-overdue-note"><AlertTriangle size={13}/> موعد هدف گذشته است</div>}
     {canManage&&<div className="goal-actions"><Button variant="soft" onClick={()=>openEdit(r)}>ویرایش هدف</Button><Button variant="ghost" onClick={()=>void remove(r)}>حذف</Button></div>}
    </article>;
   })}</div>:<EmptyState title="هنوز هدفی ثبت نشده" description={canManage?'هدف‌های مجموعه را با شاخص، مقدار مبنا، موعد و مسئول ثبت کن؛ پیشرفت فقط از مقدارهای ثبت‌شده محاسبه می‌شود.':'بعد از ثبت هدف توسط مالک یا مدیر، شاخص و موعد در این بخش دیده می‌شود.'} icon={Target}/>}
  </section>
  {open&&<Modal title={editing?'ویرایش هدف':'ثبت هدف جدید'} subtitle="مقادیر در دیتابیس ذخیره می‌شوند و تغییرات در تاریخچه ممیزی ثبت خواهد شد." onClose={()=>setOpen(false)}>
   <form className="record-form" onSubmit={submit}>
    <label className="full-span">عنوان هدف<input required minLength={3} maxLength={160} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="مثلاً کاهش تأخیر تحویل یا افزایش ظرفیت تأییدشده"/></label>
    <label>حوزه<select required value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{Object.entries(goalCategoryLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <label>وضعیت<select required value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>{Object.entries(goalStatusLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <label>اولویت<select required value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>{Object.entries(goalPriorityLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <label>واحد شاخص<input maxLength={40} value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} placeholder="٪، عدد، تومان، روز…"/></label>
    <label>مقدار مبنا<input type="number" min="0" step="0.001" required value={form.baseline_value} onChange={e=>setForm({...form,baseline_value:e.target.value})}/></label>
    <label>مقدار هدف<input type="number" min="0.001" step="0.001" required value={form.target_value} onChange={e=>setForm({...form,target_value:e.target.value})}/></label>
    <label>مقدار فعلی ثبت‌شده<input type="number" min="0" step="0.001" required value={form.current_value} onChange={e=>setForm({...form,current_value:e.target.value})}/></label>
    <label>شروع بازه<input type="date" value={form.period_start} onChange={e=>setForm({...form,period_start:e.target.value})}/></label>
    <label>موعد هدف<input type="date" value={form.due_date} onChange={e=>setForm({...form,due_date:e.target.value})}/></label>
    <label className="full-span">مسئول<select value={form.owner_user_id} onChange={e=>setForm({...form,owner_user_id:e.target.value})}><option value="">تعیین‌نشده</option>{members.filter(m=>m.active===true&&['owner','admin','staff'].includes(String(m.role))).map(m=><option key={String(m.user_id)} value={String(m.user_id)}>{String(m.full_name??m.email??m.user_id)} · {roleLabel[String(m.role)]??String(m.role)}</option>)}</select></label>
    <label className="full-span">توضیحات<textarea rows={3} maxLength={3000} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="محدوده، پیش‌نیاز، معیار تأیید و گام بعدی…"/></label>
    <div className="modal-actions"><Button variant="soft" onClick={()=>setOpen(false)}>انصراف</Button><Button type="submit" disabled={busy}>{busy?'در حال ذخیره…':'ذخیره هدف'}</Button></div>
   </form>
  </Modal>}
 </>;
}

function FinancePage({membership,search}:{membership:Membership;search:string}) {
 const [invoices,setInvoices]=useState<Row[]>([]);const [settlements,setSettlements]=useState<Row[]>([]);const [orders,setOrders]=useState<Row[]>([]);const [suppliers,setSuppliers]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [mode,setMode]=useState<'invoice'|'settlement'>('invoice');const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [form,setForm]=useState({order_id:'',customer_id:'',supplier_id:'',reference:'',amount:'',due_date:'',invoice_ref:'',note:''});const internal=['owner','admin','staff'].includes(membership.role);
 const load=async()=>{if(!dataApi)return;setLoading(true);const [i,s,o,v]=await Promise.all([dataApi.from('invoices').select('*,customers(name),orders(reference)').eq('company_id',membership.company_id).order('created_at',{ascending:false}).limit(300),dataApi.from('settlements').select('*,suppliers(name)').eq('company_id',membership.company_id).order('created_at',{ascending:false}).limit(300),internal?dataApi.from('orders').select('id,reference,customer_id,customers(name)').eq('company_id',membership.company_id).order('created_at',{ascending:false}).limit(300):Promise.resolve({data:[],error:null}),internal?dataApi.from('suppliers').select('id,name').eq('company_id',membership.company_id).order('name'):Promise.resolve({data:[],error:null})]);const err=i.error??s.error??o.error??v.error;if(err)setError(err.message);setInvoices((i.data??[]) as Row[]);setSettlements((s.data??[]) as Row[]);setOrders((o.data??[]) as Row[]);setSuppliers((v.data??[]) as Row[]);setLoading(false);};useEffect(()=>{void load()},[membership.company_id,internal]);
 const create=async(e:React.FormEvent)=>{e.preventDefault();if(!dataApi)return;setBusy(true);let err:Error|null=null;if(mode==='invoice'){const order=orders.find(o=>o.id===form.order_id);const customerId=form.customer_id||String(order?.customer_id??'');const {error:e2}=await dataApi.from('invoices').insert({company_id:membership.company_id,order_id:form.order_id,customer_id:customerId,reference:form.reference.trim(),amount:Number(form.amount),paid_amount:0,due_date:form.due_date||null,status:'draft'});if(e2)err=e2;}else{const {error:e2}=await dataApi.from('settlements').insert({company_id:membership.company_id,supplier_id:form.supplier_id,invoice_ref:form.invoice_ref||null,amount:Number(form.amount),due_date:form.due_date||null,status:'pending',note:form.note||null});if(e2)err=e2;}if(err)setError(err.message);else{setOpen(false);setForm({order_id:'',customer_id:'',supplier_id:'',reference:'',amount:'',due_date:'',invoice_ref:'',note:''});await load()}setBusy(false);};
 const updateInvoice=async(r:Row,status:string)=>{
 if(!dataApi||!window.confirm(`وضعیت فاکتور ${String(r.reference)} تغییر کند؟`))return;
 const changes:Record<string,unknown>={status};
 if(status==='paid'||status==='partially_paid'){
  const remaining=Math.max(0,Number(r.amount??0)-Number(r.paid_amount??0));
  let paidAmount=Number(r.amount??0);
  if(status==='partially_paid'){
   const raw=window.prompt(`مبلغ پرداخت جدید را وارد کن. مانده فعلی: ${remaining}`,String(Math.max(0,remaining/2)));
   if(raw===null)return;
   paidAmount=Number(raw);
   if(!Number.isFinite(paidAmount)||paidAmount<=Number(r.paid_amount??0)||paidAmount>=Number(r.amount??0)){setError('مبلغ پرداخت جزئی باید از پرداخت قبلی بیشتر و کمتر از کل مبلغ فاکتور باشد.');return;}
   changes.paid_amount=paidAmount;
  }
  const reference=window.prompt('مرجع پرداخت واقعی را وارد کن:');
  if(!reference||reference.trim().length<2){setError('برای ثبت پرداخت، مرجع واقعی پرداخت ضروری است.');return;}
  changes.payment_reference=reference.trim();
 }
 const {error:e}=await dataApi.from('invoices').update(changes).eq('id',String(r.id)).eq('company_id',membership.company_id);
 if(e)setError(e.message);else await load();
};
 const updateSettlement=async(r:Row,status:string)=>{
 if(!dataApi||!window.confirm('وضعیت تسویه تغییر کند؟'))return;
 const changes:Record<string,unknown>={status};
 if(status==='paid'){
  const reference=window.prompt('مرجع پرداخت واقعی را وارد کن:');
  if(!reference||reference.trim().length<2){setError('برای ثبت تسویه، مرجع واقعی پرداخت ضروری است.');return;}
  changes.payment_reference=reference.trim();
 }
 const {error:e}=await dataApi.from('settlements').update(changes).eq('id',String(r.id)).eq('company_id',membership.company_id);
 if(e)setError(e.message);else await load();
};
 const shownInv=invoices.filter(r=>!search||`${r.reference} ${(r.customers as any)?.name??''} ${r.status}`.toLowerCase().includes(search.toLowerCase()));const shownSet=settlements.filter(r=>!search||`${r.invoice_ref??''} ${(r.suppliers as any)?.name??''} ${r.status}`.toLowerCase().includes(search.toLowerCase()));
 return <><PageHeading eyebrow="FINANCE / RECONCILIATION" title="مالی و تسویه" description="فاکتور و تسویه، رکورد تجاری مستقل‌اند. هیچ پرداختی صرفاً با تغییر وضعیت در این صفحه به‌عنوان انتقال بانکی تأیید نمی‌شود." action={internal&&<Button onClick={()=>{setMode('invoice');setForm({order_id:'',customer_id:'',supplier_id:'',reference:'',amount:'',due_date:'',invoice_ref:'',note:''});setOpen(true)}}><Plus size={16}/> صدور فاکتور</Button>}/>{error&&<InlineError error={error} retry={()=>void load()}/>}<div className="finance-notice"><CreditCard size={17}/><span><b>وضعیت مالی، مدرک بانکی نیست.</b> ورود صورت‌حساب و تطبیق دستی در بخش زیر انجام می‌شود؛ اتصال مستقیم بانک یا انتقال وجه فعال نیست.</span></div><BankReconciliationPanel membership={membership}/><section className="panel entity-panel"><div className="panel-heading"><div><span className="section-number">۰۱</span><div><h3>فاکتورهای فروش</h3><p>فاکتورهای مجاز برای حساب فعال</p></div></div><Button variant="soft" onClick={()=>void load()}>تازه‌سازی</Button></div>{loading?<div className="panel-loading"><span className="spinner small"/></div>:shownInv.length?<DataTable rows={shownInv} columns={[{key:'reference',label:'شماره فاکتور'},{key:'customers',label:'مشتری',render:r=>(r.customers as any)?.name??'—'},{key:'orders',label:'سفارش',render:r=>(r.orders as any)?.reference??'—'},{key:'amount',label:'مبلغ',render:r=>moneyFa(String(r.amount))},{key:'paid_amount',label:'پرداخت‌شده',render:r=>moneyFa(String(r.paid_amount))},{key:'due_date',label:'سررسید'},{key:'status',label:'وضعیت',render:r=><Badge value={r.status}/> }]} actions={internal?r=><select aria-label="وضعیت فاکتور" value={String(r.status)} onChange={e=>void updateInvoice(r,e.target.value)}><option value={String(r.status)}>{statusLabel[String(r.status)]??String(r.status)}</option>{['issued','overdue','void'].filter(s=>s!==r.status).map(s=><option key={s} value={s}>{statusLabel[s]}</option>)}</select>:undefined}/>:<EmptyState title="فاکتوری وجود ندارد" description="فاکتورهای واقعی پس از ثبت توسط کاربران مجاز نمایش داده می‌شوند." icon={FileText}/>}</section><section className="panel recent-panel"><div className="panel-heading"><div><span className="section-number orange">۰۲</span><div><h3>تسویه تأمین‌کنندگان</h3><p>وضعیت بدهی و تطبیق داخلی</p></div></div>{internal&&<Button variant="soft" onClick={()=>{setMode('settlement');setForm({...form,amount:'',supplier_id:'',invoice_ref:'',due_date:'',note:''});setOpen(true)}}><Plus size={15}/> ثبت تسویه</Button>}</div>{loading?<div className="panel-loading"><span className="spinner small"/></div>:shownSet.length?<DataTable rows={shownSet} columns={[{key:'suppliers',label:'تأمین‌کننده',render:r=>(r.suppliers as any)?.name??'—'},{key:'invoice_ref',label:'مرجع فاکتور'},{key:'amount',label:'مبلغ',render:r=>moneyFa(String(r.amount))},{key:'due_date',label:'سررسید'},{key:'status',label:'وضعیت',render:r=><Badge value={r.status}/> }]} actions={internal?r=><select aria-label="وضعیت تسویه" value={String(r.status)} onChange={e=>void updateSettlement(r,e.target.value)}><option value={String(r.status)}>{statusLabel[String(r.status)]??String(r.status)}</option>{['approved','paid','disputed'].filter(s=>s!==r.status).map(s=><option key={s} value={s}>{statusLabel[s]}</option>)}</select>:undefined}/>:<EmptyState title="تسویه‌ای ثبت نشده" description="پس از ثبت توافق و سند مالی واقعی، رکورد تسویه اینجا قابل پیگیری است." icon={CreditCard}/>}</section>{open&&<Modal title={mode==='invoice'?'ثبت فاکتور فروش':'ثبت تسویه تأمین‌کننده'} subtitle="ثبت در دیتابیس؛ نه ارسال پول یا صدور سند رسمی به‌صورت خودکار." onClose={()=>setOpen(false)}><form className="record-form" onSubmit={create}>{mode==='invoice'?<><label className="full-span">سفارش<select required value={form.order_id} onChange={e=>{const o=orders.find(x=>x.id===e.target.value);setForm({...form,order_id:e.target.value,customer_id:String(o?.customer_id??'')})}}><option value="">انتخاب سفارش…</option>{orders.map(o=><option key={String(o.id)} value={String(o.id)}>{String(o.reference)} · {(o.customers as any)?.name??''}</option>)}</select></label><label>شماره فاکتور<input required value={form.reference} onChange={e=>setForm({...form,reference:e.target.value})} dir="ltr"/></label><label>مبلغ (تومان)<input type="number" min="0" required value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} dir="ltr"/></label></>:<><label className="full-span">تأمین‌کننده<select required value={form.supplier_id} onChange={e=>setForm({...form,supplier_id:e.target.value})}><option value="">انتخاب تأمین‌کننده…</option>{suppliers.map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}</select></label><label>مرجع فاکتور / سند<input value={form.invoice_ref} onChange={e=>setForm({...form,invoice_ref:e.target.value})}/></label><label>مبلغ (تومان)<input type="number" min="0" required value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} dir="ltr"/></label><label className="full-span">یادداشت<textarea rows={2} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label></>}<label className="full-span">سررسید<input type="date" value={form.due_date} onChange={e=>setForm({...form,due_date:e.target.value})}/></label><div className="modal-actions"><Button variant="soft" onClick={()=>setOpen(false)}>انصراف</Button><Button type="submit" disabled={busy}>{busy?'در حال ثبت…':'ثبت رکورد مالی'}</Button></div></form></Modal>}</>;
}
type MemberModulePermission = {
 key: string; label: string; configured: boolean;
 can_read: boolean; can_create: boolean; can_update: boolean; can_delete: boolean; can_approve: boolean;
};
type ModulePermissionField = 'can_read' | 'can_create' | 'can_update' | 'can_delete' | 'can_approve';
function MembersPage({membership,search}:{membership:Membership;search:string}) {
 const [rows,setRows]=useState<Row[]>([]);
 const [memberFilter,setMemberFilter]=useState<'all'|'supplier'|'driver'|'staff'|'admin'>('all');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [accountOpen,setAccountOpen]=useState(false);
 const [busy,setBusy]=useState(false);
 const [accountName,setAccountName]=useState('');
 const [accountUsername,setAccountUsername]=useState('');
 const [accountPassword,setAccountPassword]=useState('');
 const [accountRole,setAccountRole]=useState<AppRole>('supplier');
 const [accountCustomerId,setAccountCustomerId]=useState('');
 const [accountSupplierId,setAccountSupplierId]=useState('');
 const [customers,setCustomers]=useState<Row[]>([]);const [suppliers,setSuppliers]=useState<Row[]>([]);
const [resetSecret,setResetSecret]=useState('');
 const [permissionsMember,setPermissionsMember]=useState<Row|null>(null);
 const [modulePermissions,setModulePermissions]=useState<MemberModulePermission[]>([]);
 const [permissionsLoading,setPermissionsLoading]=useState(false);
 const [permissionsSaving,setPermissionsSaving]=useState(false);
 const load=async()=>{
  setLoading(true);setError('');
  try {
   const result=await api.get<{members:Row[]}>(`/api/workspace/members?companyId=${encodeURIComponent(membership.company_id)}`);
   setRows(result.members??[]);
   if(dataApi){
    const [customerResult,supplierResult]=await Promise.all([
     dataApi.from('customers').select('id,name').eq('company_id',membership.company_id).order('name'),
     dataApi.from('suppliers').select('id,name').eq('company_id',membership.company_id).order('name'),
    ]);
    // Related-record lists are optional for account provisioning. Their failure must not
    // turn a successful member load/create into a visible false failure.
    setCustomers(customerResult.error?[]:(customerResult.data??[]) as Row[]);
    setSuppliers(supplierResult.error?[]:(supplierResult.data??[]) as Row[]);
   } else {
    setCustomers([]);setSuppliers([]);
   }
  } catch(caught) {
   setError(caught instanceof Error?caught.message:'دریافت اعضای مجموعه ناموفق بود.');
   setRows([]);
  } finally {setLoading(false);}
 };
 useEffect(()=>{void load();},[membership.company_id]);
 const createAccount=async()=>{
  const normalizedUsername=accountUsername.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if(normalizedUsername.length<3||normalizedUsername.length>32||!/^[\p{L}\p{N}._-]+$/u.test(normalizedUsername)||/^[._-]|[._-]$/.test(normalizedUsername)){
   setError('نام کاربری باید ۳ تا ۳۲ نویسه باشد؛ از حروف، عدد، نقطه، خط تیره یا زیرخط استفاده کن و ابتدا/انتهای آن نشانه نگذار.');
   return;
  }
  if(accountPassword.length<12||accountPassword.length>128){
   setError('رمز عبور باید بین ۱۲ تا ۱۲۸ نویسه باشد.');
   return;
  }
  setBusy(true);setError('');setNotice('');setResetSecret('');
  try{
   const result=await api.post<{member:Row}>('/api/workspace/members/create',{
    companyId:membership.company_id,
    fullName:accountName.normalize('NFKC').trim(),
    username:normalizedUsername,
    password:accountPassword,
    role:accountRole,
    customerId:accountRole==='customer'?(accountCustomerId||null):null,
    supplierId:accountRole==='supplier'?(accountSupplierId||null):null,
   });
   if(!result.member?.membership_id||String(result.member.role)!==accountRole){
    throw new Error('پاسخ سرور کامل نیست؛ عضویت اختصاصی ثبت‌شده تأیید نشد. فهرست اعضا را تازه‌سازی کن و پیش از تحویل رمز، وضعیت حساب را بررسی کن.');
   }
   if(accountRole==='supplier'&&!result.member.supplier_id){
    throw new Error('حساب تأمین‌کننده بدون پروندهٔ متصل تأیید نشد. هیچ اطلاعات ورود تحویل نده؛ دوباره تلاش کن یا وضعیت پروندهٔ تأمین‌کننده را بررسی کن.');
   }
   if(accountRole==='customer'&&!result.member.customer_id){
    throw new Error('حساب مشتری بدون پروندهٔ متصل تأیید نشد. هیچ اطلاعات ورود تحویل نده؛ پروندهٔ مشتری را بررسی کن.');
   }
   const createdUsername=String(result.member?.username??normalizedUsername);
   setResetSecret('@'+createdUsername+' : '+accountPassword);
   setNotice('حساب ساخته شد. اطلاعات ورود را امن تحویل بده؛ کاربر در اولین ورود نام، نام خانوادگی و تلفن خود را تکمیل می‌کند.');
   setAccountOpen(false);setAccountName('');setAccountUsername('');setAccountPassword('');setAccountCustomerId('');setAccountSupplierId('');setAccountRole('supplier');
   await load();
  }catch(caught){
   setError(caught instanceof Error?caught.message:'ساخت حساب کاربری ناموفق بود.');
  }finally{setBusy(false);}
 };
 const resetMemberPassword=async(row:Row)=>{
  const name=String(row.username??row.full_name??'این کاربر');
  if(!window.confirm('گذرواژه حساب «'+name+'» بازنشانی شود؟ نشست‌های قبلی او بسته می‌شوند.'))return;
  const temporaryPassword='Mdr-'+crypto.randomUUID().replace(/-/g,'').slice(0,16)+'!';
  setBusy(true);setError('');setNotice('');setResetSecret('');
  try{
   await api.post('/api/workspace/members/reset-password',{companyId:membership.company_id,membershipId:String(row.membership_id??row.id),newPassword:temporaryPassword});
   setResetSecret('@'+String(row.username??'user')+' : '+temporaryPassword);
   setNotice('گذرواژه موقت ساخته شد. آن را فقط از مسیر امن به صاحب حساب بده؛ نشست‌های قبلی بسته شدند.');
  }catch(caught){
   setError(caught instanceof Error?caught.message:'بازنشانی گذرواژه ناموفق بود.');
  }finally{setBusy(false);}
 };
 const deactivate=async(row:Row)=>{
  const name=String(row.full_name??row.username??'این کاربر');
  if(!window.confirm('دسترسی «'+name+'» در این مجموعه غیرفعال شود؟'))return;
  setBusy(true);setError('');setNotice('');
  try {
   await api.post('/api/workspace/members/deactivate',{companyId:membership.company_id,membershipId:String(row.membership_id??row.id)});
   setNotice('دسترسی کاربر غیرفعال شد.');
   await load();
  } catch(caught) {
   setError(caught instanceof Error?caught.message:'غیرفعال‌سازی دسترسی ناموفق بود.');
  } finally {setBusy(false);}
 };
 const editPermissions=async(row:Row)=>{
  setPermissionsMember(row);setModulePermissions([]);setPermissionsLoading(true);setError('');setNotice('');
  try{
   const memberId=String(row.membership_id??row.id??'');
   const result=await api.get<{modules:MemberModulePermission[]}>(`/api/workspace/members/${encodeURIComponent(memberId)}/permissions?companyId=${encodeURIComponent(membership.company_id)}`);
   setModulePermissions((result.modules??[]).filter(module=>!DEFERRED_NAV_KEYS.has(String(module.key) as PageKey)));
  }catch(caught){
   setPermissionsMember(null);
   setError(caught instanceof Error?caught.message:'دریافت مجوزهای عضو ناموفق بود.');
  }finally{setPermissionsLoading(false);}
 };
 const setPermissionField=(moduleKey:string,field:ModulePermissionField,value:boolean)=>{
  setModulePermissions(current=>current.map(module=>module.key===moduleKey?{...module,[field]:value,configured:true}:module));
 };
 const resetPermissionsToRoleDefaults=()=>{
  setModulePermissions(current=>current.map(module=>({...module,configured:false,can_read:true,can_create:true,can_update:true,can_delete:false,can_approve:false})));
 };
 const saveModulePermissions=async()=>{
  if(!permissionsMember||permissionsSaving)return;
  setPermissionsSaving(true);setError('');setNotice('');
  try{
   await api.post(`/api/workspace/members/${encodeURIComponent(String(permissionsMember.membership_id??permissionsMember.id))}/permissions`,{
    companyId:membership.company_id,modules:modulePermissions,
   });
   setNotice('مجوزهای ماژول ذخیره شدند؛ محدودیت‌ها در API سمت سرور اعمال می‌شوند.');
   setPermissionsMember(null);
  }catch(caught){
   setError(caught instanceof Error?caught.message:'ذخیره مجوزهای عضو ناموفق بود.');
  }finally{setPermissionsSaving(false);}
 };
 const visible=rows.filter(r=>(memberFilter==='all'||String(r.role)===memberFilter)&&(!search||[r.username,r.full_name,r.phone,r.role,r.supplier_name].some(v=>String(v??'').toLowerCase().includes(search.toLowerCase()))));
 const options:AppRole[]=membership.role==='owner'?['admin','staff','supplier','driver']:['staff','supplier','driver'];
 return <>
  <PageHeading eyebrow="ACCESS / MEMBERSHIPS" title="دسترسی کاربران" description="حساب اختصاصی را با نام کاربری، رمز اولیه و نقش مشخص بساز؛ کاربر پس از اولین ورود مشخصات فردی‌اش را تکمیل می‌کند." action={<Button onClick={()=>{setAccountOpen(true);setError('');setNotice('');setAccountName('');setAccountUsername('');setAccountPassword('');setAccountRole('supplier');setAccountCustomerId('');setAccountSupplierId('');}}><Plus size={15}/> ساخت حساب جدید</Button>}/>
  {error&&<InlineError error={error} retry={()=>void load()}/>}
  {notice&&<div className="form-success notice-wide"><CheckCircle2 size={17}/>{notice}</div>}
  <div className="member-role-filters" role="group" aria-label="تفکیک کاربران بر اساس نقش">
   {([{key:'all',label:'همه کاربران'},{key:'supplier',label:'تأمین‌کنندگان'},{key:'driver',label:'رانندگان'},{key:'staff',label:'کارشناسان'},{key:'admin',label:'مدیران'}] as const).map(filter=><button key={filter.key} type="button" className={memberFilter===filter.key?'active':''} aria-pressed={memberFilter===filter.key} onClick={()=>setMemberFilter(filter.key)}>{filter.label}<small>{numberFa(rows.filter(row=>filter.key==='all'||String(row.role)===filter.key).length)}</small></button>)}
  </div>
  {resetSecret&&<section className="panel invite-code-panel"><div className="panel-heading"><div><span className="section-number">LOGIN DETAILS</span><div><h3>اطلاعات ورود</h3><p>این اطلاعات را کپی کن و فقط به صاحب حساب تحویل بده.</p></div></div><Button variant="soft" onClick={()=>void navigator.clipboard?.writeText(resetSecret)}>کپی اطلاعات</Button></div><code className="invite-code-value" dir="ltr">{resetSecret}</code></section>}
  <div className="rule-banner"><ShieldCheck size={18}/><p><b>کنترل دسترسی سمت سرور</b><span>ثبت‌نام عمومی و کد دعوت غیرفعال است. مالک یا مدیر مجاز حساب را می‌سازد؛ فقط مالک می‌تواند نقش مدیر بسازد. کاربر پس از ورود مشخصات فردی را تکمیل می‌کند و نمی‌تواند نقش خود را تغییر دهد.</span></p></div>
  <section className="panel entity-panel members-list-panel"><div className="entity-toolbar"><div><b>{numberFa(visible.length)} عضویت</b><small>فهرست واقعی عضویت‌های مجموعه</small></div><Button variant="soft" onClick={()=>void load()}>تازه‌سازی</Button></div>
   {loading?<div className="panel-loading"><span className="spinner small"/></div>:visible.length?<DataTable rows={visible} columns={[
    {key:'username',label:'نام کاربری',render:r=><div><b dir="ltr">@{String(r.username??'')}</b><small className="cell-subtitle">{String(r.full_name??'بدون نام')}</small></div>},
    {key:'phone',label:'موبایل',render:r=><span dir="ltr">{String(r.phone??'—')}</span>},
    {key:'supplier_name',label:'تأمین‌کننده مرتبط',render:r=>String(r.supplier_name??'—')},
    {key:'role',label:'نقش',render:r=><Badge value={r.role} type="role"/>},
    {key:'active',label:'عضویت',render:r=><Badge value={r.active?'active':'inactive'}/>},
    {key:'account_status',label:'حساب',render:r=><Badge value={r.account_status==='active'?'active':'inactive'}/>},
    {key:'last_login_at',label:'آخرین ورود',render:r=>r.last_login_at?dateTimeFa(String(r.last_login_at)):'هنوز وارد نشده'},
    {key:'created_at',label:'افزوده‌شده',render:r=>dateFa(String(r.created_at??''))}
   ]} actions={r=>r.active===true&&r.role!=='owner'?<div className="table-action-group">
    {r.role!=='admin'&&<Button variant="soft" disabled={busy||permissionsLoading} onClick={()=>void editPermissions(r)}>مجوزها</Button>}
    <Button variant="soft" disabled={busy||(r.role==='admin'&&membership.role!=='owner')} onClick={()=>void resetMemberPassword(r)}>بازنشانی رمز</Button>
    <Button variant="danger" disabled={busy} onClick={()=>void deactivate(r)}>غیرفعال‌سازی</Button>
   </div>:<span className="muted-text">—</span>}/>:<EmptyState title="هنوز عضوی در فهرست نیست" description="حساب نخستین همکار را با دکمهٔ «ساخت حساب جدید» بساز؛ افراد فقط با نام کاربری و رمز عبور وارد می‌شوند." icon={Users}/>}
  </section>
  {permissionsMember&&<Modal title="مجوزهای ماژولی عضو" subtitle={`دسترسی‌های ${String(permissionsMember.full_name??permissionsMember.username??'عضو')} را محدود کن. این تنظیمات مجوزهای پیش‌فرض نقش را گسترش نمی‌دهند.`} onClose={()=>{if(!permissionsSaving)setPermissionsMember(null);}}>
   {permissionsLoading?<div className="panel-loading"><span className="spinner small"/></div>:<div className="module-permissions-dialog" dir="rtl">
    <div className="module-permissions-note"><ShieldCheck size={16}/><span>محدودیت‌ها در API و داده‌های همان مجموعه اعمال می‌شوند. خاموش‌کردن «استفاده از پیش‌فرض نقش» به معنی جایگزین‌کردن مجوزها با همین انتخاب‌هاست.</span></div>
    <div className="module-permissions-header"><b>ماژول</b><b>مشاهده</b><b>ایجاد</b><b>ویرایش</b><b>حذف</b><b>تأیید</b></div>
    <div className="module-permissions-list">{modulePermissions.map(module=><section className="module-permission-row" key={module.key}>
      <div className="module-permission-name"><b>{module.label}</b><small>{module.configured?'مجوز سفارشی':'استفاده از پیش‌فرض نقش'}</small></div>
      {([
       ['can_read','مشاهده'],['can_create','ایجاد'],['can_update','ویرایش'],['can_delete','حذف'],['can_approve','تأیید'],
      ] as Array<[ModulePermissionField,string]>).map(([field,label])=><label className="module-permission-toggle" key={field} title={label}>
       <input type="checkbox" aria-label={module.label+' — '+label} checked={module.configured?module[field]:module[field]} onChange={event=>setPermissionField(module.key,field,event.currentTarget.checked)}/>
      </label>)}
     </section>)}</div>
    <div className="module-permissions-actions">
     <button type="button" className="agent-secondary-button" onClick={resetPermissionsToRoleDefaults} disabled={permissionsSaving}>بازگشت به پیش‌فرض نقش</button>
     <button type="button" className="agent-primary-button" onClick={()=>void saveModulePermissions()} disabled={permissionsSaving||!modulePermissions.length}>{permissionsSaving?'در حال ذخیره…':'ذخیره مجوزها'}</button>
    </div>
   </div>}
  </Modal>}
  {accountOpen&&<Modal title="ساخت حساب اختصاصی" subtitle="حساب فوراً با نقش تعیین‌شده ساخته می‌شود؛ نام کاربری و رمز اولیه را از مسیر امن به فرد بده." onClose={()=>{if(!busy)setAccountOpen(false);}}><form className="record-form" onSubmit={e=>{e.preventDefault();void createAccount();}}>
   <label className="full-span">نام و نام خانوادگی (اختیاری)<input maxLength={100} value={accountName} onChange={e=>setAccountName(e.target.value)} autoComplete="off"/><small>در صورت خالی‌ماندن، کاربر هنگام اولین ورود نام و نام خانوادگی خود را ثبت می‌کند.</small></label>
   <label>نام کاربری<input required minLength={3} maxLength={32} value={accountUsername} onChange={e=>setAccountUsername(e.target.value.toLowerCase())} dir="ltr" autoComplete="off"/><small>۳ تا ۳۲ نویسه؛ بدون فاصله</small></label>
   <label>رمز عبور اولیه<input required minLength={12} maxLength={128} type="password" value={accountPassword} onChange={e=>setAccountPassword(e.target.value)} dir="ltr" autoComplete="new-password"/><small>حداقل ۱۲ نویسه؛ پس از ورود قابل تغییر است</small></label>
   <label className="full-span">نقش کاربر<select value={accountRole} onChange={e=>{setAccountRole(e.target.value as AppRole);setAccountCustomerId('');setAccountSupplierId('');}}>{options.map(r=><option value={r} key={r}>{roleLabel[r]}</option>)}</select></label>
   {accountRole==='customer'&&<label className="full-span">حساب مشتری<select required value={accountCustomerId} onChange={e=>setAccountCustomerId(e.target.value)}><option value="">انتخاب مشتری همین مجموعه…</option>{customers.map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label>}
   {accountRole==='supplier'&&<label className="full-span">پرونده تأمین‌کننده (اختیاری)<select value={accountSupplierId} onChange={e=>setAccountSupplierId(e.target.value)}><option value="">ساخت پرونده پس از تکمیل پروفایل کاربر</option>{suppliers.map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select><small>اگر پرونده‌ای انتخاب نکنی، مدار هنگام ساخت حساب یک پرونده اولیه می‌سازد و با تکمیل پروفایل، نام و نشانی واقعی را روی همان پرونده ثبت می‌کند.</small></label>}
   {error&&<div className="form-error full-span">{error}</div>}
   <div className="modal-actions"><Button variant="soft" onClick={()=>setAccountOpen(false)} disabled={busy}>انصراف</Button><Button type="submit" disabled={busy||accountUsername.trim().length<3||accountPassword.length<12||(accountRole==='customer'&&!accountCustomerId)}>{busy?'در حال ساخت حساب…':'ساخت حساب و نمایش اطلاعات ورود'}</Button></div>
  </form></Modal>}
 </>;
}
function AuditPage({membership,search}:{membership:Membership;search:string}) { const {rows,loading,error,refresh}=useDbRows('audit_events',membership,{order:'occurred_at'});const shown=rows.filter(r=>!search||`${r.table_name} ${r.action} ${r.record_id??''}`.toLowerCase().includes(search.toLowerCase()));return <><PageHeading eyebrow="GOVERNANCE / AUDIT" title="تاریخچه تغییرات" description="رویدادهای داده‌ای که در جدول‌های اصلی ثبت شده‌اند؛ برای مالک و مدیر مجموعه." action={<Button variant="soft" onClick={()=>void refresh()}><Activity size={15}/> تازه‌سازی</Button>}/>{error&&<InlineError error={error} retry={()=>void refresh()}/>}<section className="panel entity-panel">{loading?<div className="panel-loading"><span className="spinner small"/></div>:shown.length?<DataTable rows={shown} columns={[{key:'occurred_at',label:'زمان',render:r=>dateTimeFa(String(r.occurred_at??''))},{key:'actor_id',label:'کاربر',render:r=>r.actor_id?String(r.actor_id).slice(0,8):'سیستم'},{key:'table_name',label:'بخش',render:r=>pageSectionLabel(String(r.table_name??''))},{key:'action',label:'عملیات',render:r=>({INSERT:'ایجاد',UPDATE:'ویرایش',DELETE:'حذف'} as Record<string,string>)[String(r.action??'').toUpperCase()]??'رویداد سیستمی'},{key:'record_id',label:'شناسه رکورد',render:r=><code>{String(r.record_id??'—').slice(0,12)}</code>},{key:'changes',label:'خلاصه تغییرات',render:r=><code className="changes-code">{JSON.stringify(r.changes??{})}</code>} ]}/>:<EmptyState title="رویدادی ثبت نشده" description="پس از ایجاد یا تغییر رکوردهای اصلی، تاریخچه از طریق trigger دیتابیس تکمیل می‌شود." icon={Activity}/>}</section></>; }
function CustomerCatalog({membership}:{membership:Membership}) {
 const {user}=useAuth();const [items,setItems]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [quantities,setQuantities]=useState<Record<string,string>>({});const [busy,setBusy]=useState('');const [notice,setNotice]=useState('');
 const load=async()=>{if(!dataApi||!membership.customer_id)return;setLoading(true);setError('');const {data,error:e}=await dataApi.from('price_agreements').select('id,product_id,unit_price,min_qty,valid_from,valid_to,products(id,name,sku,unit,kind,shelf_life_days,storage_note)').eq('company_id',membership.company_id).eq('customer_id',membership.customer_id).lte('valid_from',new Date().toISOString().slice(0,10)).order('valid_from',{ascending:false}).limit(200);if(e)setError(e.message);setItems((data??[]) as Row[]);setLoading(false);};useEffect(()=>{void load()},[membership.company_id,membership.customer_id]);
 const orderNow=async(agreement:Row)=>{if(!dataApi||!membership.customer_id||!user)return;const p=agreement.products as any;if(!p?.id)return;const qty=Number(quantities[String(agreement.id)]??agreement.min_qty);if(!Number.isFinite(qty)||qty<Number(agreement.min_qty)){setError(`حداقل مقدار مجاز برای «${p.name}» برابر ${numberFa(String(agreement.min_qty))} است.`);return;}setBusy(String(agreement.id));setError('');setNotice('');const {data:o,error:oe}=await dataApi.from('orders').insert({company_id:membership.company_id,customer_id:membership.customer_id,status:'draft',created_by:user.id}).select('id,reference').single();if(oe){setError(oe.message);setBusy('');return;}const {error:ie}=await dataApi.from('order_items').insert({company_id:membership.company_id,order_id:o.id,product_id:p.id,quantity:qty,unit_price:Number(agreement.unit_price)});if(ie){await dataApi.from('orders').update({status:'cancelled'}).eq('id',o.id).eq('company_id',membership.company_id);setError(ie.message);}else setNotice(`پیش‌نویس سفارش ${o.reference} ساخته شد. برای نهایی شدن، وضعیت را از بخش «سفارش‌های من» ارسال کن.`);setBusy('');};
 return <><PageHeading eyebrow="CUSTOMER COMMERCE / CATALOG" title="کاتالوگ اختصاصی شما" description="فقط محصولاتی نمایش داده می‌شوند که برای حساب سازمانی شما قرارداد قیمت فعال دارند." action={<Button variant="soft" onClick={()=>void load()}>تازه‌سازی کاتالوگ</Button>}/>{error&&<InlineError error={error} retry={()=>void load()}/>}{notice&&<div className="form-success notice-wide"><CheckCircle2 size={17}/>{notice}<Link to="/app/my-orders">مشاهده سفارش‌ها <ArrowLeft size={14}/></Link></div>}{loading?<div className="panel-loading"><span className="spinner small"/></div>:items.length?<div className="catalog-grid">{items.filter(a=>(a.products as any)?.id&&(!a.valid_to||String(a.valid_to)>=new Date().toISOString().slice(0,10))).map(a=>{const p=a.products as any;return <article className="catalog-card" key={String(a.id)}><div className={`catalog-art ${p.kind==='farm_product'||p.kind==='eggs'||p.kind==='meat'?'farm-art':p.kind==='input'?'input-art':p.kind==='processed'?'processed-art':'other-art'}`}><span>{productKindLabel(p.kind)}</span><Boxes size={44}/><small>{String(p.sku??'')}</small></div><div className="catalog-details"><div className="catalog-product-meta"><span>قیمت توافق‌شده حساب شما</span><Badge value="active"/></div><h3>{String(p.name)}</h3><p>{String(p.unit)}{p.shelf_life_days?` · ماندگاری ثبت‌شده ${numberFa(p.shelf_life_days)} روز`:''}</p>{p.storage_note&&<small className="catalog-storage">{String(p.storage_note)}</small>}<div className="catalog-price"><b>{moneyFa(String(a.unit_price))}</b><small>حداقل مقدار: {numberFa(String(a.min_qty))} {String(p.unit)}</small></div><div className="catalog-buy-row"><label>مقدار<input type="number" min={Number(a.min_qty)} step="0.001" value={quantities[String(a.id)]??String(a.min_qty)} onChange={e=>setQuantities({...quantities,[String(a.id)]:e.target.value})} dir="ltr"/></label><Button onClick={()=>void orderNow(a)} disabled={busy===String(a.id)}>{busy===String(a.id)?'در حال ثبت…':<><Plus size={15}/> افزودن به سفارش</>}</Button></div></div></article>})}</div>:<section className="panel"><EmptyState title="کاتالوگ اختصاصی هنوز آماده نیست" description="برای حساب شما قرارداد قیمت فعال پیدا نشد. از مسئول فروش بخواه محصول و شرایط قیمت را در پنل مدیریت ثبت کند." icon={Package}/></section>}</>;
}
function CustomerOrders({membership,search}:{membership:Membership;search:string}) {
 const [orders,setOrders]=useState<Row[]>([]);const [invoices,setInvoices]=useState<Row[]>([]);const [shipments,setShipments]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [busy,setBusy]=useState('');
 const load=async()=>{if(!dataApi)return;setLoading(true);const [o,i,s]=await Promise.all([dataApi.from('orders').select('id,reference,status,requested_delivery,delivery_address,created_at,order_items(quantity,unit_price,products(name,unit))').eq('company_id',membership.company_id).eq('customer_id',membership.customer_id??'').order('created_at',{ascending:false}).limit(250),dataApi.from('invoices').select('*').eq('company_id',membership.company_id).eq('customer_id',membership.customer_id??'').order('created_at',{ascending:false}).limit(250),dataApi.from('shipments').select('id,order_id,stage,planned_departure,departed_at,delivered_at,vehicle').eq('company_id',membership.company_id).order('created_at',{ascending:false}).limit(250)]);const err=o.error??i.error??s.error;if(err)setError(err.message);setOrders((o.data??[]) as Row[]);setInvoices((i.data??[]) as Row[]);setShipments((s.data??[]) as Row[]);setLoading(false);};useEffect(()=>{void load()},[membership.company_id,membership.customer_id]);
 const submit=async(o:Row)=>{if(!dataApi||!window.confirm(`سفارش ${String(o.reference)} برای بررسی به مجموعه ارسال شود؟`))return;setBusy(String(o.id));const {error:e}=await dataApi.from('orders').update({status:'submitted'}).eq('id',String(o.id)).eq('company_id',membership.company_id);if(e)setError(e.message);else await load();setBusy('');};const shown=orders.filter(o=>!search||`${o.reference} ${o.status}`.toLowerCase().includes(search.toLowerCase()));
 return <><PageHeading eyebrow="CUSTOMER COMMERCE / ORDERS" title="سفارش‌های سازمانی شما" description="پیش‌نویس‌ها، وضعیت پردازش و موعد تحویل از داده واقعی سیستم خوانده می‌شوند." action={<Button variant="soft" onClick={()=>void load()}>تازه‌سازی</Button>}/>{error&&<InlineError error={error} retry={()=>void load()}/>}<section className="panel entity-panel"><div className="panel-heading"><div><span className="section-number">۰۱</span><div><h3>سفارش‌ها</h3><p>ارسال پیش‌نویس به‌معنای تأیید تأمین نیست.</p></div></div><Link to="/app/catalog" className="link-action">رفتن به کاتالوگ <ArrowLeft size={14}/></Link></div>{loading?<div className="panel-loading"><span className="spinner small"/></div>:shown.length?<div className="customer-order-stack">{shown.map(o=><article className="customer-order-card" key={String(o.id)}><div className="customer-order-main"><span className="order-symbol"><FileText size={19}/></span><div><b>{String(o.reference)}</b><small>{dateTimeFa(String(o.created_at??''))}</small><div className="order-items-inline">{((o.order_items??[]) as any[]).map((it,i)=><span key={i}>{String(it.products?.name??'محصول')} · {numberFa(String(it.quantity))} {String(it.products?.unit??'')}</span>)}</div></div></div><div className="customer-order-status"><Badge value={o.status}/><small>تحویل درخواستی: {dateFa(String(o.requested_delivery??''))}</small></div>{o.status==='draft'&&<Button onClick={()=>void submit(o)} disabled={busy===String(o.id)}>{busy===String(o.id)?'در حال ارسال…':'ارسال برای بررسی'} <ArrowLeft size={14}/></Button>}</article>)}</div>:<EmptyState title="سفارشی وجود ندارد" description="از کاتالوگ اختصاصی اولین سفارش خود را بساز." icon={FileText}/>}</section><section className="panel recent-panel"><div className="panel-heading"><div><span className="section-number">۰۲</span><div><h3>پیگیری ارسال</h3><p>مرحله‌ای که عملیات ثبت کرده است</p></div></div></div>{shipments.filter(s=>orders.some(o=>o.id===s.order_id)).length?<DataTable rows={shipments.filter(s=>orders.some(o=>o.id===s.order_id))} columns={[{key:'id',label:'محموله',render:r=><code>{String(r.id).slice(0,8).toUpperCase()}</code>},{key:'order_id',label:'سفارش',render:r=>String(orders.find(o=>o.id===r.order_id)?.reference ?? '—')},{key:'stage',label:'مرحله',render:r=><Badge value={r.stage}/>},{key:'planned_departure',label:'زمان برنامه‌ریزی',render:r=>dateTimeFa(String(r.planned_departure??''))},{key:'delivered_at',label:'تحویل',render:r=>dateTimeFa(String(r.delivered_at??''))}]}/>:<EmptyState title="ارسالی در جریان نیست" description="پس از تخصیص محموله از سوی تیم عملیات، وضعیت در این بخش نمایش داده می‌شود." icon={Truck}/>}</section><section className="panel recent-panel"><div className="panel-heading"><div><span className="section-number">۰۳</span><div><h3>فاکتورها</h3><p>سوابق فاکتور در حساب سازمانی</p></div></div></div>{invoices.length?<DataTable rows={invoices} columns={[{key:'reference',label:'شماره فاکتور'},{key:'amount',label:'مبلغ',render:r=>moneyFa(String(r.amount))},{key:'paid_amount',label:'پرداخت‌شده',render:r=>moneyFa(String(r.paid_amount))},{key:'due_date',label:'سررسید'},{key:'status',label:'وضعیت',render:r=><Badge value={r.status}/>}]}/>:<EmptyState title="فاکتوری صادر نشده" description="فاکتور پس از پردازش تجاری توسط تیم مجاز صادر می‌شود." icon={CreditCard}/>}</section></>;
}
function CustomerAccount({membership}:{membership:Membership}) {const [customer,setCustomer]=useState<Row|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const load=async()=>{if(!dataApi||!membership.customer_id)return;setLoading(true);const {data,error:e}=await dataApi.from('customers').select('*').eq('id',membership.customer_id).eq('company_id',membership.company_id).maybeSingle();if(e)setError(e.message);setCustomer(data as Row|null);setLoading(false);};useEffect(()=>{void load()},[membership.company_id,membership.customer_id]);return <><PageHeading eyebrow="CUSTOMER ACCOUNT / TERMS" title="حساب سازمانی" description="مشخصات، شرایط اعتباری و اطلاعات حساب بر اساس عضویت تأییدشده شما." action={<Button variant="soft" onClick={()=>void load()}>تازه‌سازی</Button>}/>{error&&<InlineError error={error} retry={()=>void load()}/>}<section className="panel account-panel">{loading?<div className="panel-loading"><span className="spinner small"/></div>:customer?<div className="account-grid"><div className="account-summary"><span className="account-avatar"><Building2 size={25}/></span><span className="eyebrow">حساب سازمانی تأییدشده</span><h2>{String(customer.name)}</h2><Badge value={customer.active?'active':'inactive'}/><p>شناسه حساب: <code>{String(customer.id).slice(0,12).toUpperCase()}</code></p></div><div className="account-details"><div><small>شهر</small><b>{String(customer.city??'ثبت نشده')}</b></div><div><small>تلفن</small><b>{String(customer.phone??'ثبت نشده')}</b></div><div><small>بخش مشتری</small><b>{String(customer.segment??'ثبت نشده')}</b></div><div><small>سقف اعتبار ثبت‌شده</small><b>{customer.credit_limit==null?'تعریف نشده':moneyFa(String(customer.credit_limit))}</b></div><div className="account-full"><small>نشانی</small><b>{String(customer.address??'نشانی ثبت نشده')}</b></div></div></div>:<EmptyState title="حساب سازمانی یافت نشد" description="از مدیر مجموعه بخواه ارتباط عضویت با حساب مشتری را بررسی کند." icon={Building2}/>}</section><div className="rule-banner"><ShieldCheck size={17}/><p><b>شرایط قرارداد</b><span>قیمت‌ها و مهلت‌های قراردادی فقط پس از ثبت در سیستم معتبرند. برای تغییر شماره تماس یا نشانی، از مسئول فروش درخواست اصلاح اطلاعات کن.</span></p></div></>}
function SupplierWork({membership,search}:{membership:Membership;search:string}) {const [rows,setRows]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const load=async(silent=false)=>{if(!dataApi||!membership.supplier_id)return;if(!silent)setLoading(true);const {data,error:e}=await dataApi.from('order_items').select('id,quantity,unit_price,orders(id,reference,status,requested_delivery,delivery_address),products(name,unit)').eq('company_id',membership.company_id).eq('supplier_id',membership.supplier_id).order('created_at',{ascending:false}).limit(200);if(e)setError(e.message);setRows((data??[]) as Row[]);setLoading(false);};useEffect(()=>{void load();const refresh=window.setInterval(()=>void load(true),60000);return()=>window.clearInterval(refresh)},[membership.company_id,membership.supplier_id]);const shown=rows.filter(r=>!search||`${(r.orders as any)?.reference??''} ${(r.products as any)?.name??''} ${(r.orders as any)?.status??''}`.toLowerCase().includes(search.toLowerCase()));return <><PageHeading eyebrow="SUPPLIER / ASSIGNED WORK" title="سفارش‌های واگذارشده" description="فقط اقلامی نمایش داده می‌شوند که واقعاً به حساب تأمین‌کننده شما تخصیص یافته‌اند." action={<Button variant="soft" onClick={()=>void load()}>تازه‌سازی</Button>}/>{error&&<InlineError error={error} retry={()=>void load()}/>}<section className="panel entity-panel">{loading?<div className="panel-loading"><span className="spinner small"/></div>:shown.length?<DataTable rows={shown} columns={[{key:'orders',label:'سفارش',render:r=><div><b>{String((r.orders as any)?.reference??'—')}</b><small className="cell-subtitle">{dateFa(String((r.orders as any)?.requested_delivery??''))}</small></div>},{key:'products',label:'محصول',render:r=>(r.products as any)?.name??'—'},{key:'quantity',label:'مقدار',render:r=>`${numberFa(String(r.quantity))} ${(r.products as any)?.unit??''}`},{key:'status',label:'وضعیت سفارش',render:r=><Badge value={(r.orders as any)?.status??'—'}/>},{key:'delivery_address',label:'نشانی تحویل',render:r=>String((r.orders as any)?.delivery_address??'—')}]}/>:<EmptyState title="سفارش واگذارشده‌ای موجود نیست" description="وقتی تیم عملیات اقلام سفارش را به تأمین‌کننده شما تخصیص دهد، جزئیات و موعد تحویل اینجا ظاهر می‌شود." icon={ClipboardCheck}/>}</section><div className="rule-banner"><CheckCircle2 size={17}/><p><b>ظرفیت تعهد قطعی است، نه اعلامی</b><span>برای اعلام ظرفیت از بخش «ظرفیت من» استفاده کن. فقط مقدار تأییدشده با مجوز مجموعه به تعهد خرید تبدیل می‌شود.</span></p></div></>}
function SupplierCapacityPage({membership,search}:{membership:Membership;search:string}) {
 const [rows,setRows]=useState<Row[]>([]);const [products,setProducts]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [replacementTarget,setReplacementTarget]=useState<Row|null>(null);const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);const [evidenceFile,setEvidenceFile]=useState<File|null>(null);
 const [form,setForm]=useState({product_id:'',period_start:new Date().toISOString().slice(0,10),period_end:new Date().toISOString().slice(0,10),declared_qty:'',note:''});
 const load=async()=>{if(!dataApi||!membership.supplier_id)return;setLoading(true);const [c,p]=await Promise.all([dataApi.from('capacity_commitments').select('*,products(name,unit)').eq('company_id',membership.company_id).eq('supplier_id',membership.supplier_id).order('created_at',{ascending:false}).limit(200),dataApi.from('products').select('id,name,unit').eq('company_id',membership.company_id).eq('active',true).order('name')]);const err=c.error??p.error;if(err)setError(err.message);setRows((c.data??[]) as Row[]);setProducts((p.data??[]) as Row[]);setLoading(false);};
 useEffect(()=>{void load()},[membership.company_id,membership.supplier_id]);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!dataApi||!membership.supplier_id)return;if(!evidenceFile){setError('برای اعلام ظرفیت، عکس یا سند اثبات ظرفیت الزامی است.');return;}if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(evidenceFile.type)){setError('فقط PDF، JPG، PNG یا WEBP مجاز است.');return;}if(evidenceFile.size>10*1024*1024){setError('حجم مدرک نباید بیشتر از ۱۰ مگابایت باشد.');return;}if(new Date(form.period_end)<new Date(form.period_start)){setError('پایان بازه نمی‌تواند قبل از شروع باشد.');return;}
  setBusy(true);setError('');const filename=evidenceFile.name.replace(/[^\w.-]/g,'_');const path=membership.company_id+'/'+membership.supplier_id+'/capacity-'+Date.now()+'-'+filename;
  const uploaded=await dataApi.storage.from('capacity-evidence').upload(path,evidenceFile,{upsert:false,contentType:evidenceFile.type});
  if(uploaded.error){setBusy(false);setError(uploaded.error.message);return;}
  const {error:e2}=await dataApi.from('capacity_commitments').insert({company_id:membership.company_id,supplier_id:membership.supplier_id,product_id:form.product_id,period_start:form.period_start,period_end:form.period_end,declared_qty:Number(form.declared_qty),status:'declared',note:form.note||null,created_by:membership.user_id,evidence_path:path,evidence_name:evidenceFile.name,evidence_mime_type:evidenceFile.type,evidence_uploaded_at:new Date().toISOString(),evidence_review_status:'pending_review'});
  setBusy(false);if(e2){await dataApi.storage.from('capacity-evidence').remove([path]);setError(e2.message);return;}setOpen(false);setEvidenceFile(null);setForm({...form,declared_qty:'',note:''});await load();};
 const replaceEvidence=async(row:Row,file:File)=>{
  if(!dataApi||!membership.supplier_id)return;
  if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){setError('فقط PDF/JPG/PNG/WEBP تا ۱۰ مگابایت مجاز است.');return;}
  setBusy(true);setError('');setNotice('');
  const path=membership.company_id+'/'+membership.supplier_id+'/capacity-'+Date.now()+'-'+file.name.replace(/[^\w.-]/g,'_');
  const uploaded=await dataApi.storage.from('capacity-evidence').upload(path,file,{upsert:false,contentType:file.type});
  if(uploaded.error){setBusy(false);setError(uploaded.error.message);return;}
  const {error:e}=await dataApi.from('capacity_commitments').update({evidence_path:path,evidence_name:file.name,evidence_mime_type:file.type,evidence_uploaded_at:new Date().toISOString()}).eq('id',String(row.id)).eq('company_id',membership.company_id).eq('supplier_id',membership.supplier_id).eq('evidence_review_status','rejected');
  setBusy(false);
  if(e){await dataApi.storage.from('capacity-evidence').remove([path]);setError(e.message);return;}
  setReplacementTarget(null);setNotice('مدرک اصلاح‌شده ارسال شد و دوباره در صف بررسی مدیر قرار گرفت.');await load();
 };
 const shown=rows.filter(r=>!search||`${(r.products as any)?.name??''} ${r.status} ${r.evidence_review_status??''}`.toLowerCase().includes(search.toLowerCase()));
 return <><input id="capacity-replacement-input" type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file&&replacementTarget)void replaceEvidence(replacementTarget,file);}}/><PageHeading eyebrow="SUPPLIER / CAPACITY" title="ظرفیت من" description="هر اعلام ظرفیت باید مدرک تصویری یا سند پشتیبان داشته باشد. ظرفیت فقط پس از بررسی مدیر قابل اتکا محسوب می‌شود." action={<Button onClick={()=>setOpen(true)}><Plus size={16}/> اعلام ظرفیت مستند</Button>}/>{error&&<InlineError error={error} retry={()=>void load()}/ >}{notice&&<div className="notification-notice" role="status">{notice}</div>}<section className="capacity-summary"><div><small>بازه‌های ثبت‌شده</small><b>{numberFa(rows.length)}</b></div><div><small>در انتظار بررسی</small><b>{numberFa(rows.filter(r=>r.evidence_review_status==='pending_review').length)}</b></div><div><small>تأییدشده</small><b>{numberFa(rows.filter(r=>r.evidence_review_status==='approved').length)}</b></div><span>ظرفیت اعلامی، تأییدشده و متعهدشده جدا هستند؛ بدون مدرک، ظرفیت تأیید نمی‌شود.</span></section><section className="panel entity-panel">{loading?<div className="panel-loading"><span className="spinner small"/></div>:shown.length?<DataTable rows={shown} columns={[{key:'products',label:'محصول',render:r=>(r.products as any)?.name??'—'},{key:'period_start',label:'شروع بازه',render:r=>dateFa(String(r.period_start??''))},{key:'period_end',label:'پایان بازه',render:r=>dateFa(String(r.period_end??''))},{key:'declared_qty',label:'اعلامی',render:r=>`${numberFa(String(r.declared_qty))} ${(r.products as any)?.unit??''}`},{key:'confirmed_qty',label:'تأییدشده',render:r=>r.confirmed_qty==null?'در انتظار':numberFa(String(r.confirmed_qty))},{key:'evidence_name',label:'مدرک',render:r=>r.evidence_name?String(r.evidence_name):'بدون مدرک'},{key:'evidence_review_status',label:'بازبینی',render:r=><Badge value={r.evidence_review_status??'missing'}/>},{key:'status',label:'وضعیت ظرفیت',render:r=><Badge value={r.status}/>}]} actions={r=>r.evidence_review_status==='rejected'?<Button variant="soft" disabled={busy} onClick={()=>{setReplacementTarget(r);document.getElementById('capacity-replacement-input')?.click();}}>اصلاح و ارسال دوباره</Button>:<span className="muted-text">{r.evidence_review_status==='pending_review'?'در انتظار بررسی':r.evidence_review_status==='approved'?'تأیید شده':'مدرک لازم است'}</span>} />:<EmptyState title="هنوز ظرفیتی اعلام نکرده‌ای" description="برای ثبت، محصول و بازه را مشخص کن و عکس یا سند قابل بررسی پیوست کن." icon={Warehouse}/>}</section>{open&&<Modal title="اعلام ظرفیت مستند" subtitle="عکس یا سند به‌صورت خصوصی بارگذاری می‌شود و تا بازبینی مدیر، وضعیت «در انتظار بررسی» باقی می‌ماند." onClose={()=>{if(!busy)setOpen(false);}}><form className="record-form" onSubmit={submit}><label className="full-span">محصول قابل تأمین<select required value={form.product_id} onChange={e=>setForm({...form,product_id:e.target.value})}><option value="">انتخاب محصول…</option>{products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)} · {String(p.unit)}</option>)}</select></label><label>شروع بازه<input type="date" required value={form.period_start} onChange={e=>setForm({...form,period_start:e.target.value})}/></label><label>پایان بازه<input type="date" required value={form.period_end} onChange={e=>setForm({...form,period_end:e.target.value})}/></label><label>ظرفیت اعلامی<input type="number" min="0.001" step="0.001" required value={form.declared_qty} onChange={e=>setForm({...form,declared_qty:e.target.value})} dir="ltr"/></label><label className="full-span">عکس یا سند اثبات ظرفیت<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={e=>setEvidenceFile(e.target.files?.[0]??null)}/><small>PDF، JPG، PNG یا WEBP · حداکثر ۱۰ مگابایت</small></label><label className="full-span">توضیح منبع و شرایط<textarea rows={3} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="منبع عدد، تاریخ تولید/موجودی و نکته‌های لازم برای بررسی"/></label><div className="modal-actions"><Button variant="soft" onClick={()=>setOpen(false)} disabled={busy}>انصراف</Button><Button type="submit" disabled={busy||!products.length||!evidenceFile}>{busy?'در حال بارگذاری مدرک…':'ثبت برای بررسی مدیر'}</Button></div></form>{!products.length&&<p className="helper-note">برای ثبت ظرفیت ابتدا باید محصول فعال برای مجموعه تعریف شود.</p>}</Modal>}</>;
}

function SupplierSettlementPage({membership,search}:{membership:Membership;search:string}) {const {rows,loading,error,refresh}=useDbRows('settlements',membership,{order:'created_at'});const shown=rows.filter(r=>(!membership.supplier_id||r.supplier_id===membership.supplier_id)&&(!search||`${r.invoice_ref??''} ${r.status}`.toLowerCase().includes(search.toLowerCase())));return <><PageHeading eyebrow="SUPPLIER / SETTLEMENT" title="تسویه‌های من" description="مبالغ و وضعیت تسویه را بر اساس رکوردهای داخلی ببین؛ وضعیت «پرداخت‌شده» باید پس از تطبیق واقعی ثبت شود." action={<Button variant="soft" onClick={()=>void refresh()}>تازه‌سازی</Button>}/>{error&&<InlineError error={error} retry={()=>void refresh()}/>}<section className="panel entity-panel">{loading?<div className="panel-loading"><span className="spinner small"/></div>:shown.length?<DataTable rows={shown} columns={[{key:'invoice_ref',label:'مرجع سند'},{key:'amount',label:'مبلغ',render:r=>moneyFa(String(r.amount))},{key:'due_date',label:'سررسید'},{key:'status',label:'وضعیت',render:r=><Badge value={r.status}/>},{key:'note',label:'یادداشت'}]}/>:<EmptyState title="تسویه‌ای برای نمایش وجود ندارد" description="سوابق تسویه پس از ثبت توسط تیم مالی مجموعه اینجا قرار می‌گیرند." icon={CreditCard}/>}</section></>}

// Legacy screens stay in source for now, but the supply-chain release intentionally does not route to them.
// Keep their imports/components referenced until their data migrations and old clients are retired.
void [ContactImporter, ContactsHub, OperationalExceptionInbox, ProductsPage, OrdersPage, PurchaseOrdersPage, GoalsPage, FinancePage, CustomerCatalog, CustomerOrders, CustomerAccount];

function WorkspaceGate() {
  const { user, loading, membershipsLoading } = useAuth();
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setResolvedUserId(null);
      return;
    }
    if (!membershipsLoading) setResolvedUserId(user.id);
  }, [user?.id, membershipsLoading]);

  // Public showcase builds must never expose the live workspace, including when an
  // old browser session exists. Enabling auth UI is explicit and restores the guarded app.
  const authUiEnabled = import.meta.env.VITE_ENABLE_AUTH_UI === 'true';
  if (!authUiEnabled) return <Navigate to="/demo" replace/>;
  if (!user && loading) return <LoadingScreen label="در حال بررسی نشست امن…"/>;
  if (user && resolvedUserId !== user.id) return <LoadingScreen label="در حال بررسی سطح دسترسی…"/>;
  return user ? <AppShell/> : null;
}

export default function App() {
  const authUiEnabled = import.meta.env.VITE_ENABLE_AUTH_UI === 'true';
  if (!isApiConfigured) return <ConfigScreen/>;
  const home = authUiEnabled ? <Navigate to="/app/command" replace/> : <DemoWorkspace/>;
  const protectedFallback = authUiEnabled ? <Navigate to="/app/command" replace/> : <Navigate to="/demo" replace/>;
  return <Routes>
    <Route path="/" element={home}/>
    <Route path="/demo" element={<DemoWorkspace/>}/>
    <Route path="/about" element={protectedFallback}/>
    <Route path="/auth" element={protectedFallback}/>
    <Route path="/app/*" element={<WorkspaceGate/>}/>
    <Route path="*" element={protectedFallback}/>
  </Routes>;
}
