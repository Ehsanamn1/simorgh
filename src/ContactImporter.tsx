import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileUp, FileText, LoaderCircle, Phone, RefreshCw, ShieldCheck, Users, Warehouse } from 'lucide-react';
import { api } from './lib/apiClient';

type ImportKind = 'customers' | 'suppliers';
type ContactRow = { name: string; phone: string; city: string; address: string; email?: string; kind: ImportKind };
type ImportResult = { imported: number; updated: number; skipped: number; kind?: ImportKind; byKind?: Record<ImportKind, { imported: number; updated: number }> };

function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const source = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const firstLine = source.split('\n', 1)[0] ?? '';
  const delimiters = [',', ';', '\t'];
  const counts = delimiters.map(delimiter => {
    let inQuotes = false, count = 0;
    for (let index = 0; index < firstLine.length; index++) {
      if (firstLine[index] === '"' && firstLine[index + 1] === '"') { index++; continue; }
      if (firstLine[index] === '"') inQuotes = !inQuotes;
      else if (firstLine[index] === delimiter && !inQuotes) count++;
    }
    return count;
  });
  const delimiter = delimiters[counts.indexOf(Math.max(...counts))] ?? ',';
  for (let i=0;i<source.length;i++) {
    const char=source[i];
    if (char==='"' && quoted && source[i+1]==='"') { field+='"'; i++; }
    else if (char==='"') quoted=!quoted;
    else if (char===delimiter && !quoted) { row.push(field.trim()); field=''; }
    else if (char==='\n' && !quoted) { row.push(field.trim()); if(row.some(value=>value!==''))rows.push(row); row=[];field=''; }
    else field+=char;
  }
  if(field||row.length){row.push(field.trim());if(row.some(value=>value!==''))rows.push(row);}
  return rows;
}
function westernDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, digit => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 && code <= 0x06f9 ? 0x06f0 : 0x0660));
  });
}
function detectKind(value: string, fallback: ImportKind): ImportKind {
  const normalized = value.toLocaleLowerCase('fa-IR').replace(/[\s_-]+/g, '');
  if (/supplier|vendor|provider|producer|farm|wholesale|تأمین|تامین|تولیدکننده|تولیدکنندگان|عرضهکننده|پیمانکار/.test(normalized)) return 'suppliers';
  if (/customer|client|buyer|retail|مشتری|مشتریان|خریدار|فروشگاه/.test(normalized)) return 'customers';
  return fallback;
}
function parseVCard(source: string, fallbackKind: ImportKind): ContactRow[] {
  return source.split(/END:VCARD/i).map(block=>{
    const lines=block.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    if(!lines.some(line=>/^BEGIN:VCARD/i.test(line)))return null;
    const get=(prefix:string)=>lines.find(line=>new RegExp('^'+prefix+'(?:;[^:]*)?:','i').test(line))?.split(':').slice(1).join(':').replace(/\\[nN]/g,' ').replace(/\\,/g,',').replace(/\\;/g,';').trim()||'';
    const name=get('FN')||get('N').split(';').reverse().join(' ').trim();
    const phone=lines.find(line=>/^TEL(?:;[^:]*)?:/i.test(line))?.split(':').slice(1).join(':').replace(/[\s()-]/g,'')||'';
    const org=get('ORG');
    const address=get('ADR').split(';').filter(Boolean).slice(-2).join('، ');
    const categoryHint = get('CATEGORIES') + ' ' + get('TITLE') + ' ' + get('NOTE');
    return name?{name:org?name+' · '+org:name,phone,city:address,address,kind:detectKind(categoryHint,fallbackKind)}:null;
  }).filter((value):value is ContactRow=>Boolean(value));
}
function parseContacts(fileName:string,source:string,fallbackKind:ImportKind):ContactRow[] {
  if(/\.vcf$/i.test(fileName)||/BEGIN:VCARD/i.test(source))return parseVCard(source,fallbackKind);
  const rows=csvRows(source);
  if(rows.length<1)return [];
  const normalize=(value:string)=>value.trim().toLocaleLowerCase('fa-IR').replace(/[ _-]/g,'');
  const headers=rows[0].map(normalize);
  const findIndex=(aliases:string[])=>headers.findIndex(header=>aliases.some(alias=>header===normalize(alias)));
  const nameIndex=findIndex(['name','fullname','full_name','contact','نام','نام کامل','نام مشتری','نام تامین کننده','نام تأمین‌کننده']);
  const phoneIndex=findIndex(['phone','mobile','telephone','tel','شماره','شماره تماس','موبایل','تلفن','تلفن همراه']);
  const cityIndex=findIndex(['city','شهر']);
  const addressIndex=findIndex(['address','آدرس','نشانی']);
  const kindIndex=findIndex(['kind','type','category','contact_type','contact type','نوع','نوع مخاطب','نوع ارتباط','دسته','دسته‌بندی','دسته بندی']);
  const hasHeader=nameIndex>=0||phoneIndex>=0;
  const data=hasHeader?rows.slice(1):rows;
  const ni=hasHeader?Math.max(0,nameIndex):0;
  const pi=hasHeader?phoneIndex:1;
  const ci=hasHeader?cityIndex:2;
  const ai=hasHeader?addressIndex:3;
  const ki=hasHeader?kindIndex:-1;
  return data.map(row=>({
    name:(row[ni]||'').trim(),
    phone:pi>=0?(row[pi]||'').trim():'',
    city:ci>=0?(row[ci]||'').trim():'',
    address:ai>=0?(row[ai]||'').trim():'',
    kind:detectKind(ki>=0?(row[ki]||''):'',fallbackKind),
  }))
    .filter(contact=>contact.name.length>=2)
    .map(contact=>({...contact,phone:contact.phone.replace(/[\s()-]/g,'').slice(0,40),city:contact.city.slice(0,100),address:contact.address.slice(0,500)}));
}
function phoneKey(value:string){return westernDigits(value).replace(/\D/g,'').replace(/^0098/,'98').replace(/^0(?=9\d{9}$)/,'98');}

export function ContactImporter({companyId}:{companyId:string}) {
  const inputRef=useRef<HTMLInputElement>(null);
  const [kind,setKind]=useState<ImportKind>('suppliers');
  const [fileName,setFileName]=useState('');
  const [contacts,setContacts]=useState<ContactRow[]>([]);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState<ImportResult|null>(null);
  const deduplicated=useMemo(()=>{
    const seen=new Set<string>();
    return contacts.map(contact=>{
      const key=contact.kind+':'+(phoneKey(contact.phone)||contact.name.trim().toLocaleLowerCase('fa-IR'));
      if(seen.has(key))return {...contact,duplicate:true};
      seen.add(key);return {...contact,duplicate:false};
    });
  },[contacts]);
  const ready=deduplicated.filter(contact=>!contact.duplicate&&contact.name.trim().length>=2);
  async function handleFile(file:File){
    setError('');setNotice(null);setContacts([]);setFileName(file.name);
    if(!/\.(vcf|csv|txt)$/i.test(file.name)){setError('فعلاً فقط فایل مخاطبین VCF یا فایل CSV/TXT قابل پردازش است. از گوشی می‌توانی مخاطب‌ها را به صورت VCF خروجی بگیری.');return;}
    if(file.size>5*1024*1024){setError('فایل باید حداکثر ۵ مگابایت باشد.');return;}
    setLoading(true);
    try{
      const text=await file.text();
      const parsed=parseContacts(file.name,text,kind).slice(0,5000);
      if(!parsed.length)throw new Error('مخاطب قابل تشخیصی پیدا نشد. نام و شماره را در ستون‌های CSV قرار بده یا فایل VCF معتبر انتخاب کن.');
      setContacts(parsed);
    }catch(caught){setError(caught instanceof Error?caught.message:'خواندن فایل انجام نشد.');}
    finally{setLoading(false);}
  }
  async function importContacts(){
    setSaving(true);setError('');setNotice(null);
    try{
      const response=await api.post<ImportResult>('/api/contacts/import',{
        companyId,kind,contacts:ready.slice(0,1000).map(({name,phone,city,address,kind:contactKind})=>({name,phone,city,address,kind:contactKind})),
      });
      setNotice(response);
    }catch(caught){setError(caught instanceof Error?caught.message:'واردکردن مخاطبین انجام نشد.');}
    finally{setSaving(false);}
  }
  return <section className="contact-import-page" dir="rtl">
    <header className="contact-import-hero">
      <span className="contact-import-mark"><Users size={23}/></span>
      <div><span className="eyebrow">مدیریت ارتباطات</span><h1>ورود و سامان‌دهی مخاطبین</h1><p>فهرست مخاطبین گوشی را به VCF صادر کن یا یک فایل CSV انتخاب کن. نوع مخاطب را از سرستون CSV تشخیص می‌گیرد یا از دسته‌ی انتخابی استفاده می‌کند؛ پیش از ثبت می‌توانی همه را بررسی کنی.</p></div>
    </header>
    <div className="contact-import-security"><ShieldCheck size={18}/><span>فایل در همین رابط خوانده می‌شود و فقط رکوردهایی که بعد از بررسی تأیید می‌کنی به API و فضای کاری مرکزی ارسال می‌شوند. کلیدها و اطلاعات پایگاه داده به این صفحه نمی‌آیند.</span></div>
    <div className="contact-import-grid">
      <section className="contact-import-card">
        <div className="contact-card-heading"><span><FileUp size={18}/></span><div><b>۱. انتخاب فایل</b><small>حداکثر ۵ مگابایت · VCF / CSV / TXT</small></div></div>
        <button type="button" className="contact-dropzone" onClick={()=>inputRef.current?.click()} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const file=event.dataTransfer.files[0];if(file)void handleFile(file);}}>
          <FileText size={28}/><b>{fileName||'فایل مخاطبین را انتخاب کن'}</b><small>روی این بخش بزن یا فایل را بکش و رها کن</small>
        </button>
        <input className="sr-only" ref={inputRef} type="file" accept=".vcf,.csv,.txt,text/vcard,text/csv,text/plain" onChange={event=>{const file=event.target.files?.[0];if(file)void handleFile(file);event.currentTarget.value='';}}/>
        <div className="contact-kind-select"><span>دسته‌ی مقصد</span><div>
          <button type="button" className={kind==='suppliers'?'selected':''} onClick={()=>setKind('suppliers')}><Warehouse size={16}/> تأمین‌کننده</button>
          <button type="button" className={kind==='customers'?'selected':''} onClick={()=>setKind('customers')}><Users size={16}/> مشتری</button>
        </div></div>
        <p className="contact-import-tip">راهنما: در CSV از سرستون‌های <code>name,phone,city,address,type</code> استفاده کن. ستون <code>type</code> می‌تواند supplier/suppliers یا customer/customers (یا «تأمین‌کننده»/«مشتری») باشد تا دسته به‌صورت خودکار انتخاب شود؛ اگر ستون نوع نباشد، دسته‌ی انتخابی مبناست.</p>
      </section>
      <section className="contact-import-card contact-preview-card">
        <div className="contact-card-heading"><span><Phone size={18}/></span><div><b>۲. پیش‌نمایش و بررسی</b><small>{contacts.length.toLocaleString('fa-IR')} مخاطب شناسایی‌شده</small></div><button type="button" className="contact-reset" onClick={()=>{setContacts([]);setFileName('');setError('');setNotice(null);}} disabled={!contacts.length}><RefreshCw size={14}/></button></div>
        {loading?<div className="contact-empty"><LoaderCircle className="ai-spin" size={22}/> در حال خواندن پرونده</div>
          :contacts.length===0?<div className="contact-empty"><FileUp size={24}/><b>هنوز فایلی انتخاب نشده</b><span>بعد از انتخاب، نام و شماره‌ها را قبل از ذخیره می‌بینی.</span></div>
          :<>
            <div className="contact-preview-metrics"><div><b>{ready.length.toLocaleString('fa-IR')}</b><small>آماده‌ی ثبت</small></div><div><b>{(contacts.length-ready.length).toLocaleString('fa-IR')}</b><small>تکراری / کنارگذاشته</small></div></div>
            <div className="contact-preview-list">{deduplicated.slice(0,12).map((contact,index)=><article key={index} className={contact.duplicate?'duplicate':''}>
              <span className="contact-avatar">{contact.name.slice(0,1)}</span><div><b>{contact.name}</b><small dir="ltr">{contact.phone||'بدون شماره'}</small><small>{[contact.city,contact.address].filter(Boolean).join(' · ')||'نشانی ثبت نشده'}</small></div>{contact.duplicate?<span className="contact-duplicate-tag">تکراری</span>:<span className="contact-kind-tag">{contact.kind==='suppliers'?'تأمین‌کننده':'مشتری'}</span>}
            </article>)}</div>
            {contacts.length>12&&<p className="contact-preview-more">۱۲ ردیف از {contacts.length.toLocaleString('fa-IR')} مخاطب نمایش داده شده است.</p>}
            <button className="ai-primary-button contact-save-button" type="button" onClick={()=>void importContacts()} disabled={saving||loading||ready.length===0}>{saving?<LoaderCircle size={16} className="ai-spin"/>:<CheckCircle2 size={16}/>} ثبت {ready.length.toLocaleString('fa-IR')} مخاطب در فضای کاری</button>
          </>}
      </section>
    </div>
    {error&&<div className="ai-feedback error" role="alert">{error}</div>}
    {notice&&<div className="contact-import-result" role="status"><CheckCircle2 size={22}/><div><b>واردکردن مخاطبین کامل شد</b><p>{notice.imported.toLocaleString('fa-IR')} مخاطب جدید · {notice.updated.toLocaleString('fa-IR')} رکورد به‌روزشده · {notice.skipped.toLocaleString('fa-IR')} مورد رد یا تکراری</p>{notice.byKind&&<small>تأمین‌کنندگان: {(notice.byKind.suppliers?.imported||0).toLocaleString('fa-IR')} جدید / {(notice.byKind.suppliers?.updated||0).toLocaleString('fa-IR')} به‌روزرسانی · مشتریان: {(notice.byKind.customers?.imported||0).toLocaleString('fa-IR')} جدید / {(notice.byKind.customers?.updated||0).toLocaleString('fa-IR')} به‌روزرسانی</small>}</div></div>}
  </section>;
}
