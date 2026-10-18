import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowLeft, Building2, CalendarClock, CheckCircle2, ClipboardCheck,
  CreditCard, Factory, FileText, LayoutDashboard, MapPin, Package, ShieldCheck,
  Truck, Warehouse,
} from 'lucide-react';
import type { AppRole, Membership, Row } from './lib/types';
import { dataApi } from './lib/dataClient';
import { InAppNotifications } from './InAppNotifications';
import { dateFa, dateTimeFa, moneyFa, numberFa, roleLabel, statusLabel } from './lib/format';

type QuickLink = { key: string; title: string; detail: string; icon: typeof LayoutDashboard };
type BriefingItem = { id: string; title: string; detail: string; to: string; tone?: 'warning' | 'critical' | 'info' };
type Metric = { label: string; value: number; detail: string; icon: typeof LayoutDashboard; to: string };

const roleQuickLinks: Record<AppRole, QuickLink[]> = {
  owner: [
    { key: 'command', title: 'نمای کلی کسب‌وکار', detail: 'اولویت‌ها و موارد نیازمند اقدام', icon: LayoutDashboard },
    { key: 'orders', title: 'سفارش‌ها', detail: 'جریان سفارش تا تحویل', icon: FileText },
    { key: 'operational-tasks', title: 'کارها و پیگیری', detail: 'وظایف، سررسیدها و رخدادها', icon: ClipboardCheck },
    { key: 'finance', title: 'مالی و تسویه', detail: 'فاکتور و مغایرت‌گیری', icon: CreditCard },
  ],
  admin: [
    { key: 'command', title: 'نمای کلی کسب‌وکار', detail: 'اولویت‌ها و موارد نیازمند اقدام', icon: LayoutDashboard },
    { key: 'orders', title: 'سفارش‌ها', detail: 'جریان سفارش تا تحویل', icon: FileText },
    { key: 'operational-tasks', title: 'کارها و پیگیری', detail: 'وظایف، سررسیدها و رخدادها', icon: ClipboardCheck },
    { key: 'finance', title: 'مالی و تسویه', detail: 'فاکتور و مغایرت‌گیری', icon: CreditCard },
  ],
  staff: [
    { key: 'command', title: 'نمای کلی عملیات', detail: 'کارهای باز و هشدارها', icon: LayoutDashboard },
    { key: 'operational-tasks', title: 'وظایف عملیاتی', detail: 'کارهای در جریان', icon: ClipboardCheck },
    { key: 'shipments', title: 'ارسال و تحویل', detail: 'محموله‌های فعال', icon: Truck },
    { key: 'inventory', title: 'موجودی و انبار', detail: 'گردش کالا', icon: Warehouse },
  ],
  supplier: [
    { key: 'operational-tasks', title: 'کارهای واگذارشده', detail: 'وظیفه و سررسید', icon: ClipboardCheck },
    { key: 'daily-production', title: 'ثبت روزانه', detail: 'ثبت واقعی تولید و عملیات', icon: Factory },
    { key: 'supplier-capacity', title: 'ظرفیت من', detail: 'اعلام و تأیید ظرفیت', icon: Warehouse },
    { key: 'supplier-settlement', title: 'تسویه‌های من', detail: 'وضعیت مالی ثبت‌شده', icon: CreditCard },
    { key: 'farm-sites', title: 'سایت‌های مزرعه', detail: 'مشخصات موقعیت‌های مجاز', icon: MapPin },
  ],
  driver: [
    { key: 'driver-work', title: 'محموله‌های من', detail: 'تحویل، وضعیت و مدارک', icon: Truck },
  ],
  customer: [
    { key: 'catalog', title: 'کاتالوگ خرید', detail: 'محصولات فعال', icon: Package },
    { key: 'my-orders', title: 'سفارش‌های من', detail: 'وضعیت و موعد تحویل', icon: FileText },
    { key: 'my-account', title: 'حساب سازمانی', detail: 'مشخصات و شرایط حساب', icon: Building2 },
  ],
};

export function WorkspaceHome({ membership, userName }: { membership: Membership; userName: string }) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [items, setItems] = useState<BriefingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const role = membership.role;
  const links = roleQuickLinks[role].slice(0, 4);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const companyId = membership.company_id;
      const today = new Date().toISOString().slice(0, 10);
      let nextMetrics: Metric[] = [];
      const nextItems: BriefingItem[] = [];

      if (role === 'owner' || role === 'admin' || role === 'staff') {
        const [tasks, overdueOrders, incidents] = await Promise.all([
          dataApi.from('operational_tasks').select('id,title,status,priority,due_at', { count: 'exact' }).eq('company_id', companyId).not('status', 'in', '(approved,cancelled)').order('due_at', { ascending: true }).limit(8),
          dataApi.from('orders').select('id,reference,status,requested_delivery', { count: 'exact' }).eq('company_id', companyId).lt('requested_delivery', today).not('status', 'in', '(delivered,cancelled)').order('requested_delivery', { ascending: true }).limit(8),
          dataApi.from('operational_incidents').select('id,title,severity,status', { count: 'exact' }).eq('company_id', companyId).not('status', 'in', '(resolved,closed,cancelled)').order('created_at', { ascending: false }).limit(8),
        ]);
        const failure = tasks.error ?? overdueOrders.error ?? incidents.error;
        if (failure) throw new Error(failure.message);
        const taskRows = (tasks.data ?? []) as Row[];
        const lateRows = (overdueOrders.data ?? []) as Row[];
        const incidentRows = (incidents.data ?? []) as Row[];
        nextMetrics = [
          { label: 'وظایف باز', value: tasks.count ?? taskRows.length, detail: 'برای پیگیری و تکمیل', icon: ClipboardCheck, to: '/app/operational-tasks' },
          { label: 'سفارش‌های عقب‌افتاده', value: overdueOrders.count ?? lateRows.length, detail: 'موعد تحویل گذشته', icon: Truck, to: '/app/orders' },
          { label: 'رخدادهای باز', value: incidents.count ?? incidentRows.length, detail: 'نیازمند بررسی', icon: Activity, to: '/app/incidents' },
        ];
        taskRows.slice(0, 4).forEach(row => nextItems.push({
          id: 'task-' + String(row.id),
          title: String(row.title ?? 'وظیفه بدون عنوان'),
          detail: (statusLabel[String(row.priority)] ?? String(row.priority ?? 'اولویت ثبت‌نشده')) + ' · ' + (row.due_at ? 'سررسید ' + dateTimeFa(String(row.due_at)) : 'بدون سررسید'),
          to: '/app/operational-tasks',
          tone: row.due_at && new Date(String(row.due_at)).getTime() < Date.now() ? 'warning' : 'info',
        }));
        lateRows.slice(0, 3).forEach(row => nextItems.push({
          id: 'order-' + String(row.id),
          title: 'سفارش ' + String(row.reference ?? String(row.id).slice(0, 8)) + ' از موعد گذشته',
          detail: 'موعد تحویل: ' + dateFa(String(row.requested_delivery ?? '')),
          to: '/app/orders',
          tone: 'critical',
        }));
        incidentRows.slice(0, 2).forEach(row => nextItems.push({
          id: 'incident-' + String(row.id),
          title: String(row.title ?? 'رخداد نیازمند بررسی'),
          detail: 'شدت: ' + String(row.severity ?? 'ثبت‌نشده'),
          to: '/app/incidents',
          tone: 'warning',
        }));
      } else if (role === 'supplier') {
        if (!membership.supplier_id) {
          nextItems.push({ id: 'supplier-link', title: 'حساب تأمین‌کننده به عضویت متصل نیست', detail: 'از مالک یا مدیر بخواه عضویت را به پرونده تأمین‌کننده صحیح متصل کند.', to: '/app/my-account', tone: 'warning' });
          nextMetrics = [{ label: 'وضعیت حساب', value: 0, detail: 'نیازمند اتصال پرونده تأمین‌کننده', icon: ShieldCheck, to: '/app/operational-tasks' }];
        } else {
          const [tasks, capacity] = await Promise.all([
            dataApi.from('operational_tasks').select('id,title,status,priority,due_at', { count: 'exact' }).eq('company_id', companyId).eq('assignee_supplier_id', membership.supplier_id).not('status', 'in', '(approved,cancelled)').order('due_at', { ascending: true }).limit(8),
            dataApi.from('capacity_commitments').select('id,status,period_end,declared_qty,confirmed_qty', { count: 'exact' }).eq('company_id', companyId).eq('supplier_id', membership.supplier_id).eq('status', 'declared').order('period_end', { ascending: true }).limit(4),
          ]);
          const failure = tasks.error ?? capacity.error;
          if (failure) throw new Error(failure.message);
          const taskRows = (tasks.data ?? []) as Row[];
          const capacityRows = (capacity.data ?? []) as Row[];
          nextMetrics = [
            { label: 'کارهای واگذارشده', value: tasks.count ?? taskRows.length, detail: 'برای انجام یا ارسال مدرک', icon: ClipboardCheck, to: '/app/operational-tasks' },
            { label: 'ظرفیت در انتظار بررسی', value: capacity.count ?? capacityRows.length, detail: 'اعلام‌شده توسط شما', icon: Warehouse, to: '/app/supplier-capacity' },
          ];
          taskRows.slice(0, 6).forEach(row => nextItems.push({
            id: 'supplier-task-' + String(row.id),
            title: String(row.title ?? 'وظیفه بدون عنوان'),
            detail: String(statusLabel[String(row.status)] ?? row.status ?? 'ثبت‌نشده') + ' · ' + (row.due_at ? dateTimeFa(String(row.due_at)) : 'بدون سررسید'),
            to: '/app/operational-tasks',
            tone: row.due_at && new Date(String(row.due_at)).getTime() < Date.now() ? 'warning' : 'info',
          }));
        }
      } else if (role === 'driver') {
        const [shipments, tasks] = await Promise.all([
          dataApi.from('shipments').select('id,order_id,stage,planned_departure,delivered_at,vehicle', { count: 'exact' }).eq('company_id', companyId).eq('driver_user_id', membership.user_id).not('stage', 'in', '(delivered,returned,failed)').order('planned_departure', { ascending: true }).limit(8),
          dataApi.from('operational_tasks').select('id,title,status,priority,due_at', { count: 'exact' }).eq('company_id', companyId).eq('assignee_user_id', membership.user_id).not('status', 'in', '(approved,cancelled)').order('due_at', { ascending: true }).limit(6),
        ]);
        const failure = shipments.error ?? tasks.error;
        if (failure) throw new Error(failure.message);
        const shipmentRows = (shipments.data ?? []) as Row[];
        const taskRows = (tasks.data ?? []) as Row[];
        nextMetrics = [
          { label: 'محموله‌های فعال', value: shipments.count ?? shipmentRows.length, detail: 'اختصاص‌یافته به شما', icon: Truck, to: '/app/driver-work' },
          { label: 'کارهای باز', value: tasks.count ?? taskRows.length, detail: 'برای تکمیل امروز', icon: ClipboardCheck, to: '/app/driver-work' },
        ];
        shipmentRows.slice(0, 6).forEach(row => nextItems.push({
          id: 'shipment-' + String(row.id),
          title: 'محموله ' + String(row.id).slice(0, 8).toUpperCase(),
          detail: 'مرحله: ' + String(statusLabel[String(row.stage)] ?? row.stage ?? 'ثبت‌نشده') + (row.planned_departure ? ' · حرکت: ' + dateTimeFa(String(row.planned_departure)) : ''),
          to: '/app/driver-work',
          tone: 'info',
        }));
      } else {
        const [orders, invoices] = await Promise.all([
          dataApi.from('orders').select('id,reference,status,requested_delivery,created_at', { count: 'exact' }).eq('company_id', companyId).eq('customer_id', membership.customer_id ?? '').not('status', 'in', '(delivered,cancelled)').order('created_at', { ascending: false }).limit(6),
          dataApi.from('invoices').select('id,reference,status,amount,due_date', { count: 'exact' }).eq('company_id', companyId).eq('customer_id', membership.customer_id ?? '').not('status', 'in', '(paid,cancelled)').order('due_date', { ascending: true }).limit(4),
        ]);
        const failure = orders.error ?? invoices.error;
        if (failure) throw new Error(failure.message);
        const orderRows = (orders.data ?? []) as Row[];
        const invoiceRows = (invoices.data ?? []) as Row[];
        nextMetrics = [
          { label: 'سفارش‌های در جریان', value: orders.count ?? orderRows.length, detail: 'سفارش‌های فعال حساب شما', icon: Package, to: '/app/my-orders' },
          { label: 'فاکتورهای تسویه‌نشده', value: invoices.count ?? invoiceRows.length, detail: 'برای بررسی مالی', icon: CreditCard, to: '/app/my-orders' },
        ];
        orderRows.slice(0, 5).forEach(row => nextItems.push({
          id: 'customer-order-' + String(row.id),
          title: 'سفارش ' + String(row.reference ?? String(row.id).slice(0, 8)),
          detail: (statusLabel[String(row.status)] ?? String(row.status ?? 'ثبت‌نشده')) + (row.requested_delivery ? ' · تحویل درخواستی ' + dateFa(String(row.requested_delivery)) : ''),
          to: '/app/my-orders',
          tone: 'info',
        }));
        invoiceRows.filter(row => row.due_date && String(row.due_date) < today).forEach(row => nextItems.push({
          id: 'customer-invoice-' + String(row.id),
          title: 'فاکتور سررسیدگذشته ' + String(row.reference ?? ''),
          detail: moneyFa(String(row.amount ?? 0)) + ' · سررسید ' + dateFa(String(row.due_date)),
          to: '/app/my-orders',
          tone: 'warning',
        }));
      }
      const urgency: Record<NonNullable<BriefingItem['tone']>, number> = { critical: 0, warning: 1, info: 2 };
      nextItems.sort((a, b) => urgency[a.tone ?? 'info'] - urgency[b.tone ?? 'info']);
      setMetrics(nextMetrics.slice(0, 3));
      setItems(nextItems);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'خلاصه‌ی امروز دریافت نشد.');
      setMetrics([]);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [membership.company_id, membership.customer_id, membership.role, membership.supplier_id, membership.user_id, role]);

  useEffect(() => { void load(); }, [load]);

  const roleHeading: Record<AppRole, { title: string; description: string }> = {
    owner: { title: 'کنترل امروز کسب‌وکار', description: 'کارهای مهم، سفارش‌های عقب‌افتاده و رخدادهای ثبت‌شده را یک‌جا ببین.' },
    admin: { title: 'برنامه‌ی امروز مجموعه', description: 'اولویت‌های عملیاتی و موارد نیازمند رسیدگی را از داده‌های واقعی پیگیری کن.' },
    staff: { title: 'کارهای امروز شما', description: 'وظایف باز و مواردی که برای تکمیل عملیات نیاز به اقدام دارند.' },
    supplier: { title: 'برنامه‌ی امروز تأمین‌کننده', description: 'کارهای واگذارشده و ظرفیت‌هایی که هنوز نیازمند پیگیری‌اند.' },
    driver: { title: 'برنامه‌ی امروز راننده', description: 'محموله‌های فعال و کارهای ثبت‌شده برای شما.' },
    customer: { title: 'وضعیت سفارش‌های سازمان شما', description: 'سفارش‌های در جریان و فاکتورهای باز حساب سازمانی.' },
  };
  const heading = roleHeading[role];

  return <div className="workspace-home" dir="rtl">
    <section className="workspace-home-hero">
      <div className="workspace-home-identity"><span className="workspace-home-mark"><LayoutDashboard size={22}/></span><div><span className="workspace-home-eyebrow">فضای کاری اختصاصی شما</span><h1>سلام {userName || 'همکار مدار'}</h1><p>{heading.title} · <b>{roleLabel[role]}</b></p></div></div>
      <p className="workspace-home-description">{heading.description}</p>
      <div className="workspace-home-meta"><span><ShieldCheck size={15}/> دسترسی بر پایه‌ی نقش تأییدشده</span><span><CalendarClock size={15}/> خلاصه‌ی به‌روزشونده از رکوردهای سیستم</span></div>
    </section>

    <InAppNotifications membership={membership}/>

    <section className="workspace-home-section">
      <div className="workspace-home-section-heading"><div><span className="workspace-home-eyebrow">نگاه سریع</span><h2>بخش‌های پرکاربرد شما</h2></div><small>{links.length.toLocaleString('fa-IR')} میان‌بر</small></div>
      <div className="workspace-home-links">{links.map(link => { const Icon = link.icon; return <Link to={'/app/' + link.key} className="workspace-home-link" key={link.key}><span className="workspace-home-link-icon"><Icon size={20}/></span><span><b>{link.title}</b><small>{link.detail}</small></span><ArrowLeft size={16} className="workspace-home-link-arrow"/></Link>; })}</div>
    </section>

    <section className="workspace-home-section workspace-home-today">
      <div className="workspace-home-section-heading"><div><span className="workspace-home-eyebrow">مرکز پیگیری</span><h2>موارد مهم و اقدام بعدی</h2><p>ابتدا موارد پرریسک و نزدیک به سررسید را بررسی کن. فقط مواردی نمایش داده می‌شود که در پایگاه داده ثبت شده‌اند؛ موقعیت GPS یا اعلان خارجی بدون اتصال واقعی ساخته نمی‌شود.</p></div><button type="button" className="workspace-home-refresh" onClick={() => void load()} disabled={loading}><Activity size={15}/>{loading ? 'در حال دریافت' : 'به‌روزرسانی'}</button></div>
      {error && <div className="workspace-home-error" role="alert">{error}<button type="button" onClick={() => void load()}>تلاش دوباره</button></div>}
      {loading ? <div className="workspace-home-loading"><span className="spinner small"/><span>در حال گردآوری وضعیت فضای کاری…</span></div> : <>
        <div className="workspace-home-metrics">{metrics.map(metric => { const Icon = metric.icon; return <Link to={metric.to} className="workspace-home-metric" key={metric.label}><span className="workspace-home-metric-icon"><Icon size={19}/></span><span><small>{metric.label}</small><b>{numberFa(metric.value)}</b><em>{metric.detail}</em></span><ArrowLeft size={14}/></Link>; })}</div>
        {items.length ? <div className="workspace-home-action-list">{items.slice(0, 8).map(item => <Link to={item.to} key={item.id} className={'workspace-home-action ' + (item.tone ?? 'info')}><span className="workspace-home-action-dot">{item.tone === 'critical' ? '!' : item.tone === 'warning' ? '•' : <CheckCircle2 size={15}/>}</span><span><b>{item.title}</b><small>{item.detail}</small></span><ArrowLeft size={15}/></Link>)}</div> : <div className="workspace-home-empty"><CheckCircle2 size={22}/><div><b>مورد ثبت‌شده‌ای برای نمایش پیدا نشد</b><p>با ثبت وظیفه، سفارش، محموله یا پیگیری جدید، این صفحه به خلاصه‌ی روزانه‌ی شما تبدیل می‌شود.</p></div></div>}
      </>}
    </section>
  </div>;
}
