import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowUpLeft, BarChart3, Bell, Boxes,
  CalendarDays, CheckCircle2, ChevronLeft, ClipboardCheck, Clock3, CreditCard,
  Factory, FileText, Gauge, Home, Layers3, Map, MapPin, Menu, Moon, Network,
  Route, Search, Settings2, ShieldCheck, Sun, Target, Truck, Users,
  Warehouse, X, CircleHelp,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SimorghLogo } from './SimorghLogo';

type ModuleKey = 'command'|'orders'|'farms'|'production'|'tasks'|'inventory'|'shipments'|'map'|'finance'|'partners'|'quality'|'intelligence'|'goals'|'audit'|'settings';
type IconType = typeof Home;
type ModuleItem = {key:ModuleKey; label:string; icon:IconType; group:string; subtitle:string};

const modules:ModuleItem[]=[
 {key:'command',label:'مرکز فرمان',icon:Gauge,group:'مدیریت',subtitle:'تصویر یکپارچه‌ی عملکرد مجموعه'},
 {key:'orders',label:'سفارش‌ها',icon:Boxes,group:'مدیریت',subtitle:'ثبت، پیگیری و موعد تحویل'},
 {key:'partners',label:'شرکا و تأمین‌کنندگان',icon:Users,group:'شبکه',subtitle:'شرکا، قراردادها و ظرفیت'},
 {key:'farms',label:'مزارع و سایت‌ها',icon:Factory,group:'تولید',subtitle:'سایت، دوره و ظرفیت مزرعه'},
 {key:'production',label:'ثبت تولید',icon:Activity,group:'تولید',subtitle:'رکوردهای تولید روزانه و بچ‌ها'},
 {key:'tasks',label:'وظایف و رخدادها',icon:ClipboardCheck,group:'عملیات',subtitle:'مسئولیت، موعد، مغایرت و پیگیری'},
 {key:'inventory',label:'انبار و خرید',icon:Warehouse,group:'عملیات',subtitle:'موجودی، رسید و گردش کالا'},
 {key:'shipments',label:'ارسال و تحویل',icon:Truck,group:'عملیات',subtitle:'محموله، مسیر و مدرک تحویل'},
 {key:'map',label:'نقشه و راهنما',icon:Map,group:'عملیات',subtitle:'نمای جغرافیایی مسیرهای شبکه'},
 {key:'quality',label:'کیفیت و مدارک',icon:ShieldCheck,group:'عملیات',subtitle:'کنترل کیفیت و اسناد مستند'},
 {key:'finance',label:'مالی و تسویه',icon:CreditCard,group:'مالی',subtitle:'دفتر مالی، قرارداد و تسویه'},
 {key:'goals',label:'اهداف و برنامه',icon:Target,group:'مدیریت',subtitle:'اهداف، شاخص‌ها و مسیر اجرا'},
 {key:'intelligence',label:'هوش عملیاتی',icon:Network,group:'مدیریت',subtitle:'بینش داده‌محور و پیشنهاد اجرایی'},
 {key:'audit',label:'تاریخچه تغییرات',icon:FileText,group:'کنترل',subtitle:'ردپای تغییرات و مسئولیت'},
 {key:'settings',label:'تنظیمات سامانه',icon:Settings2,group:'کنترل',subtitle:'ترجیحات و پیکربندی عملیاتی'},
];
const quickItems: {key:ModuleKey;title:string;desc:string;icon:IconType;tone:string}[]=[
 {key:'orders',title:'مدیریت سفارش‌ها',desc:'سفارش، تعهد و زمان تحویل',icon:Boxes,tone:'teal'},
 {key:'inventory',title:'انبار و خرید',desc:'مانده و گردش واقعی کالا',icon:Warehouse,tone:'blue'},
 {key:'tasks',title:'وظایف روزانه',desc:'کارهای باز و موارد نیازمند اقدام',icon:ClipboardCheck,tone:'amber'},
 {key:'goals',title:'اهداف و برنامه',desc:'شاخص، موعد و مسئول',icon:Target,tone:'slate'},
 {key:'finance',title:'مالی و تسویه',desc:'دفتر مالی و صورت‌حساب',icon:CreditCard,tone:'slate'},
];
const pageFromLocation=(path:string,search:string):ModuleKey=>{
 const query=new URLSearchParams(search).get('module');
 if(query&&modules.some(m=>m.key===query))return query as ModuleKey;
 const tail=path.split('/').filter(Boolean).pop();
 const map:Record<string,ModuleKey>={command:'command',orders:'orders',inventory:'inventory',shipments:'shipments',map:'map',finance:'finance','partner-finance':'finance','daily-production':'production','operational-tasks':'tasks','farm-sites':'farms',customers:'partners',suppliers:'partners',audit:'audit',quality:'quality'};
 return tail?map[tail]??'command':'command';
};
function TehranClock(){
 const [now,setNow]=useState(()=>new Date());
 useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),60_000);return()=>window.clearInterval(timer)},[]);
 return <div className="ops-live-clock"><CalendarDays size={15}/><span>{new Intl.DateTimeFormat('fa-IR',{dateStyle:'full',timeZone:'Asia/Tehran'}).format(now)}</span><b>{new Intl.DateTimeFormat('fa-IR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tehran'}).format(now)}</b></div>;
}
function EmptyPanel({icon:Icon,title,description}:{icon:IconType;title:string;description:string}){
 return <div className="ops-live-empty"><span><Icon size={21}/></span><b>{title}</b><p>{description}</p></div>;
}
function StatCard({title,icon:Icon,description,tone}:{title:string;icon:IconType;description:string;tone:string}){
 return <article className={'ops-live-stat tone-'+tone}><div className="ops-live-stat-top"><span>{title}</span><i><Icon size={18}/></i></div><strong>—</strong><small>{description}</small></article>;
}
function MapGuide({expanded=false}:{expanded?:boolean}){
 return <section className={'ops-live-panel ops-live-map '+(expanded?'expanded':'')}>
   <header className="ops-live-panel-head"><div><span className="ops-live-section-icon"><Map size={17}/></span><div><h3>نقشه‌ی راهنمای شبکه</h3><p>نمای جغرافیایی برای مسیرهای عملیاتی</p></div></div><span className="ops-live-chip"><MapPin size={13}/> نقشه‌ی پایه</span></header>
   <div className="ops-live-map-frame"><iframe title="نقشه جغرافیایی ایران" loading="lazy" referrerPolicy="no-referrer-when-downgrade" src="https://www.openstreetmap.org/export/embed.html?bbox=43.2%2C24.5%2C64.8%2C40.8&layer=mapnik"/><div className="ops-live-map-note"><MapPin size={16}/><span><b>نشانگر عملیاتی ثبت نشده</b><small>موقعیت‌ها پس از ثبت GPS مجاز از دیتابیس نمایش داده می‌شوند.</small></span></div></div>
   <footer className="ops-live-map-foot"><span>بدون مختصات یا مسیر ساختگی</span><button type="button" onClick={()=>window.open('https://www.openstreetmap.org/#map=5/32.5/53.5','_blank','noopener,noreferrer')}>بازکردن نقشه <ArrowUpLeft size={14}/></button></footer>
 </section>;
}
export default function OperationalWorkspace({authLoading=false,hasMembership=false}:{authLoading?:boolean;hasMembership?:boolean}){
 const location=useLocation(),navigate=useNavigate();
 const [page,setPage]=useState<ModuleKey>(()=>pageFromLocation(location.pathname,location.search));
 const [theme,setTheme]=useState<'dark'|'light'>(()=>{try{return localStorage.getItem('simorgh-theme')==='light'?'light':'dark'}catch{return'dark'}});
 const [drawerOpen,setDrawerOpen]=useState(false),[search,setSearch]=useState('');
 useEffect(()=>{setPage(pageFromLocation(location.pathname,location.search))},[location.pathname,location.search]);
 useEffect(()=>{
  document.documentElement.dataset.theme=theme;
  document.documentElement.style.colorScheme=theme;
  const meta=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if(meta)meta.content=theme==='dark'?'#0B1012':'#F4F7F7';
  try{localStorage.setItem('simorgh-theme',theme)}catch{/* storage may be blocked */}
 },[theme]);
 const active=modules.find(m=>m.key===page)??modules[0];
 const filtered=useMemo(()=>modules.filter(m=>!search||m.label.includes(search)||m.subtitle.includes(search)),[search]);
 const go=(key:ModuleKey)=>{setPage(key);setDrawerOpen(false);navigate(key==='command'?'/app/command':'/app/command?module='+key)};
 const statusText=authLoading?'در حال بررسی وضعیت اتصال':hasMembership?'حساب سازمانی فعال':'داده‌های شرکت در انتظار فعال‌سازی حساب مالک';
 return <main className="ops-live-app" dir="rtl">
  <header className="ops-live-header">
    <div className="ops-live-brand"><SimorghLogo/><span>سامانه‌ی یکپارچه‌ی مدیریت مزرعه و عملیات</span></div>
    <div className="ops-live-header-meta"><TehranClock/><button type="button" className="ops-live-theme" aria-label={theme==='dark'?'فعال‌کردن حالت روشن':'فعال‌کردن حالت تاریک'} onClick={()=>setTheme(v=>v==='dark'?'light':'dark')}>{theme==='dark'?<Sun size={17}/>:<Moon size={17}/>}<span>{theme==='dark'?'حالت روشن':'حالت تاریک'}</span></button></div>
  </header>
  <div className="ops-live-shell">
   {drawerOpen&&<button className="ops-live-scrim" type="button" aria-label="بستن منو" onClick={()=>setDrawerOpen(false)}/>}
   <aside className={'ops-live-sidebar '+(drawerOpen?'open':'')}>
    <div className="ops-live-side-brand"><SimorghLogo compact/><div><b>محیط عملیاتی</b><small>مدیریت مجموعه</small></div><button type="button" aria-label="بستن منو" className="ops-live-close" onClick={()=>setDrawerOpen(false)}><X size={17}/></button></div>
    <label className="ops-live-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="جست‌وجوی بخش‌ها…"/></label>
    <nav className="ops-live-nav" aria-label="ماژول‌های سامانه">{['مدیریت','شبکه','تولید','عملیات','مالی','کنترل'].map(group=><div className="ops-live-nav-group" key={group}><small>{group}</small>{filtered.filter(m=>m.group===group).map(m=>{const Icon=m.icon;return <button key={m.key} type="button" className={page===m.key?'active':''} onClick={()=>go(m.key)}><Icon size={16}/><span>{m.label}</span>{page===m.key&&<i/>}</button>})}</div>)}</nav>
    <div className="ops-live-sidebar-status"><span className={hasMembership?'healthy':''}/><div><b>{hasMembership?'دسترسی سازمانی فعال':'کنترل دسترسی فعال است'}</b><small>{hasMembership?'ماژول‌ها با نقش واقعی محدود شده‌اند':'داده‌ی خصوصی بدون عضویت نمایش داده نمی‌شود'}</small></div><ShieldCheck size={16}/></div>
   </aside>
   <section className="ops-live-main">
    <div className="ops-live-toolbar"><button type="button" className="ops-live-menu" aria-label="بازکردن منو" onClick={()=>setDrawerOpen(true)}><Menu size={19}/></button><div className="ops-live-crumb"><span>سیمرغ</span><ChevronLeft size={13}/><b>{active.label}</b></div><div className="ops-live-toolbar-right"><span className={'ops-live-status '+(hasMembership?'connected':'')}><i/>{statusText}</span><button type="button" aria-label="تنظیمات" onClick={()=>go('settings')}><Settings2 size={16}/></button><button type="button" aria-label="مرکز راهنما" onClick={()=>go('goals')}><CircleHelp size={16}/></button></div></div>
    <div className="ops-live-content">
     {page==='command'?<>
      <div className="ops-live-heading"><div><span>مدیریت یکپارچه‌ی مزرعه و عملیات</span><h1>مرکز فرمان شبکه</h1><p>از هدف و ظرفیت تا سفارش، کیفیت، ارسال و تسویه؛ همه در یک نمای مدیریتی.</p></div><div className="ops-live-heading-side"><span><Clock3 size={14}/> نمای روز جاری</span><small>{statusText}</small></div></div>
      {!hasMembership&&<div className="ops-live-access-note"><span><ShieldCheck size={20}/></span><div><b>زیرساخت عملیاتی آماده است؛ دسترسی مالک هنوز فعال نشده</b><p>برای حفظ محرمانگی، آمار، سفارش‌ها و مبالغ شرکت تا ایجاد حساب مالک و عضویت معتبر از پایگاه داده خوانده نمی‌شوند. این محیط فرم ورود یا ثبت‌نام عمومی ندارد.</p></div><a href="https://github.com/Ehsanamn1/simorgh/blob/main/docs/OWNER_PROVISIONING.md" target="_blank" rel="noreferrer">راهنمای فعال‌سازی مالک <ArrowUpLeft size={14}/></a></div>}
      <div className="ops-live-stats"><StatCard title="سفارش‌های فعال" icon={Boxes} description="وضعیت از دفتر سفارش‌ها" tone="teal"/><StatCard title="ظرفیت تأییدشده" icon={Factory} description="تعهدهای معتبر دوره‌ی جاری" tone="blue"/><StatCard title="محموله‌های در جریان" icon={Truck} description="از وضعیت واقعی ارسال" tone="slate"/><StatCard title="موارد نیازمند اقدام" icon={AlertTriangle} description="هشدارهای اولویت‌دار" tone="amber"/></div>
      <div className="ops-live-primary-grid"><MapGuide/><section className="ops-live-panel"><header className="ops-live-panel-head"><div><span className="ops-live-section-icon"><Target size={17}/></span><div><h3>اهداف و مسیر اجرا</h3><p>هدف، شاخص، مسئول و گام بعدی</p></div></div><span className="ops-live-chip">برنامه‌ی عملیاتی</span></header><EmptyPanel icon={Target} title="هدف عملیاتی ثبت نشده" description="اهداف، شاخص‌های کلیدی و گام بعدی پس از ورود داده‌ی واقعی در این بخش فهرست می‌شوند."/></section></div>
      <section className="ops-live-quick"><header className="ops-live-panel-head"><div><span className="ops-live-section-icon"><Layers3 size={17}/></span><div><h3>دسترسی سریع</h3><p>مسیر کوتاه به کارهای پرتکرار</p></div></div><span className="ops-live-chip">۴ میان‌بر</span></header><div className="ops-live-quick-grid">{quickItems.map(q=>{const Icon=q.icon;return <button key={q.key} type="button" className={'ops-live-quick-card '+q.tone} onClick={()=>go(q.key)}><span><Icon size={19}/></span><div><b>{q.title}</b><small>{q.desc}</small></div><ArrowUpLeft size={15}/></button>})}</div></section>
      <div className="ops-live-secondary-grid"><section className="ops-live-panel"><header className="ops-live-panel-head"><div><span className="ops-live-section-icon"><Activity size={17}/></span><div><h3>روند عملکرد</h3><p>رکورد روزانه در برابر هدف دوره</p></div></div><BarChart3 size={17}/></header><EmptyPanel icon={BarChart3} title="روند قابل محاسبه نیست" description="تا زمانی که رکوردهای واقعی تولید و سفارش در دسترس نباشد، خط روندی رسم نمی‌شود."/></section><section className="ops-live-panel"><header className="ops-live-panel-head"><div><span className="ops-live-section-icon"><AlertTriangle size={17}/></span><div><h3>موارد نیازمند پیگیری</h3><p>تأخیر، رخداد، موعد و درخواست</p></div></div><Bell size={17}/></header><EmptyPanel icon={CheckCircle2} title="فهرست امن نیازمند دسترسی مدیر است" description="این بخش پس از فعال‌شدن حساب مجاز، هشدارها را از رکوردهای واقعی و به‌روز نشان می‌دهد."/></section></div>
      <footer className="ops-live-footer"><span><ShieldCheck size={14}/> اطلاعات ساختگی نمایش داده نمی‌شود.</span><span>زمان محلی سامانه بر پایه‌ی منطقه‌ی زمانی تهران</span></footer>
     </>:page==='map'?<div className="ops-live-module"><div className="ops-live-heading"><div><span>راهنمای جغرافیایی</span><h1>نقشه و راهنما</h1><p>نقشه‌ی پایه برای بررسی موقعیت‌های واقعی ثبت‌شده در سامانه.</p></div></div><MapGuide expanded/><div className="ops-live-panel"><EmptyPanel icon={MapPin} title="نقطه‌ی عملیاتی ثبت نشده" description="نشانگرها فقط پس از ثبت GPS واقعی توسط کاربر مجاز نمایش داده خواهند شد."/></div></div>:<ModuleWorkspace module={active} hasMembership={hasMembership} onHome={()=>go('command')}/>}
    </div>
   </section>
  </div>
  <nav className="ops-live-bottom-nav" aria-label="ناوبری اصلی موبایل"><button className={page==='command'?'active':''} onClick={()=>go('command')} type="button"><Home size={19}/><span>خانه</span></button><button className={['orders','farms','production','tasks','inventory','shipments'].includes(page)?'active':''} onClick={()=>go('tasks')} type="button"><ClipboardCheck size={19}/><span>عملیات</span></button><button className={page==='map'?'active':''} onClick={()=>go('map')} type="button"><Route size={19}/><span>نقشه</span></button><button type="button" className={drawerOpen?'active':''} onClick={()=>setDrawerOpen(true)}><Menu size={19}/><span>بیشتر</span></button></nav>
 </main>;
}
function ModuleWorkspace({module,hasMembership,onHome}:{module:ModuleItem;hasMembership:boolean;onHome:()=>void}){
 const Icon=module.icon;
 return <div className="ops-live-module"><div className="ops-live-heading"><div><span>{module.group}</span><h1>{module.label}</h1><p>{module.subtitle}</p></div><span className="ops-live-module-mark"><Icon size={22}/></span></div><div className="ops-live-module-grid"><section className="ops-live-panel"><header className="ops-live-panel-head"><div><span className="ops-live-section-icon"><Icon size={17}/></span><div><h3>{module.label}</h3><p>اطلاعات و عملیات این بخش</p></div></div></header><EmptyPanel icon={Icon} title={hasMembership?'داده‌ای برای نمایش ثبت نشده':'دسترسی داده‌ی این بخش فعال نیست'} description={hasMembership?'هنوز رکوردی برای این مجموعه ثبت نشده است؛ با ثبت نخستین رکورد این فهرست به‌روز می‌شود.':'صفحه و ناوبری آماده است؛ برای خواندن اطلاعات خصوصی باید عضویت واقعی با نقش مناسب فعال شود.'}/></section><section className="ops-live-panel"><header className="ops-live-panel-head"><div><span className="ops-live-section-icon"><ShieldCheck size={17}/></span><div><h3>قواعد دسترسی و ثبت</h3><p>یکپارچگی داده و ردپای تغییرات</p></div></div></header><div className="ops-live-rules"><span><CheckCircle2 size={16}/> سطح دسترسی از عضویت واقعی تعیین می‌شود</span><span><CheckCircle2 size={16}/> هر تغییر عملیاتی باید در دیتابیس ثبت شود</span><span><CheckCircle2 size={16}/> اطلاعات مالی و مکانی بدون مجوز نمایش داده نمی‌شود</span></div><button type="button" className="ops-live-home-button" onClick={onHome}><Home size={16}/> بازگشت به مرکز فرمان</button></section></div></div>;
}
