import { useCallback, useEffect, useState } from 'react';
import { BellRing, Check, CheckCheck, Clock3, LoaderCircle, RefreshCw, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Membership } from './lib/types';
import { api } from './lib/apiClient';

type NotificationRow = { id: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string };
type Props = { membership: Membership };
function formattedDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'زمان ثبت نامشخص';
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function InAppNotifications({ membership }: Props) {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [leavingIds, setLeavingIds] = useState<string[]>([]);
  const [showRead, setShowRead] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await api.get<{ notifications: NotificationRow[]; summary: { unread: number } }>('/api/notifications?companyId=' + encodeURIComponent(membership.company_id));
      setItems(result.notifications ?? []);
      setUnreadCount(Number(result.summary?.unread ?? (result.notifications ?? []).filter(item => !item.readAt).length));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'اعلان‌های این حساب دریافت نشدند.');
    } finally { setLoading(false); }
  }, [membership.company_id]);
  useEffect(() => { void load(); }, [load]);

  async function markRead(item: NotificationRow) {
    if (item.readAt || busy || leavingIds.includes(item.id)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.post<{ notification: { readAt: string | null } }>('/api/notifications/' + encodeURIComponent(item.id) + '/read', { companyId: membership.company_id });
      setLeavingIds(current => [...current, item.id]);
      setUnreadCount(current => Math.max(0, current - 1));
      window.setTimeout(() => {
        setItems(current => current.map(row => row.id === item.id ? { ...row, readAt: result.notification?.readAt ?? new Date().toISOString() } : row));
        setLeavingIds(current => current.filter(id => id !== item.id));
      }, 320);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ثبت وضعیت اعلان ناموفق بود.');
    } finally { setBusy(false); }
  }

  async function markAllRead() {
    if (!unreadCount || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.post('/api/notifications/read-all', { companyId: membership.company_id });
      const readAt = new Date().toISOString();
      setItems(current => current.map(item => item.readAt ? item : { ...item, readAt }));
      setUnreadCount(0);
      setNotice('همهٔ اعلان‌ها خوانده‌شده شدند؛ موارد خوانده‌شده به بایگانی منتقل شدند.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'علامت‌گذاری همهٔ اعلان‌ها ناموفق بود.');
    } finally { setBusy(false); }
  }

  const unreadItems = items.filter(item => !item.readAt || leavingIds.includes(item.id)).slice(0, 8);
  const readItems = items.filter(item => Boolean(item.readAt) && !leavingIds.includes(item.id));
  return <section className="workspace-home-section in-app-notifications" dir="rtl">
    <div className="workspace-home-section-heading">
      <div><span className="workspace-home-eyebrow">صندوق پیام‌های عملیاتی</span><h2>اعلان‌های من {unreadCount > 0 && <span className="notification-unread-count">{unreadCount.toLocaleString('fa-IR')}</span>}</h2><p>اعلان‌های تازه در بالا می‌مانند؛ پس از خواندن، با حرکت نرم به بایگانی می‌روند.</p></div>
      <div className="notification-toolbar"><button type="button" className="workspace-home-refresh" onClick={() => void load()} disabled={loading || busy}>{loading ? <LoaderCircle size={14} className="ai-spin"/> : <RefreshCw size={14}/>} تازه‌سازی</button>{unreadCount > 0 && <button type="button" className="notification-mark-all" onClick={() => void markAllRead()} disabled={busy}>{busy ? <LoaderCircle size={14} className="ai-spin"/> : <CheckCheck size={14}/>} خواندن همه</button>}</div>
    </div>
    {error && <div className="notification-error" role="alert">{error}<button type="button" onClick={() => void load()}>تلاش دوباره</button></div>}
    {notice && <div className="notification-notice" role="status"><Check size={14}/>{notice}</div>}
    {loading ? <div className="notification-loading"><LoaderCircle size={19} className="ai-spin"/> در حال دریافت اعلان‌ها…</div>
      : unreadItems.length ? <div className="notification-list">{unreadItems.map(item => {
        const href = item.href?.startsWith('/app/') ? item.href : '/app/home';
        return <article key={item.id} className={'notification-item unread'+(leavingIds.includes(item.id)?' notification-exit':'')}>
          <span className="notification-item-icon"><BellRing size={16}/></span>
          <div className="notification-item-content"><Link to={href} className="notification-item-title" onClick={() => { if (!item.readAt) void markRead(item); }}>{item.title}</Link>{item.body && <p>{item.body}</p>}<small><Clock3 size={12}/>{formattedDate(item.createdAt)}</small></div>
          {!item.readAt && <button type="button" className="notification-mark-read" disabled={busy} onClick={() => void markRead(item)} aria-label={'خوانده‌شده: '+item.title} title="خواندن و انتقال به بایگانی"><Check size={15}/></button>}
        </article>;
      })}</div> : <div className="notification-empty"><Trophy size={22}/><b>{readItems.length ? 'صندوق ورودی مرتب است' : 'فعلاً اعلان عملیاتی جدیدی ندارید'}</b><span>{readItems.length ? 'اعلان‌های خوانده‌شده در بایگانی پایین قرار دارند.' : 'با ثبت وظیفه، تغییر وضعیت، ظرفیت یا محموله، اعلان واقعی در اینجا ظاهر می‌شود.'}</span></div>}
    {readItems.length > 0 && <div className="notification-archive"><button type="button" className="notification-archive-toggle" aria-expanded={showRead} onClick={() => setShowRead(value => !value)}><span><CheckCheck size={15}/> بایگانی خوانده‌شده‌ها <small>{readItems.length.toLocaleString('fa-IR')}</small></span><span>{showRead ? 'بستن' : 'نمایش'}</span></button>{showRead && <div className="notification-list notification-read-list">{readItems.slice(0, 12).map(item => <article key={item.id} className="notification-item read"><span className="notification-item-icon"><Check size={16}/></span><div className="notification-item-content"><Link to={item.href?.startsWith('/app/') ? item.href : '/app/home'} className="notification-item-title">{item.title}</Link>{item.body && <p>{item.body}</p>}<small><Clock3 size={12}/>{formattedDate(item.createdAt)}</small></div></article>)}</div>}</div>}
  </section>;
}
