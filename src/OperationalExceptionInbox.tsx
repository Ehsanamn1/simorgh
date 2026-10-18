import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
import { api } from './lib/apiClient';
import type { Membership } from './lib/types';

type Person = { id: string; username: string; displayName: string; role: string };
type ExceptionCase = { id: string; title: string; details: string; severity: 'warning' | 'critical'; status: string; assignedUserId: string | null; assignedUsername: string | null; dueAt: string | null; createdAt: string; resolutionNote: string | null };
type OperationalEvent = { id: string; eventType: string; severity: string; title: string; body: string; occurredAt: string };

const statusNames: Record<string, string> = { open: 'باز', acknowledged: 'دریافت‌شده', in_progress: 'در حال رسیدگی', resolved: 'حل‌شده', closed: 'بسته' };
const roleNames: Record<string, string> = { owner: 'مالک', admin: 'مدیر', staff: 'کارمند', supplier: 'تأمین‌کننده', driver: 'راننده', customer: 'مشتری' };
function timeLabel(value?: string | null) { if (!value) return 'بدون مهلت'; const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeStyle:'short'}).format(date) : 'زمان نامشخص'; }

export function OperationalExceptionInbox({ membership }: { membership: Membership }) {
  const companyId = membership.company_id;
  const [cases, setCases] = useState<ExceptionCase[]>([]);
  const [events, setEvents] = useState<OperationalEvent[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [severity, setSeverity] = useState<'warning'|'critical'>('warning');
  const [assignedUserId, setAssignedUserId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [caseResult,eventResult] = await Promise.all([
        api.get<{exceptions:ExceptionCase[]}>('/api/operational/exceptions?companyId='+encodeURIComponent(companyId)),
        api.get<{events:OperationalEvent[]}>('/api/operational/events?companyId='+encodeURIComponent(companyId)),
      ]);
      setCases(caseResult.exceptions ?? []);
      setEvents(eventResult.events ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'صندوق مسائل عملیاتی دریافت نشد.');
    } finally { setLoading(false); }
  },[companyId]);

  useEffect(() => {
    void load();
    void api.get<{people:Person[]}>('/api/connect/people?companyId='+encodeURIComponent(companyId)).then(result=>setPeople(result.people ?? [])).catch(()=>setPeople([]));
  },[load,companyId]);

  async function createCase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    try {
      await api.post('/api/operational/exceptions',{
        companyId,title:title.trim(),details:details.trim(),severity,
        assignedUserId:assignedUserId || undefined,dueAt:dueAt ? new Date(dueAt).toISOString() : undefined,
      });
      setTitle('');setDetails('');setSeverity('warning');setAssignedUserId('');setDueAt('');
      setNotice('مسئله ثبت شد و در صندوق پیگیری قرار گرفت.');
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'ثبت مسئله ناموفق بود.'); }
  }

  async function updateCase(item: ExceptionCase, action: 'acknowledge'|'resolve') {
    setBusyId(item.id);setError('');setNotice('');
    try {
      if (action === 'acknowledge') {
        await api.post('/api/operational/exceptions/'+encodeURIComponent(item.id)+'/acknowledge',{companyId});
        setNotice('دریافت مسئله ثبت شد.');
      } else {
        const note = (resolutionNotes[item.id] ?? '').trim();
        await api.post('/api/operational/exceptions/'+encodeURIComponent(item.id)+'/resolve',{companyId,resolutionNote:note});
        setNotice('نتیجهٔ رسیدگی ثبت شد.');
      }
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'به‌روزرسانی مسئله ناموفق بود.'); }
    finally { setBusyId(''); }
  }

  return <section className="medar-exception-page" dir="rtl">
    <header className="medar-exception-heading"><span className="medar-exception-heading-icon"><ShieldAlert size={23}/></span><div><span className="medar-exception-eyebrow">OPERATIONAL CONTROL</span><h1>صندوق مسائل و استثناها</h1><p>مسائل مهم را با مسئول، مهلت، وضعیت و نتیجهٔ رسیدگی در یک جا پیگیری کن.</p></div><button type="button" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/> تازه‌سازی</button></header>
    {error && <div className="medar-exception-alert" role="alert">{error}</div>}
    {notice && <div className="medar-exception-notice" role="status">{notice}</div>}
    <div className="medar-exception-summary"><div><b>{cases.filter(item=>!['resolved','closed'].includes(item.status)).length.toLocaleString('fa-IR')}</b><span>مسئلهٔ باز</span></div><div><b>{cases.filter(item=>item.severity==='critical'&&!['resolved','closed'].includes(item.status)).length.toLocaleString('fa-IR')}</b><span>بحرانی</span></div><div><b>{cases.filter(item=>item.dueAt&&new Date(item.dueAt).getTime()<Date.now()&&!['resolved','closed'].includes(item.status)).length.toLocaleString('fa-IR')}</b><span>از مهلت گذشته</span></div></div>
    <div className="medar-exception-layout">
      <form className="medar-exception-create" onSubmit={createCase}>
        <h2><Plus size={17}/> ثبت مسئله</h2>
        <label>عنوان مسئله<input required minLength={2} maxLength={180} value={title} onChange={e=>setTitle(e.target.value)} placeholder="مثلاً تأخیر در تحویل سفارش"/></label>
        <label>شرح و زمینه<textarea maxLength={4000} rows={4} value={details} onChange={e=>setDetails(e.target.value)} placeholder="چه اتفاقی افتاده و چه چیزی باید بررسی شود؟"/></label>
        <label>شدت<select value={severity} onChange={e=>setSeverity(e.target.value as 'warning'|'critical')}><option value="warning">نیازمند پیگیری</option><option value="critical">بحرانی</option></select></label>
        <label>مسئول رسیدگی<select value={assignedUserId} onChange={e=>setAssignedUserId(e.target.value)}><option value="">هنوز تعیین نشده</option>{people.map(person=><option key={person.id} value={person.id}>{person.displayName||person.username} · {roleNames[person.role]||person.role}</option>)}</select></label>
        <label>مهلت رسیدگی<input type="datetime-local" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></label>
        <button type="submit" disabled={title.trim().length<2}><Plus size={15}/> ثبت و پیگیری</button>
      </form>
      <section className="medar-exception-list-panel"><div className="medar-exception-list-title"><h2><AlertTriangle size={18}/> موارد نیازمند اقدام</h2><span>{cases.length.toLocaleString('fa-IR')}</span></div>
        {loading ? <p className="medar-exception-empty">در حال دریافت اطلاعات…</p> : cases.length===0 ? <div className="medar-exception-empty"><CheckCircle2 size={25}/><b>مسئلهٔ بازی ثبت نشده است</b><span>با ثبت یک مسئله، مسئول و نتیجهٔ رسیدگی را در همین صفحه پیگیری می‌کنی.</span></div> :
          <div className="medar-exception-list">{cases.map(item=><article key={item.id} className={'medar-exception-card '+item.severity}><div className="medar-exception-card-heading"><div><span className={'medar-exception-severity '+item.severity}>{item.severity==='critical'?'بحرانی':'پیگیری'}</span><h3>{item.title}</h3></div><span className="medar-exception-status">{statusNames[item.status]||item.status}</span></div>{item.details&&<p>{item.details}</p>}<div className="medar-exception-meta"><span>مسئول: {item.assignedUsername||'تعیین نشده'}</span><span><Clock3 size={13}/>{timeLabel(item.dueAt)}</span></div>{item.resolutionNote&&<p className="medar-exception-resolution">نتیجه: {item.resolutionNote}</p>}{!['resolved','closed'].includes(item.status)&&<div className="medar-exception-actions">{item.status==='open'&&<button type="button" disabled={busyId===item.id} onClick={()=>void updateCase(item,'acknowledge')}>ثبت دریافت</button>}<input aria-label={'شرح نتیجه '+item.title} value={resolutionNotes[item.id]??''} onChange={e=>setResolutionNotes(prev=>({...prev,[item.id]:e.target.value}))} placeholder="نتیجهٔ رسیدگی برای بستن مسئله"/><button type="button" disabled={busyId===item.id||(resolutionNotes[item.id]??'').trim().length<3} onClick={()=>void updateCase(item,'resolve')}>{busyId===item.id?'در حال ثبت…':'حل و بستن'}</button></div>}</article>)}</div>}
      </section>
    </div>
    <section className="medar-exception-events"><div className="medar-exception-list-title"><h2>رویدادهای ثبت‌شده</h2><span>{events.length.toLocaleString('fa-IR')}</span></div>{events.length===0?<p className="medar-exception-empty">هنوز رویداد عملیاتی از مسیرهای ثبت‌شده دریافت نشده است.</p>:events.slice(0,12).map(event=><article key={event.id}><span className={'medar-exception-event-dot '+event.severity}/><div><b>{event.title}</b><p>{event.body||event.eventType}</p></div><time>{timeLabel(event.occurredAt)}</time></article>)}</section>
  </section>;
}
