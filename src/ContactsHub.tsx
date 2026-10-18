import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Building2, FileUp, Mail, MapPin, Phone, Plus, Search, ShieldCheck, Tag, Users, X } from 'lucide-react';
import type { Membership, Row } from './lib/types';
import { dataApi } from './lib/dataClient';
import { dateFa, numberFa } from './lib/format';

type ContactKind = 'customers' | 'suppliers';
type ContactForm = { name: string; organization: string; phone: string; email: string; city: string; address: string; notes: string; tags: string };
const emptyForm: ContactForm = { name: '', organization: '', phone: '', email: '', city: '', address: '', notes: '', tags: '' };

export function ContactsHub({ membership, search: globalSearch = '' }: { membership: Membership; search?: string }) {
  const [kind, setKind] = useState<ContactKind>('customers');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const canManage = membership.role === 'owner' || membership.role === 'admin';

  const load = useCallback(async () => {
    if (!dataApi) { setLoading(false); setError('اتصال پایگاه داده آماده نیست.'); return; }
    setLoading(true);
    setError('');
    const { data, error: resultError } = await dataApi.from(kind)
      .select('id,name,organization_name,phone,email,city,address,contact_notes,contact_tags,contact_source,active,created_at')
      .eq('company_id', membership.company_id)
      .order('created_at', { ascending: false })
      .limit(300);
    if (resultError) {
      setError(resultError.message);
      setRows([]);
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  }, [kind, membership.company_id]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = (query + ' ' + globalSearch).trim().toLocaleLowerCase('fa-IR');
    if (!term) return rows;
    return rows.filter(row => [
      row.name, row.organization_name, row.phone, row.email, row.city,
      row.address, row.contact_notes, Array.isArray(row.contact_tags) ? row.contact_tags.join(' ') : row.contact_tags,
    ].some(value => String(value ?? '').toLocaleLowerCase('fa-IR').includes(term)));
  }, [rows, query, globalSearch]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !form.name.trim()) return;
    setSaving(true);
    setError('');
    const tags = [...new Set(form.tags.split(/[,،]/).map(tag => tag.trim()).filter(Boolean))].slice(0, 20);
    const values = {
      company_id: membership.company_id,
      name: form.name.trim(),
      organization_name: form.organization.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim().toLowerCase() || null,
      city: form.city.trim() || null,
      address: form.address.trim() || null,
      contact_notes: form.notes.trim() || null,
      contact_tags: tags,
      contact_source: 'manual',
      active: true,
    };
    const { error: insertError } = await dataApi.from(kind).insert(values);
    if (insertError) {
      setError(insertError.message);
    } else {
      setForm(emptyForm);
      setFormOpen(false);
      await load();
    }
    setSaving(false);
  }

  if (!canManage) return <section className="panel contacts-access-denied" dir="rtl"><ShieldCheck size={25}/><h2>دفترچه مخاطبین در اختیار مالک و مدیر است</h2><p>برای دسترسی به اطلاعات تماس و واردسازی گروهی، از مالک یا مدیر مجموعه درخواست دسترسی مجاز کن.</p><Link to="/app/home">بازگشت به صفحه من <ArrowLeft size={15}/></Link></section>;

  return <div className="contacts-hub" dir="rtl">
    <header className="contacts-hub-hero">
      <div className="contacts-hub-hero-icon"><Users size={23}/></div>
      <div className="contacts-hub-hero-copy"><span className="contacts-hub-eyebrow">دفترچه‌ی ارتباطات مجموعه</span><h1>مخاطبین</h1><p>پرونده‌ی مشتریان و تأمین‌کنندگان را از یک جا مدیریت کن. هر رکورد به همین فضای کاری متصل است.</p></div>
      <span className="contacts-hub-secure"><ShieldCheck size={15}/> دسترسی مدیریتی</span>
    </header>

    <section className="contacts-hub-toolbar">
      <div className="contacts-hub-tabs" role="tablist" aria-label="نوع مخاطب">
        <button type="button" role="tab" aria-selected={kind === 'customers'} className={kind === 'customers' ? 'active' : ''} onClick={() => setKind('customers')}><Building2 size={17}/> مشتریان</button>
        <button type="button" role="tab" aria-selected={kind === 'suppliers'} className={kind === 'suppliers' ? 'active' : ''} onClick={() => setKind('suppliers')}><Users size={17}/> تأمین‌کنندگان</button>
      </div>
      <label className="contacts-hub-search"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="جست‌وجوی نام، شماره، شرکت…" aria-label="جست‌وجو در مخاطبین"/></label>
      <div className="contacts-hub-actions">
        <Link to="/app/contacts-import" className="contacts-hub-import"><FileUp size={16}/> واردسازی گروهی</Link>
        <button type="button" className="contacts-hub-add" onClick={() => { setFormOpen(open => !open); setError(''); }}><Plus size={17}/>{formOpen ? 'بستن فرم' : 'افزودن مخاطب'}</button>
      </div>
    </section>

    {formOpen && <section className="contacts-hub-form-panel">
      <div className="contacts-hub-form-heading"><div><h2>ثبت {kind === 'customers' ? 'مشتری جدید' : 'تأمین‌کننده جدید'}</h2><p>فقط اطلاعات واردشده ذخیره می‌شود؛ فیلدهای اختیاری را می‌توان بعداً کامل کرد.</p></div><button type="button" onClick={() => setFormOpen(false)} aria-label="بستن فرم"><X size={17}/></button></div>
      <form className="contacts-hub-form" onSubmit={event => void submit(event)}>
        <label>نام مخاطب <input autoFocus required maxLength={160} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder={kind === 'customers' ? 'نام مشتری یا سازمان' : 'نام تأمین‌کننده یا مزرعه'}/></label>
        <label>نام شرکت / سازمان <input maxLength={180} value={form.organization} onChange={event => setForm({ ...form, organization: event.target.value })} placeholder="نام سازمان (اختیاری)"/></label>
        <label>شماره تماس <input type="tel" maxLength={50} value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} dir="ltr" placeholder="شماره تماس"/></label>
        <label>ایمیل <input type="email" maxLength={254} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} dir="ltr" placeholder="name@example.com"/></label>
        <label>استان / شهر <input maxLength={120} value={form.city} onChange={event => setForm({ ...form, city: event.target.value })} placeholder="شهر"/></label>
        <label>نشانی <input maxLength={500} value={form.address} onChange={event => setForm({ ...form, address: event.target.value })} placeholder="نشانی (اختیاری)"/></label>
        <label className="contacts-hub-wide">برچسب‌ها <input maxLength={400} value={form.tags} onChange={event => setForm({ ...form, tags: event.target.value })} placeholder="مثلاً: عمده‌فروش، قرارداد فعال، پیگیری خرداد"/></label>
        <label className="contacts-hub-wide">یادداشت داخلی <textarea maxLength={3000} rows={2} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} placeholder="نکته‌های همکاری یا پیگیری بعدی"/></label>
        {error && <div className="contacts-hub-error" role="alert">{error}</div>}
        <div className="contacts-hub-form-actions"><button type="button" onClick={() => { setFormOpen(false); setForm(emptyForm); }}>انصراف</button><button type="submit" disabled={saving || !form.name.trim()}>{saving ? 'در حال ذخیره…' : 'ذخیره مخاطب'}</button></div>
      </form>
    </section>}

    {error && !formOpen && <div className="contacts-hub-error" role="alert">{error} <button type="button" onClick={() => void load()}>تلاش دوباره</button></div>}
    <section className="contacts-hub-list-panel">
      <div className="contacts-hub-list-heading"><div><h2>{kind === 'customers' ? 'فهرست مشتریان' : 'فهرست تأمین‌کنندگان'}</h2><p>فقط مخاطبین ثبت‌شده در مجموعه‌ی فعلی نمایش داده می‌شوند.</p></div><span>{numberFa(filtered.length)} رکورد</span></div>
      {loading ? <div className="contacts-hub-loading"><span className="spinner small"/>در حال دریافت مخاطبین…</div> : filtered.length ? <div className="contacts-hub-list">{filtered.map(row => {
        const tags = Array.isArray(row.contact_tags) ? row.contact_tags.map(String) : [];
        return <article className="contacts-hub-row" key={String(row.id)}>
          <span className="contacts-hub-avatar">{String(row.name ?? '?').slice(0, 1)}</span>
          <div className="contacts-hub-row-main"><b>{String(row.name ?? 'بدون نام')}</b><small>{String(row.organization_name ?? '') || 'نام سازمان ثبت نشده'}</small><div className="contacts-hub-row-meta">
            {row.phone && <span><Phone size={13}/><b dir="ltr">{String(row.phone)}</b></span>}
            {row.email && <span><Mail size={13}/><b dir="ltr">{String(row.email)}</b></span>}
            {row.city && <span><MapPin size={13}/>{String(row.city)}</span>}
          </div>
          {tags.length > 0 && <div className="contacts-hub-tags">{tags.slice(0, 6).map(tag => <span key={tag}><Tag size={11}/>{tag}</span>)}</div>}
          {row.contact_notes && <p className="contacts-hub-note">{String(row.contact_notes)}</p>}
          </div>
          <div className="contacts-hub-row-trailing"><span className={row.active === false ? 'inactive' : 'active'}>{row.active === false ? 'غیرفعال' : 'فعال'}</span><small>{row.created_at ? dateFa(String(row.created_at)) : 'تاریخ ثبت نامشخص'}</small></div>
        </article>;
      })}</div> : <div className="contacts-hub-empty"><Users size={25}/><b>{query || globalSearch ? 'مخاطبی با این جست‌وجو پیدا نشد' : 'هنوز مخاطبی ثبت نشده است'}</b><p>می‌توانی همین‌جا مخاطب اضافه کنی یا فایل مخاطبین را با پیش‌نمایش و بررسی واردسازی کنی.</p><button type="button" onClick={() => setFormOpen(true)}><Plus size={16}/> افزودن اولین مخاطب</button></div>}
    </section>
    <p className="contacts-hub-footnote"><ShieldCheck size={14}/> تغییرات در فضای کاری {membership.company?.name ?? 'فعلی'} ذخیره می‌شوند. اطلاعات مخاطبین برای مدل هوش مصنوعی ارسال نمی‌شود مگر اینکه وارد مرحله‌ی تحلیل اختیاری شوی.</p>
  </div>;
}
