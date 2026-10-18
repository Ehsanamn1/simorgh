import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowUpLeft, CheckCircle2, Clock3, Package, RefreshCw, ShieldCheck, Truck, WalletCards } from 'lucide-react';
import type { Membership } from './lib/types';
import { dataApi } from './lib/dataClient';

type Role = 'manager' | 'supplier' | 'driver';
type RecordRow = Record<string, unknown>;
type Props = { role: Role; membership: Membership; children: ReactNode };
type Metric = { label: string; value: number; note: string; tone: 'neutral' | 'warning' | 'positive'; icon: typeof Activity };
const asText = (value: unknown) => typeof value === 'string' ? value : '';
const isIn = (value: unknown, values: string[]) => values.includes(asText(value));
const faNumber = (value: number) => new Intl.NumberFormat('fa-IR').format(value);
const dayLabel = () => new Intl.DateTimeFormat('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

export function OperationsRoleExperience({ role, membership, children }: Props) {
  const [rows, setRows] = useState<Record<string, RecordRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const companyId = membership.company_id;

  const load = async (quiet = false) => {
    if (!dataApi || !companyId) {
      setLoading(false);
      setError('اتصال امن داده‌های مدار در دسترس نیست.');
      return;
    }
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      let result: Array<{ key: string; response: { data: unknown[] | null; error: { message: string } | null } }>;
      if (role === 'manager') {
        const responses = await Promise.all([
          dataApi.from('orders').select('id,status,requested_delivery').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500),
          dataApi.from('shipments').select('id,stage,driver_user_id').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500),
          dataApi.from('operational_tasks').select('id,status,assignee_user_id,assignee_supplier_id').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500),
          dataApi.from('operational_incidents').select('id,status').eq('company_id', companyId).order('created_at', { ascending: false }).limit(300),
          dataApi.from('partner_financial_entries').select('id,status,entry_type,payment_status').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500),
        ]);
        result = responses.map((response, i) => ({ key: ['orders', 'shipments', 'tasks', 'incidents', 'finance'][i], response }));
      } else if (role === 'supplier') {
        if (!membership.supplier_id) {
          setRows({});
          setLoading(false);
          setRefreshing(false);
          setError('این حساب هنوز به یک تأمین‌کننده فعال متصل نشده است. از مدیر مجموعه بخواه اتصال حساب را بررسی کند.');
          return;
        }
        const responses = await Promise.all([
          dataApi.from('order_items').select('id,quantity,orders(id,reference,status,requested_delivery),products(name,unit)').eq('company_id', companyId).eq('supplier_id', membership.supplier_id).order('created_at', { ascending: false }).limit(300),
          dataApi.from('capacity_commitments').select('id,status,declared_qty,period_start,period_end,products(name,unit)').eq('company_id', companyId).eq('supplier_id', membership.supplier_id).order('created_at', { ascending: false }).limit(200),
          dataApi.from('partner_financial_entries').select('id,status,entry_type,payment_status').eq('company_id', companyId).eq('supplier_id', membership.supplier_id).order('created_at', { ascending: false }).limit(300),
        ]);
        result = responses.map((response, i) => ({ key: ['orders', 'capacity', 'finance'][i], response }));
      } else {
        const responses = await Promise.all([
          dataApi.from('shipments').select('id,stage,planned_departure,orders(id,reference,delivery_address,requested_delivery)').eq('company_id', companyId).eq('driver_user_id', membership.user_id).order('created_at', { ascending: false }).limit(300),
        ]);
        result = responses.map((response, i) => ({ key: ['shipments'][i], response }));
      }
      const failure = result.find(item => item.response.error);
      if (failure) setError(failure.response.error?.message ?? 'بخشی از اطلاعات بارگذاری نشد.');
      const next: Record<string, RecordRow[]> = {};
      for (const item of result) next[item.key] = (item.response.data ?? []) as RecordRow[];
      setRows(next);
    } catch {
      setError('به‌روزرسانی وضعیت ناموفق بود. اتصال را بررسی و دوباره تلاش کن.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(); }, [companyId, membership.supplier_id, membership.user_id, role]);

  const metrics = useMemo<Metric[]>(() => {
    const orders = rows.orders ?? [];
    const shipments = rows.shipments ?? [];
    const tasks = rows.tasks ?? [];
    const incidents = rows.incidents ?? [];
    const finance = rows.finance ?? [];
    const capacity = rows.capacity ?? [];
    if (role === 'manager') return [
      { label: 'سفارش‌های باز', value: orders.filter(row => !isIn(row.status, ['delivered', 'cancelled', 'completed'])).length, note: 'از ثبت تا تحویل', tone: 'neutral', icon: Package },
      { label: 'ارسال‌های فعال', value: shipments.filter(row => !isIn(row.stage, ['delivered', 'returned', 'failed', 'cancelled'])).length, note: 'در مسیر یا آماده ارسال', tone: 'neutral', icon: Truck },
      { label: 'کارهای نیازمند اقدام', value: tasks.filter(row => !isIn(row.status, ['approved', 'cancelled', 'completed'])).length, note: 'کارهای باز و در انتظار بررسی', tone: tasks.some(row => isIn(row.status, ['blocked', 'rejected'])) ? 'warning' : 'neutral', icon: Clock3 },
      { label: 'رخدادهای باز', value: incidents.filter(row => !isIn(row.status, ['resolved', 'closed', 'cancelled'])).length, note: 'مواردی که باید پیگیری شوند', tone: incidents.some(row => isIn(row.status, ['open', 'action_required'])) ? 'warning' : 'positive', icon: AlertTriangle },
    ];
    if (role === 'supplier') return [
      { label: 'اقلام سفارش', value: orders.filter(row => !isIn((row.orders as RecordRow | null)?.status, ['delivered', 'cancelled', 'completed'])).length, note: 'سفارش‌های فعال مجموعه شما', tone: 'neutral', icon: Package },
      { label: 'ظرفیت اعلام‌شده', value: capacity.filter(row => isIn(row.status, ['declared', 'approved'])).length, note: 'ظرفیت‌های ثبت‌شده', tone: 'neutral', icon: Activity },
      { label: 'سند در انتظار رسیدگی', value: finance.filter(row => isIn(row.status, ['draft', 'submitted', 'approved']) || isIn(row.payment_status, ['unpaid', 'partial'])).length, note: 'وضعیت اسناد مالی شما', tone: 'warning', icon: WalletCards },
      { label: 'نیازمند پاسخ', value: orders.filter(row => isIn((row.orders as RecordRow | null)?.status, ['pending', 'awaiting_supplier', 'submitted'])).length, note: 'سفارش‌هایی که ممکن است پاسخ بخواهند', tone: 'neutral', icon: Clock3 },
    ];
    return [
      { label: 'مأموریت فعال', value: shipments.filter(row => !isIn(row.stage, ['delivered', 'returned', 'failed', 'cancelled'])).length, note: 'محموله‌های تخصیص‌یافته به شما', tone: 'neutral', icon: Truck },
      { label: 'تحویل انجام‌شده', value: shipments.filter(row => isIn(row.stage, ['delivered'])).length, note: 'سوابق تحویل ثبت‌شده', tone: 'positive', icon: CheckCircle2 },
      { label: 'در انتظار اقدام', value: shipments.filter(row => isIn(row.stage, ['planned', 'assigned', 'ready', 'loaded'])).length, note: 'مأموریت‌هایی که هنوز تحویل نشده‌اند', tone: 'warning', icon: Clock3 },
    ];
  }, [rows, role]);

  const title = role === 'manager' ? 'نمای عملیاتی مجموعه' : role === 'supplier' ? 'میز کار تأمین‌کننده' : 'مرکز مأموریت‌های راننده';
  const subtitle = role === 'manager'
    ? 'از یک نگاه ببین چه چیزی جلو می‌رود، چه چیزی متوقف شده و کجا به تصمیم تو نیاز است.'
    : role === 'supplier'
      ? 'سفارش‌ها، ظرفیت و وضعیت مالی خودت را یک‌جا ببین؛ اطلاعات دیگران در این فضا نمایش داده نمی‌شود.'
      : 'مأموریت‌های تخصیص‌یافته، وضعیت تحویل و موارد نیازمند پیگیری در یک نمای روشن و حرفه‌ای.';
  const actions = role === 'manager'
    ? [{ label: 'سفارش‌ها', to: '/app/orders' }, { label: 'ارسال و رانندگان', to: '/app/shipments' }, { label: 'رخدادها', to: '/app/exceptions' }, { label: 'مالی و تسویه', to: '/app/partner-settlements' }]
    : role === 'supplier'
      ? [{ label: 'سفارش‌های من', to: '/app/supplier-work' }, { label: 'ظرفیت تأمین', to: '/app/supplier-capacity' }, { label: 'تسویه من', to: '/app/supplier-settlement' }]
      : [{ label: 'مأموریت‌ها', to: '/app/driver-work' }, { label: 'ارسال مشکل', to: '/app/exceptions' }];

  return <section className={'role-ops role-ops-' + role} aria-label={title}>
    <div className="role-ops-hero">
      <div className="role-ops-hero-copy">
        <span className="role-ops-kicker"><ShieldCheck size={14}/> مدار · عملیات متصل</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        <div className="role-ops-date"><span className="role-ops-live-dot"/>{dayLabel()} <span>·</span> داده‌های فضای کاری شما</div>
      </div>
      <div className="role-ops-hero-actions">
        <button className="role-ops-refresh" type="button" onClick={() => void load(true)} disabled={loading || refreshing}><RefreshCw size={16} className={refreshing ? 'role-ops-spinning' : ''}/>{refreshing ? 'در حال به‌روزرسانی' : 'به‌روزرسانی'}</button>
        {role === 'manager' && <Link className="role-ops-primary" to="/app/exceptions">مشاهده موارد نیازمند اقدام <ArrowUpLeft size={16}/></Link>}
      </div>
    </div>
    {error && <div className="role-ops-error" role="status"><AlertTriangle size={16}/><span>{error}</span></div>}
    <div className={'role-ops-metrics role-ops-metrics-' + role}>
      {metrics.map((metric) => <article className={'role-ops-metric role-ops-tone-' + metric.tone} key={metric.label}>
        <div className="role-ops-metric-top"><span>{metric.label}</span><metric.icon size={18}/></div>
        <strong>{loading ? '—' : faNumber(metric.value)}</strong>
        <small>{metric.note}</small>
      </article>)}
    </div>
    <div className="role-ops-shortcuts" aria-label="دسترسی سریع">
      <div className="role-ops-shortcuts-heading"><div><span>مسیرهای پرکاربرد</span><small>برای کارهای روزمره</small></div><span className="role-ops-shortcuts-mark"><Activity size={16}/></span></div>
      <div className="role-ops-shortcuts-list">
        {actions.map(action => <Link key={action.to} to={action.to} className="role-ops-shortcut"><span>{action.label}</span><ArrowUpLeft size={16}/></Link>)}
      </div>
    </div>
    {role === 'manager' && <div className="role-ops-note"><CheckCircle2 size={17}/><span><b>اصل کنترل:</b> وضعیت‌ها و ارقام باید از سوابق ثبت‌شده بیایند؛ تحویل، تأیید فاکتور و پرداخت سه رویداد جدا هستند.</span></div>}
    {role !== 'manager' && <div className="role-ops-note"><ShieldCheck size={17}/><span><b>فضای اختصاصی شما:</b> فقط کارها و سوابق مرتبط با حساب شما نمایش داده می‌شود. اگر چیزی اشتباه است، از مسیر «ارسال مشکل» پیگیری کن.</span></div>}
    <div className="role-ops-workspace">{children}</div>
  </section>;
}
