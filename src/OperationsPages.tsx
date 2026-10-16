import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ClipboardCheck, CreditCard, FileCheck2, FileText, Factory, Plus, RefreshCw, ShieldCheck, Warehouse, X } from 'lucide-react';
import { api } from './lib/apiClient';
import type { Membership, Row } from './lib/types';
import { dateFa, dateTimeFa, moneyFa, numberFa, statusTone } from './lib/format';

export type OperationsKind =
  | 'farm-sites' | 'flock-cycles' | 'production-batches' | 'daily-production'
  | 'task-templates' | 'operational-tasks' | 'incidents'
  | 'partnership-agreements' | 'partner-finance' | 'partner-settlements';

type Option = { value: string; label: string };
type Field = {
  name: string; label: string; type?: 'text' | 'number' | 'date' | 'datetime-local' | 'textarea' | 'select' | 'checkbox' | 'multi';
  required?: boolean; helper?: string; options?: Option[]; defaultValue?: string | boolean | string[];
  min?: string; max?: string; step?: string; full?: boolean;
};
type Column = { key: string; label: string; value?: (row: Row, refs: RefData) => string };
type Config = { title: string; eyebrow: string; description: string; table: string; icon: typeof Warehouse; columns: Column[] };
type RefData = { suppliers: Row[]; sites: Row[]; batches: Row[]; templates: Row[]; agreements: Row[]; financeEntries: Row[]; products: Row[] };
const emptyRefs: RefData = { suppliers: [], sites: [], batches: [], templates: [], agreements: [], financeEntries: [], products: [] };
const expenses: Option[] = [
  {value:'feed',label:'خوراک'},{value:'production',label:'تولید'},{value:'packaging',label:'بسته‌بندی'},
  {value:'processing',label:'فرآوری'},{value:'logistics',label:'حمل‌ونقل'},{value:'veterinary',label:'دامپزشکی'},
  {value:'labor',label:'نیروی انسانی'},{value:'energy',label:'انرژی'},{value:'maintenance',label:'نگهداری و تعمیرات'},{value:'other',label:'سایر'},
];
const priorities: Option[] = [
  {value:'low',label:'کم'},{value:'normal',label:'عادی'},{value:'high',label:'بالا'},{value:'critical',label:'بحرانی'},
];
const evidenceTypes: Option[] = [
  {value:'note',label:'یادداشت'},{value:'measurement',label:'اندازه‌گیری'},{value:'photo',label:'عکس'},{value:'document',label:'سند'},
];
const statusFa: Record<string,string> = {
  draft:'پیش‌نویس', pending_signature:'در انتظار امضا', active:'فعال', suspended:'معلق', expired:'منقضی',
  terminated:'خاتمه‌یافته', planned:'برنامه‌ریزی‌شده', in_progress:'در حال انجام', submitted:'ارسال برای بررسی',
  approved:'تأییدشده', rejected:'ردشده', completed:'تکمیل‌شده', on_hold:'متوقف', cancelled:'لغوشده',
  eggs:'تخم‌مرغ', meat:'گوشت', crop:'کشت و محصولات زراعی', livestock:'دام و فرآورده دامی',
  poultry:'طیور', aquaculture:'آبزی‌پروری', dairy:'لبنیات', greenhouse:'گلخانه', orchard:'باغ',
  apiary:'زنبورستان', honey:'عسل', forestry:'جنگل‌داری', mixed:'چندمنظوره',
  processing:'فرآوری', warehouse:'انبار', distribution:'توزیع',
  farm_product:'محصول مزرعه', input:'نهاده و مواد اولیه', feed:'خوراک', equipment:'تجهیزات',
  processed:'محصول فرآوری‌شده', service:'خدمات', other:'سایر', unit:'واحد',
  not_inspected:'بازرسی‌نشده', passed:'قبول',
  pending_review:'در انتظار بازبینی', open:'باز', investigating:'در حال بررسی', action_required:'نیازمند اقدام',
  resolved:'رفع‌شده', closed:'بسته', sale_invoice:'فاکتور فروش', sale_collection:'دریافت فروش',
  expense:'هزینه', partner_advance:'پیش‌پرداخت شریک', settlement_payment:'پرداخت تسویه',
  adjustment:'سند تعدیلی', collected_cash:'وجه وصول‌شده', accrual:'تعهدی', TOMAN:'تومان',
  company:'شرکت', partner:'شریک', vendor:'فروشنده', customer:'مشتری', none:'ثبت‌نشده',
  unpaid:'پرداخت‌نشده', partial:'پرداخت ناقص', paid:'پرداخت‌شده', not_applicable:'غیرنقدی',
  high:'بالا', medium:'متوسط', low:'کم', critical:'بحرانی', normal:'عادی',
  production:'تولید', quality:'کیفیت', animal_welfare:'رفاه گله', inventory:'موجودی',
  safety:'ایمنی', logistics:'حمل‌ونقل', finance:'مالی',
};
const fa = (v: unknown) => statusFa[String(v ?? '')] ?? String(v ?? '—');
const text = (v: unknown) => v === null || v === undefined || v === '' ? '—' : String(v);
const numeric = (v: unknown) => Number(v ?? 0);
const dateValue = (v: unknown) => typeof v === 'string' && v ? dateFa(v) : '—';
const refName = (list: Row[], id: unknown, key: string) => text(list.find(x => String(x.id) === String(id))?.[key] ?? id);
const supplierOpt = (r: Row): Option => ({value:String(r.id),label:String(r.name ?? 'تأمین‌کننده') + (r.city ? ' · ' + String(r.city) : '')});
const siteOpt = (r: Row): Option => ({value:String(r.id),label:String(r.site_code ?? '') + ' · ' + String(r.name ?? '')});
const batchOpt = (r: Row): Option => ({value:String(r.id),label:String(r.batch_code ?? '') + ' · ' + fa(r.status)});
const agreementOpt = (r: Row): Option => ({value:String(r.id),label:String(r.agreement_code ?? '') + ' · نسخه ' + String(r.version ?? 1) + ' · ' + fa(r.status)});

const configs: Record<OperationsKind, Config> = {
  'farm-sites': {title:'سایت‌های مزرعه',eyebrow:'مزارع و سایت‌ها',description:'نوع فعالیت، مسئولیت، مجوز و مختصات جغرافیایی هر سایت را ثبت کنید.',table:'farm_sites',icon:Warehouse,columns:[
    {key:'site_code',label:'کد سایت'},{key:'name',label:'نام سایت'},{key:'site_type',label:'نوع فعالیت',value:r=>fa(r.site_type)},
    {key:'supplier_id',label:'مسئول / شریک',value:(r,refs)=>refName(refs.suppliers,r.supplier_id,'name')},
    {key:'city',label:'شهر'},{key:'license_expires_on',label:'انقضای مجوز',value:r=>dateValue(r.license_expires_on)},{key:'active',label:'فعال',value:r=>r.active?'بله':'خیر'}]},
  'flock-cycles': {title:'چرخه‌های کشت و پرورش',eyebrow:'چرخه‌های کشت و پرورش',description:'نوع چرخه، گونه یا محصول، مقدار اولیه و بازه‌ی اجرا را ثبت کنید.',table:'flock_cycles',icon:Factory,columns:[
    {key:'cycle_code',label:'کد چرخه'},{key:'cycle_type',label:'نوع چرخه',value:r=>fa(r.cycle_type)},
    {key:'species',label:'گونه / محصول'},{key:'farm_site_id',label:'سایت',value:(r,refs)=>refName(refs.sites,r.farm_site_id,'name')},
    {key:'arrived_on',label:'تاریخ شروع',value:r=>dateValue(r.arrived_on)},
    {key:'initial_quantity',label:'مقدار اولیه',value:r=>r.initial_quantity==null?'—':numberFa(numeric(r.initial_quantity))+' '+text(r.quantity_unit)},
    {key:'planned_end_on',label:'پایان برنامه‌ای',value:r=>dateValue(r.planned_end_on)},{key:'status',label:'وضعیت',value:r=>fa(r.status)}]},
  'production-batches': {title:'بچ‌های تولید',eyebrow:'رهگیری تولید',description:'برنامه و خروجی هر بچ را به سایت، شریک و مسیر ردیابی متصل کنید.',table:'production_batches',icon:ClipboardCheck,columns:[
    {key:'batch_code',label:'کد بچ'},{key:'production_kind',label:'نوع محصول',value:r=>fa(r.production_kind)},
    {key:'farm_site_id',label:'سایت',value:(r,refs)=>refName(refs.sites,r.farm_site_id,'name')},
    {key:'planned_quantity',label:'برنامه',value:r=>r.planned_quantity==null?'—':numberFa(numeric(r.planned_quantity))+' '+text(r.unit)},
    {key:'produced_quantity',label:'تولید',value:r=>numberFa(numeric(r.produced_quantity))+' '+text(r.unit)},
    {key:'status',label:'وضعیت',value:r=>fa(r.status)},{key:'quality_status',label:'کیفیت',value:r=>fa(r.quality_status)}]},
  'daily-production': {title:'ثبت روزانه عملیات',eyebrow:'ثبت روزانه عملیات',description:'منابع مصرفی، ضایعات و خروجی واقعی هر بچ را با تاریخ و واحد سنجش ثبت کنید.',table:'daily_production_records',icon:Activity,columns:[
    {key:'record_date',label:'تاریخ',value:r=>dateValue(r.record_date)},{key:'batch_id',label:'بچ',value:(r,refs)=>refName(refs.batches,r.batch_id,'batch_code')},
    {key:'resource_name',label:'منبع مصرفی',value:r=>text(r.resource_name)},
    {key:'input_quantity',label:'مصرف',value:r=>numberFa(numeric(r.input_quantity))+' '+text(r.input_unit)},
    {key:'produced_quantity',label:'خروجی',value:(r,refs)=>numberFa(numeric(r.produced_quantity??r.eggs_collected))+' '+refName(refs.batches,r.batch_id,'unit')},
    {key:'rejected_quantity',label:'مردودی',value:(r,refs)=>numberFa(numeric(r.rejected_quantity))+' '+refName(refs.batches,r.batch_id,'unit')},
    {key:'loss_quantity',label:'ضایعات / تلفات',value:r=>numberFa(numeric(r.loss_quantity))+' '+text(r.loss_unit)}]},
  'task-templates': {title:'دستورالعمل‌های کاری',eyebrow:'دستورالعمل‌های کاری',description:'دستورالعمل را پیش‌نویس کنید؛ تأیید مدیر نسخه را برای استفاده در وظایف قفل می‌کند.',table:'task_templates',icon:FileCheck2,columns:[
    {key:'template_code',label:'کد دستورالعمل'},{key:'title',label:'عنوان'},{key:'category',label:'گروه'},
    {key:'priority',label:'اولویت',value:r=>fa(r.priority)},{key:'evidence_required',label:'مدرک لازم',value:r=>r.evidence_required?'بله':'خیر'},
    {key:'status',label:'وضعیت',value:r=>fa(r.status)}]},
  'operational-tasks': {title:'وظایف عملیاتی',eyebrow:'وظایف عملیاتی',description:'مسئول، موعد، مدرک اجباری و نتیجه بازبینی را ثبت و پیگیری کنید.',table:'operational_tasks',icon:ClipboardCheck,columns:[
    {key:'title',label:'وظیفه'},{key:'assignee_supplier_id',label:'مسئول',value:(r,refs)=>refName(refs.suppliers,r.assignee_supplier_id,'name')},
    {key:'due_at',label:'موعد',value:r=>typeof r.due_at==='string'?dateTimeFa(r.due_at):'—'},
    {key:'priority',label:'اولویت',value:r=>fa(r.priority)},{key:'evidence_required',label:'مدرک لازم',value:r=>r.evidence_required?'بله':'خیر'},
    {key:'status',label:'وضعیت',value:r=>fa(r.status)}]},
  incidents: {title:'رخدادها و مغایرت‌ها',eyebrow:'رخدادها و مغایرت‌ها',description:'رخدادهای تولید، کیفیت، حمل یا ایمنی را ثبت و اقدام اصلاحی را پیگیری کنید.',table:'operational_incidents',icon:Activity,columns:[
    {key:'title',label:'رخداد'},{key:'category',label:'گروه',value:r=>fa(r.category)},{key:'severity',label:'شدت',value:r=>fa(r.severity)},
    {key:'farm_site_id',label:'سایت',value:(r,refs)=>refName(refs.sites,r.farm_site_id,'name')},
    {key:'status',label:'وضعیت',value:r=>fa(r.status)},{key:'created_at',label:'ثبت',value:r=>typeof r.created_at==='string'?dateTimeFa(r.created_at):'—'}]},
  'partnership-agreements': {title:'قراردادهای مشارکت',eyebrow:'قراردادهای مشارکت',description:'نسخه قرارداد، نسبت تقسیم و دسته‌های هزینه را ثبت کنید. فعال‌سازی نیازمند فایل امضاست.',table:'partnership_agreements',icon:FileText,columns:[
    {key:'agreement_code',label:'کد قرارداد'},{key:'version',label:'نسخه'},{key:'supplier_id',label:'شریک',value:(r,refs)=>refName(refs.suppliers,r.supplier_id,'name')},
    {key:'company_profit_share_pct',label:'سهم شرکت',value:r=>numberFa(numeric(r.company_profit_share_pct))+'٪'},
    {key:'partner_profit_share_pct',label:'سهم شریک',value:r=>numberFa(numeric(r.partner_profit_share_pct))+'٪'},
    {key:'effective_from',label:'شروع',value:r=>dateValue(r.effective_from)},{key:'status',label:'وضعیت',value:r=>fa(r.status)}]},
  'partner-finance': {title:'دفتر مالی شریک',eyebrow:'دفتر مالی شریک',description:'فاکتور، دریافت، هزینه و پیش‌پرداخت را با مرجع مشخص ثبت کنید؛ سامانه انتقال بانکی انجام نمی‌دهد.',table:'partner_financial_entries',icon:CreditCard,columns:[
    {key:'recognized_on',label:'تاریخ',value:r=>dateValue(r.recognized_on)},{key:'entry_type',label:'نوع سند',value:r=>fa(r.entry_type)},
    {key:'supplier_id',label:'شریک',value:(r,refs)=>refName(refs.suppliers,r.supplier_id,'name')},
    {key:'amount',label:'مبلغ',value:r=>moneyFa(numeric(r.amount))},{key:'paid_amount',label:'پرداخت ثبت‌شده',value:r=>moneyFa(numeric(r.paid_amount))},
    {key:'external_reference',label:'مرجع'},{key:'status',label:'وضعیت',value:r=>fa(r.status)}]},
  'partner-settlements': {title:'دوره‌ها و تسویه شریک',eyebrow:'دوره‌ها و تسویه شریک',description:'دوره را از دفتر مالی محاسبه کنید. پرداخت فقط با مرجع واقعی و کنترل وجه ثبت‌شده قابل ثبت است.',table:'partner_settlement_periods',icon:CreditCard,columns:[
    {key:'period_start',label:'شروع دوره',value:r=>dateValue(r.period_start)},{key:'period_end',label:'پایان دوره',value:r=>dateValue(r.period_end)},
    {key:'supplier_id',label:'شریک',value:(r,refs)=>refName(refs.suppliers,r.supplier_id,'name')},
    {key:'collected_revenue',label:'وصول‌شده',value:r=>moneyFa(numeric(r.collected_revenue))},
    {key:'approved_shared_expenses',label:'هزینه مشترک',value:r=>moneyFa(numeric(r.approved_shared_expenses))},
    {key:'net_result',label:'نتیجه خالص',value:r=>moneyFa(numeric(r.net_result))},
    {key:'balance_due_to_partner',label:'سهم قابل پرداخت',value:r=>moneyFa(numeric(r.balance_due_to_partner))},
    {key:'settled_amount',label:'پرداخت ثبت‌شده',value:r=>moneyFa(numeric(r.settled_amount))},{key:'status',label:'وضعیت',value:r=>fa(r.status)}]},
};
const types: Option[] = [
  {value:'farm_product',label:'محصول مزرعه'},{value:'crop',label:'محصول زراعی'},
  {value:'livestock',label:'دام و فرآورده دامی'},{value:'poultry',label:'طیور'},
  {value:'dairy',label:'لبنیات'},{value:'eggs',label:'تخم‌مرغ'},{value:'meat',label:'گوشت'},
  {value:'aquaculture',label:'محصول آبزی‌پروری'},{value:'honey',label:'عسل'},
  {value:'forestry',label:'محصول جنگلی'},{value:'greenhouse',label:'محصول گلخانه‌ای'},
  {value:'orchard',label:'محصول باغی'},{value:'input',label:'نهاده و مواد اولیه'},
  {value:'feed',label:'خوراک و نهاده'},{value:'equipment',label:'تجهیزات'},
  {value:'processed',label:'محصول فرآوری‌شده'},{value:'service',label:'خدمت'},
  {value:'other',label:'سایر محصول'},
];
const siteTypes: Option[] = [
  {value:'crop',label:'کشت زراعی'},{value:'livestock',label:'دامداری'},
  {value:'poultry',label:'پرورش طیور'},{value:'dairy',label:'واحد لبنی'},
  {value:'aquaculture',label:'آبزی‌پروری'},{value:'greenhouse',label:'گلخانه'},
  {value:'orchard',label:'باغ'},{value:'apiary',label:'زنبورستان'},
  {value:'processing',label:'فرآوری'},{value:'warehouse',label:'انبار'},
  {value:'distribution',label:'مرکز توزیع'},{value:'mixed',label:'چندمنظوره'},
  {value:'other',label:'سایر'},
];
const cycleTypes: Option[] = [
  {value:'crop',label:'کشت'},{value:'livestock',label:'دام'},
  {value:'poultry',label:'پرورش طیور'},{value:'dairy',label:'لبنیات'},
  {value:'aquaculture',label:'آبزی‌پروری'},{value:'greenhouse',label:'گلخانه'},
  {value:'orchard',label:'باغ'},{value:'apiary',label:'زنبورداری'},
  {value:'mixed',label:'چندمنظوره'},{value:'other',label:'سایر'},
];
const quantityUnits: Option[] = [
  {value:'عدد',label:'عدد'},{value:'کیلوگرم',label:'کیلوگرم'},{value:'تن',label:'تن'},
  {value:'لیتر',label:'لیتر'},{value:'هکتار',label:'هکتار'},{value:'مترمربع',label:'مترمربع'},
];
const categories: Option[] = [
  {value:'production',label:'تولید'},{value:'quality',label:'کیفیت'},{value:'animal_welfare',label:'سلامت دام و طیور'},
  {value:'inventory',label:'موجودی'},{value:'safety',label:'ایمنی'},{value:'logistics',label:'حمل‌ونقل'},
  {value:'finance',label:'مالی'},{value:'other',label:'سایر'},
];
const finTypes: Option[] = [
  {value:'sale_invoice',label:'فاکتور فروش'},{value:'sale_collection',label:'دریافت فروش'},
  {value:'expense',label:'هزینه'},{value:'partner_advance',label:'پیش‌پرداخت شریک'},
];
const nextFinance: Record<string,string[]> = { draft:['submitted','rejected'],submitted:['approved','rejected'],approved:['posted','rejected'],rejected:['draft'] };

export function OperationsWorkspacePage({kind,membership,search}:{kind:OperationsKind;membership:Membership;search:string}) {
  const cfg=configs[kind];
  const manager=membership.role==='owner'||membership.role==='admin';
  const internal=['owner','admin','staff'].includes(membership.role);
  const [rows,setRows]=useState<Row[]>([]);
  const [refs,setRefs]=useState<RefData>(emptyRefs);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [openForm,setOpenForm]=useState(false);
  const [draft,setDraft]=useState<Record<string,unknown>>({});
  const [evidenceTask,setEvidenceTask]=useState('');
  const [evidenceType,setEvidenceType]=useState('note');
  const [evidenceNote,setEvidenceNote]=useState('');
  const [measurement,setMeasurement]=useState('');
  const [unit,setUnit]=useState('');
  const [evidenceFile,setEvidenceFile]=useState<File|null>(null);
  const [uploadAgreementId,setUploadAgreementId]=useState('');
  const [paymentPeriod,setPaymentPeriod]=useState<Row|null>(null);
  const [paymentAmount,setPaymentAmount]=useState('');
  const [paymentRef,setPaymentRef]=useState('');
  const [periodStart,setPeriodStart]=useState('');
  const [periodEnd,setPeriodEnd]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try {
      const data=await api.get<{rows:Row[];refs:RefData}>(`/api/operations/${kind}?companyId=${encodeURIComponent(membership.company_id)}`);
      setRows((data.rows??[]) as Row[]);
      setRefs(data.refs??emptyRefs);
    } catch(caught) {
      setError(caught instanceof Error?caught.message:'خواندن عملیات انجام نشد.');
      setRows([]);
      setRefs(emptyRefs);
    } finally {setLoading(false);}
  };
  useEffect(()=>{void load();},[kind,membership.company_id,membership.role]);

  const fields: Field[]=useMemo(()=>{
    const suppliers=refs.suppliers.map(supplierOpt);
    const sites=refs.sites.filter(r=>r.active!==false).map(siteOpt);
    const batches=refs.batches.map(batchOpt);
    const templates=refs.templates.filter(r=>r.status==='approved').map(r=>({value:String(r.id),label:String(r.template_code)+' · '+String(r.title)}));
    const agreements=refs.agreements.filter(r=>['active','suspended','expired','terminated'].includes(String(r.status))).map(agreementOpt);
    const map: Record<OperationsKind,Field[]> = {
      'farm-sites':[
        {name:'site_code',label:'کد یکتای سایت',required:true},{name:'name',label:'نام مزرعه یا واحد',required:true},
        {name:'site_type',label:'نوع فعالیت',type:'select',required:true,options:siteTypes,defaultValue:'mixed'},
        {name:'supplier_id',label:'مسئول / شریک (اختیاری)',type:'select',options:suppliers},
        {name:'province',label:'استان'},{name:'city',label:'شهر'},
        {name:'latitude',label:'عرض جغرافیایی',type:'number',min:'-90',max:'90',step:'0.000001'},
        {name:'longitude',label:'طول جغرافیایی',type:'number',min:'-180',max:'180',step:'0.000001'},
        {name:'address',label:'نشانی',type:'textarea',full:true},{name:'registration_reference',label:'شناسه یا مجوز'},
        {name:'license_expires_on',label:'تاریخ انقضای مجوز',type:'date'},
      ],
      'flock-cycles':[
        {name:'farm_site_id',label:'سایت مزرعه',type:'select',required:true,options:sites},{name:'cycle_code',label:'کد چرخه',required:true},
        {name:'cycle_type',label:'نوع چرخه',type:'select',required:true,options:cycleTypes,defaultValue:'mixed'},
        {name:'species',label:'گونه یا محصول',required:true,helper:'برای مثال: گندم، گوجه، مرغ، گوسفند یا ماهی'},
        {name:'arrived_on',label:'تاریخ شروع',type:'date'},{name:'planned_end_on',label:'پایان برنامه‌ای',type:'date'},
        {name:'initial_quantity',label:'مقدار اولیه',type:'number',min:'0',step:'0.001'},
        {name:'quantity_unit',label:'واحد مقدار',type:'select',required:true,options:quantityUnits,defaultValue:'عدد'},
        {name:'notes',label:'یادداشت',type:'textarea',full:true},
      ],
      'production-batches':[
        {name:'farm_site_id',label:'سایت مزرعه',type:'select',required:true,options:sites},{name:'batch_code',label:'کد بچ',required:true},
        {name:'production_kind',label:'نوع محصول',type:'select',options:types,required:true},
        {name:'product_id',label:'محصول در کاتالوگ',type:'select',options:refs.products.map(r=>({value:String(r.id),label:String(r.name??r.sku??r.id)}))},
        {name:'unit',label:'واحد',required:true,defaultValue:'کیلوگرم'},{name:'planned_quantity',label:'مقدار برنامه',type:'number',min:'0',step:'0.001'},
        {name:'started_on',label:'تاریخ شروع',type:'date'},{name:'expected_on',label:'تاریخ پایان مورد انتظار',type:'date'},
        {name:'manager_notes',label:'یادداشت مدیر',type:'textarea',full:true},
      ],
      'daily-production':[
        {name:'batch_id',label:'بچ تولید',type:'select',options:batches,required:true},
        {name:'record_date',label:'تاریخ ثبت',type:'date',required:true,defaultValue:new Date().toISOString().slice(0,10)},
        {name:'shift_label',label:'شیفت / نوبت',defaultValue:'روزانه',required:true},
        {name:'resource_name',label:'منبع مصرفی',helper:'نام نهاده یا منبع اصلی مصرف‌شده'},
        {name:'input_quantity',label:'مقدار مصرف',type:'number',min:'0',step:'0.001',defaultValue:'0'},
        {name:'input_unit',label:'واحد مصرف',type:'select',required:true,options:quantityUnits,defaultValue:'کیلوگرم'},
        {name:'loss_quantity',label:'ضایعات / تلفات',type:'number',min:'0',step:'0.001',defaultValue:'0'},
        {name:'loss_unit',label:'واحد ضایعات',type:'select',required:true,options:quantityUnits,defaultValue:'عدد'},
        {name:'produced_quantity',label:'مقدار خروجی',type:'number',min:'0',step:'0.001'},
        {name:'rejected_quantity',label:'مقدار مردودی',type:'number',min:'0',step:'0.001',defaultValue:'0',helper:'باید صفر باشد یا از خروجی ثبت‌شده بیشتر نباشد'},
        {name:'note',label:'یادداشت',type:'textarea',full:true},
      ],
      'task-templates':[
        {name:'template_code',label:'کد دستورالعمل',required:true},{name:'version',label:'نسخه',type:'number',min:'1',step:'1',defaultValue:'1',required:true},
        {name:'title',label:'عنوان',required:true},{name:'category',label:'گروه',defaultValue:'operations'},
        {name:'priority',label:'اولویت',type:'select',options:priorities,defaultValue:'normal',required:true},
        {name:'instructions',label:'مراحل انجام',type:'textarea',required:true,full:true},
        {name:'evidence_required',label:'مدرک برای تکمیل اجباری است',type:'checkbox',defaultValue:false},
        {name:'expected_evidence_types',label:'انواع مدرک مورد انتظار',type:'multi',options:evidenceTypes},
      ],
      'operational-tasks':[
        {name:'farm_site_id',label:'سایت مربوط',type:'select',options:sites},{name:'batch_id',label:'بچ مرتبط',type:'select',options:batches},
        {name:'template_id',label:'دستورالعمل تأییدشده',type:'select',options:templates},
        {name:'assignee_supplier_id',label:'تأمین‌کننده مسئول',type:'select',options:suppliers,required:true},
        {name:'title',label:'عنوان وظیفه',required:true},{name:'instructions_snapshot',label:'مراحل یا توضیحات',type:'textarea',full:true},
        {name:'category',label:'گروه',defaultValue:'operations'},{name:'priority',label:'اولویت',type:'select',options:priorities,defaultValue:'normal'},
        {name:'due_at',label:'مهلت انجام',type:'datetime-local'},{name:'evidence_required',label:'مدرک برای تکمیل اجباری است',type:'checkbox',defaultValue:false},
      ],
      incidents:[
        {name:'farm_site_id',label:'سایت مزرعه',type:'select',options:sites},{name:'batch_id',label:'بچ مرتبط',type:'select',options:batches},
        {name:'category',label:'گروه رخداد',type:'select',options:categories,required:true},
        {name:'severity',label:'شدت',type:'select',options:[{value:'low',label:'کم'},{value:'medium',label:'متوسط'},{value:'high',label:'بالا'},{value:'critical',label:'بحرانی'}],defaultValue:'medium'},
        {name:'title',label:'عنوان رخداد',required:true},{name:'description',label:'شرح رخداد',type:'textarea',full:true},
      ],
      'partnership-agreements':[
        {name:'supplier_id',label:'شریک',type:'select',options:suppliers,required:true},{name:'agreement_code',label:'کد قرارداد',required:true},
        {name:'effective_from',label:'شروع اعتبار',type:'date',required:true},{name:'effective_to',label:'پایان اعتبار',type:'date'},
        {name:'company_profit_share_pct',label:'سهم شرکت (درصد)',type:'number',min:'0',max:'100',step:'0.01',defaultValue:'50',required:true},
        {name:'partner_profit_share_pct',label:'سهم شریک (درصد)',type:'number',min:'0',max:'100',step:'0.01',defaultValue:'50',required:true},
        {name:'settlement_basis',label:'مبنای محاسبه',type:'select',options:[{value:'collected_cash',label:'وجه وصول‌شده'},{value:'accrual',label:'تعهدی'}],defaultValue:'collected_cash'},
        {name:'settlement_due_days',label:'مهلت تسویه (روز)',type:'number',min:'0',max:'365',step:'1',defaultValue:'14'},
        {name:'shared_expense_categories',label:'دسته هزینه‌های مشترک',type:'multi',options:expenses,required:true,helper:'قرارداد بدون دسته هزینه مشترک فعال نمی‌شود.'},
      ],
      'partner-finance':[
        {name:'supplier_id',label:'شریک',type:'select',options:suppliers,required:true},{name:'agreement_id',label:'قرارداد مبنا',type:'select',options:agreements,required:true},
        {name:'entry_type',label:'نوع سند',type:'select',options:finTypes,required:true},{name:'amount',label:'مبلغ کل (تومان)',type:'number',min:'1',step:'1',required:true},
        {name:'expense_category',label:'دسته هزینه',type:'select',options:expenses},{name:'is_shared_cost',label:'هزینه طبق قرارداد مشترک است',type:'checkbox',defaultValue:false},
        {name:'paid_by',label:'پرداخت‌کننده هزینه',type:'select',options:[{value:'none',label:'ثبت نشده'},{value:'company',label:'شرکت'},{value:'partner',label:'شریک'},{value:'customer',label:'مشتری'},{value:'vendor',label:'فروشنده'},{value:'third_party',label:'شخص ثالث'}],defaultValue:'none'},
        {name:'paid_amount',label:'مبلغ پرداخت شده',type:'number',min:'0',step:'1',defaultValue:'0'},
        {name:'external_reference',label:'شماره رسید / مرجع'},{name:'recognized_on',label:'تاریخ مالی',type:'date',required:true,defaultValue:new Date().toISOString().slice(0,10)},
        {name:'linked_entry_id',label:'فاکتور مرجع برای دریافت',type:'select',options:refs.financeEntries.filter(e=>e.entry_type==='sale_invoice'&&e.status==='posted').map(e=>({value:String(e.id),label:String(e.external_reference??e.id)+' · '+moneyFa(numeric(e.amount))}))},
        {name:'notes',label:'توضیحات',type:'textarea',full:true},
      ],
      'partner-settlements':[],
    };
    return map[kind];
  },[kind,refs]);

  const filtered=useMemo(()=>{
    const q=search.trim().toLocaleLowerCase();
    if(!q)return rows;
    return rows.filter(r=>Object.values(r).some(v=>String(v??'').toLocaleLowerCase().includes(q)));
  },[rows,search]);

  const assignDraft=(key:string,value:unknown)=>setDraft(old=>({...old,[key]:value}));
  const closeForm=()=>{setOpenForm(false);setDraft({});};

  const submitCreate=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    setBusy(true);setError('');setNotice('');
    const str=(k:string)=>draft[k]===undefined||draft[k]===null?'':String(draft[k]).trim();
    const num=(k:string)=>draft[k]===''||draft[k]===undefined||draft[k]===null?null:Number(draft[k]);
    const date=(k:string)=>str(k)||null;
    const yes=(k:string)=>draft[k]===true;
    const base:Record<string,unknown>={company_id:membership.company_id};
    let payload:Record<string,unknown>=base;
    if(kind==='farm-sites' && Boolean(str('latitude'))!==Boolean(str('longitude'))){
      setBusy(false);setError('برای نمایش سایت روی نقشه، عرض و طول جغرافیایی را با هم وارد کن.');return;
    }
    if(kind==='flock-cycles' && str('cycle_type')==='poultry' && num('initial_quantity')!==null && !Number.isInteger(num('initial_quantity'))){
      setBusy(false);setError('تعداد اولیه طیور باید عدد صحیح باشد.');return;
    }
    if(kind==='daily-production'){
      const output=num('produced_quantity');
      const rejected=num('rejected_quantity')??0;
      if(rejected>0 && (output===null || rejected>output)){
        setBusy(false);setError('مقدار مردودی باید صفر باشد یا از مقدار خروجی ثبت‌شده بیشتر نباشد.');return;
      }
    }
    if(kind==='incidents' && membership.role==='supplier'){
      const site=refs.sites.find(r=>String(r.id)===str('farm_site_id')&&String(r.supplier_id)===String(membership.supplier_id));
      if(!site){setBusy(false);setError('برای ثبت رخداد از حساب تأمین‌کننده، سایت متعلق به همان تأمین‌کننده را انتخاب کن.');return;}
    }
    if(kind==='farm-sites'){
      payload={...base,site_code:str('site_code'),name:str('name'),site_type:str('site_type')||'mixed',
        supplier_id:str('supplier_id')||null,province:str('province')||'نامشخص',
        city:str('city')||null,latitude:num('latitude'),longitude:num('longitude'),
        address:str('address')||null,registration_reference:str('registration_reference')||null,
        license_expires_on:date('license_expires_on'),created_by:membership.user_id,active:true};
    }else if(kind==='flock-cycles'){
      payload={...base,farm_site_id:str('farm_site_id'),cycle_code:str('cycle_code'),arrived_on:date('arrived_on'),planned_end_on:date('planned_end_on'),
        cycle_type:str('cycle_type')||'mixed',species:str('species'),initial_quantity:num('initial_quantity'),
        quantity_unit:str('quantity_unit')||'عدد',initial_bird_count:str('cycle_type')==='poultry'?num('initial_quantity'):null,
        notes:str('notes')||null,status:'planned',created_by:membership.user_id};
    }else if(kind==='production-batches'){
      const site=refs.sites.find(r=>String(r.id)===str('farm_site_id'));
      payload={...base,farm_site_id:str('farm_site_id'),supplier_id:site?.supplier_id??null,batch_code:str('batch_code'),
        production_kind:str('production_kind'),product_id:str('product_id')||null,unit:str('unit')||'کیلوگرم',
        planned_quantity:num('planned_quantity'),produced_quantity:0,rejected_quantity:0,started_on:date('started_on'),expected_on:date('expected_on'),
        manager_notes:str('manager_notes')||null,status:'planned',quality_status:'not_inspected',created_by:membership.user_id};
    }else if(kind==='daily-production'){
      const inputQty=num('input_quantity')??0, inputUnit=str('input_unit')||'کیلوگرم';
      const lossQty=num('loss_quantity')??0, lossUnit=str('loss_unit')||'عدد';
      const output=num('produced_quantity'), rejected=num('rejected_quantity')??0;
      const selectedBatch=refs.batches.find(r=>String(r.id)===str('batch_id'));
      const animalKind=['livestock','poultry','dairy','aquaculture'].includes(String(selectedBatch?.production_kind??''));
      const isFeed=['خوراک','feed'].includes(str('resource_name').toLocaleLowerCase()) && inputUnit==='کیلوگرم';
      payload={...base,batch_id:str('batch_id'),record_date:str('record_date'),shift_label:str('shift_label')||'روزانه',
        resource_name:str('resource_name')||null,input_quantity:inputQty,input_unit:inputUnit,
        loss_quantity:lossQty,loss_unit:lossUnit,rejected_quantity:rejected,
        feed_consumed_kg:isFeed?inputQty:0,mortality_count:animalKind && lossUnit==='عدد'?Math.trunc(lossQty):0,
        eggs_collected:0,eggs_rejected:0,produced_quantity:output,average_weight_grams:null,
        note:str('note')||null,recorded_by:membership.user_id};
    }else if(kind==='task-templates'){
      payload={...base,template_code:str('template_code'),version:num('version')??1,title:str('title'),instructions:str('instructions'),
        category:str('category')||'operations',priority:str('priority')||'normal',evidence_required:yes('evidence_required'),
        expected_evidence_types:Array.isArray(draft.expected_evidence_types)?draft.expected_evidence_types:[],status:'draft',created_by:membership.user_id};
    }else if(kind==='operational-tasks'){
      const template=refs.templates.find(r=>String(r.id)===str('template_id'));
      payload={...base,farm_site_id:str('farm_site_id')||null,batch_id:str('batch_id')||null,template_id:str('template_id')||null,
        assignee_user_id:null,assignee_supplier_id:str('assignee_supplier_id'),assigned_by:membership.user_id,title:str('title')||String(template?.title??''),
        instructions_snapshot:str('instructions_snapshot')||String(template?.instructions??''),category:str('category')||String(template?.category??'operations'),
        priority:str('priority')||String(template?.priority??'normal'),due_at:str('due_at')?new Date(String(draft.due_at)).toISOString():null,
        evidence_required:yes('evidence_required')||Boolean(template?.evidence_required),status:'pending'};
    }else if(kind==='incidents'){
      const site=refs.sites.find(r=>String(r.id)===str('farm_site_id'));
      payload={...base,farm_site_id:str('farm_site_id')||null,batch_id:str('batch_id')||null,category:str('category'),severity:str('severity')||'medium',
        title:str('title'),description:str('description')||'',status:'open',reported_by:membership.user_id,
        reported_supplier_id:membership.role==='supplier'?membership.supplier_id:(site?.supplier_id??null)};
    }else if(kind==='partnership-agreements'){
      const companyShare=num('company_profit_share_pct')??50;
      const partnerShare=num('partner_profit_share_pct')??50;
      const shared=Array.isArray(draft.shared_expense_categories)?draft.shared_expense_categories as string[]:[];
      if(Math.abs(companyShare+partnerShare-100)>0.0001){setBusy(false);setError('سهم شرکت و شریک باید در مجموع ۱۰۰ درصد باشد.');return;}
      if(!shared.length){setBusy(false);setError('حداقل یک دسته هزینه مشترک انتخاب کن.');return;}
      payload={...base,supplier_id:str('supplier_id'),agreement_code:str('agreement_code'),version:1,status:'draft',
        effective_from:str('effective_from'),effective_to:date('effective_to'),company_profit_share_pct:companyShare,partner_profit_share_pct:partnerShare,
        shared_expense_categories:shared,settlement_basis:str('settlement_basis')||'collected_cash',settlement_due_days:num('settlement_due_days')??14,created_by:membership.user_id};
    }else if(kind==='partner-finance'){
      const entryType=str('entry_type');const amount=num('amount')??0;const paidInput=num('paid_amount')??0;
      const expense=entryType==='expense';const collection=entryType==='sale_collection';const advance=entryType==='partner_advance';
      const paidAmount=collection||advance?amount:paidInput;
      const paymentStatus=collection||advance?'paid':paidAmount<=0?(expense?'unpaid':'not_applicable'):paidAmount>=amount?'paid':'partial';
      if(paidAmount>amount){setBusy(false);setError('مبلغ پرداخت‌شده نمی‌تواند از مبلغ کل سند بیشتر باشد.');return;}
      if(expense&&!str('expense_category')){setBusy(false);setError('برای هزینه، دسته هزینه لازم است.');return;}
      if(expense&&yes('is_shared_cost')){
        const agreement=refs.agreements.find(r=>String(r.id)===str('agreement_id'));
        const allowed=Array.isArray(agreement?.shared_expense_categories)?agreement.shared_expense_categories.map(String):[];
        if(!allowed.includes(str('expense_category'))){setBusy(false);setError('این دسته هزینه در قرارداد به‌عنوان هزینه مشترک تعیین نشده است.');return;}
      }
      if(collection&&!str('linked_entry_id')){setBusy(false);setError('دریافت فروش باید به فاکتور ثبت‌شده متصل باشد.');return;}
      if((collection||advance)&&!str('external_reference')){setBusy(false);setError('شماره رسید یا مرجع واقعی لازم است.');return;}
      payload={...base,supplier_id:str('supplier_id'),agreement_id:str('agreement_id'),entry_type:entryType,status:'draft',
        direction:collection?'inflow_to_company':advance?'company_to_partner':'not_cash',amount,paid_amount:paidAmount,currency:'TOMAN',
        expense_category:expense?str('expense_category'):null,is_shared_cost:expense&&yes('is_shared_cost'),
        paid_by:collection?'customer':advance?'company':expense?(str('paid_by')||'none'):'none',payment_status:paymentStatus,
        recognized_on:str('recognized_on'),external_reference:str('external_reference')||null,linked_entry_id:collection?str('linked_entry_id')||null:null,
        notes:str('notes')||null,created_by:membership.user_id};
    }
    try {
      await api.post(`/api/operations/${kind}`,payload);
      closeForm();setNotice('رکورد با موفقیت ثبت شد.');await load();
    } catch(caught) {
      setError(caught instanceof Error?caught.message:'ثبت رکورد انجام نشد.');
    } finally {setBusy(false);}
  };

  const action=async(run:()=>PromiseLike<{error:{message:string}|null}>,success:string)=>{
    setBusy(true);setError('');setNotice('');
    const result=await run();
    setBusy(false);
    if(result.error){setError(result.error.message);return;}
    setNotice(success);await load();
  };
  const updateRow=(table:string,id:unknown,patch:Record<string,unknown>)=>{
    if(!supabase)return Promise.resolve({error:{message:'Supabase تنظیم نشده است.'}});
    return supabase.from(table).update(patch).eq('company_id',membership.company_id).eq('id',String(id));
  };
  const assigned=(row:Row)=>membership.role==='supplier'
    ? String(row.assignee_supplier_id)===String(membership.supplier_id)
    : String(row.assignee_user_id)===String(membership.user_id)||manager;
  const startTask=(row:Row)=>action(
    ()=>supabase?supabase.rpc('start_operational_task',{_task:String(row.id)}):Promise.resolve({error:{message:'Supabase تنظیم نشده است.'}}),
    'وظیفه شروع شد.'
  );
  const submitTask=(row:Row)=>{
    const note=window.prompt('یادداشت تکمیل کار (اختیاری):')??'';
    return action(()=>supabase?supabase.rpc('submit_operational_task',{_task:String(row.id),_completion_note:note}):Promise.resolve({error:{message:'Supabase تنظیم نشده است.'}}),'وظیفه برای بازبینی ارسال شد.');
  };
  const reviewTask=(row:Row,decision:'approved'|'rejected')=>{
    const note=window.prompt(decision==='approved'?'یادداشت تأیید (اختیاری):':'علت رد و اقدام اصلاحی:')??'';
    if(decision==='rejected'&&!note.trim()){setError('برای رد وظیفه باید دلیل ثبت شود.');return;}
    void action(()=>supabase?supabase.rpc('review_operational_task',{_task:String(row.id),_decision:decision,_review_note:note}):Promise.resolve({error:{message:'Supabase تنظیم نشده است.'}}),decision==='approved'?'وظیفه تأیید شد.':'وظیفه رد شد و نیازمند اصلاح است.');
  };
  const approveTemplate=(row:Row)=>void action(()=>updateRow('task_templates',row.id,{status:'approved'}),'دستورالعمل تأیید و قفل نسخه شد.');
  const startBatch=(row:Row)=>void action(()=>updateRow('production_batches',row.id,{status:'active',started_on:row.started_on??new Date().toISOString().slice(0,10)}),'بچ تولید آغاز شد.');
  const resolveIncident=(row:Row)=>{
    const note=window.prompt('اقدام اصلاحی برای رفع رخداد:');
    if(!note?.trim()){setError('برای بستن رخداد، اقدام اصلاحی لازم است.');return;}
    void action(()=>updateRow('operational_incidents',row.id,{status:'resolved',resolution_note:note.trim(),resolved_by:membership.user_id,resolved_at:new Date().toISOString()}),'اقدام اصلاحی ثبت شد.');
  };
  const financeTransition=(row:Row,next:string)=>{
    if(next==='posted'&&['sale_collection','partner_advance','settlement_payment'].includes(String(row.entry_type))
      &&(String(row.payment_status)!=='paid'||numeric(row.paid_amount)!==numeric(row.amount)||!String(row.external_reference??'').trim())){
      setError('ثبت نهایی این سند به مبلغ پرداخت‌شده کامل و مرجع رسید واقعی نیاز دارد.');return;
    }
    void action(()=>updateRow('partner_financial_entries',row.id,{status:next}),'وضعیت سند به «'+fa(next)+'» تغییر کرد.');
  };
  const createPeriod=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();
    if(!supabase||!draft.agreement_id||!periodStart||!periodEnd){setError('قرارداد و بازه تاریخ را کامل کن.');return;}
    setBusy(true);setError('');setNotice('');
    const result=await supabase.rpc('create_partner_settlement_period',{_agreement:String(draft.agreement_id),_period_start:periodStart,_period_end:periodEnd});
    setBusy(false);if(result.error){setError(result.error.message);return;}
    setOpenForm(false);setDraft({});setNotice('دوره پیش‌نویس از اسناد واقعی ایجاد شد.');await load();
  };
  const openPeriod=()=>{
    const first=refs.agreements.find(a=>['active','suspended','expired','terminated'].includes(String(a.status)));
    setDraft({agreement_id:first?.id?String(first.id):''});setPeriodStart('');setPeriodEnd('');setError('');setOpenForm(true);
  };
  const refreshPeriod=(row:Row)=>void action(()=>supabase?supabase.rpc('refresh_partner_settlement_period',{_period:String(row.id)}):Promise.resolve({error:{message:'Supabase تنظیم نشده است.'}}),'محاسبات دوره از دفتر مالی بازخوانی شد.');
  const approvePeriod=(row:Row)=>void action(()=>supabase?supabase.rpc('approve_partner_settlement_period',{_period:String(row.id)}):Promise.resolve({error:{message:'Supabase تنظیم نشده است.'}}),'دوره تسویه تأیید و قفل شد.');
  const payPeriod=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();if(!supabase||!paymentPeriod)return;
    setBusy(true);setError('');setNotice('');
    const result=await supabase.rpc('record_partner_settlement_payment',{_period:String(paymentPeriod.id),_amount:Number(paymentAmount),_payment_reference:paymentRef.trim()});
    setBusy(false);if(result.error){setError(result.error.message);return;}
    setPaymentPeriod(null);setPaymentAmount('');setPaymentRef('');setNotice('مرجع پرداخت به دفتر داخلی ثبت شد؛ سامانه وجه را منتقل نمی‌کند.');await load();
  };
  const addEvidence=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();if(!supabase||!evidenceTask)return;
    setBusy(true);setError('');setNotice('');
    let path:string|null=null;
    if(evidenceType==='photo'||evidenceType==='document'){
      if(!evidenceFile){setBusy(false);setError('برای عکس یا سند، فایل انتخاب کن.');return;}
      const filename=evidenceFile.name.replace(/[^\w.-]/g,'_');
      path=membership.company_id+'/'+evidenceTask+'/'+Date.now()+'-'+filename;
      const uploaded=await supabase.storage.from('operational-evidence').upload(path,evidenceFile,{upsert:false,contentType:evidenceFile.type});
      if(uploaded.error){setBusy(false);setError(uploaded.error.message);return;}
    }
    const payload:Record<string,unknown>={company_id:membership.company_id,task_id:evidenceTask,evidence_type:evidenceType,
      storage_path:path,note:evidenceNote.trim()||null,uploaded_by:membership.user_id,
      measurement_value:evidenceType==='measurement'?Number(measurement):null,measurement_unit:evidenceType==='measurement'?(unit.trim()||null):null};
    const result=await supabase.from('task_evidence').insert(payload);
    setBusy(false);if(result.error){if(path){await supabase.storage.from('operational-evidence').remove([path]);}setError(result.error.message);return;}
    setEvidenceTask('');setEvidenceType('note');setEvidenceNote('');setMeasurement('');setUnit('');setEvidenceFile(null);
    setNotice('مدرک به وظیفه متصل شد.');await load();
  };
  const uploadAgreement=async(e:ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];e.target.value='';
    if(!supabase||!file||!uploadAgreementId)return;
    const agreement=rows.find(r=>String(r.id)===uploadAgreementId);if(!agreement){setError('قرارداد پیدا نشد.');return;}
    if(!['application/pdf','image/jpeg','image/png'].includes(file.type)){setError('فقط PDF، JPG و PNG مجاز است.');return;}
    setBusy(true);setError('');setNotice('');
    const filename=file.name.replace(/[^\w.-]/g,'_');
    const path=membership.company_id+'/'+String(agreement.supplier_id)+'/'+Date.now()+'-'+filename;
    const up=await supabase.storage.from('contract-documents').upload(path,file,{upsert:false,contentType:file.type});
    if(up.error){setBusy(false);setError(up.error.message);return;}
    const result=await updateRow('partnership_agreements',agreement.id,{signed_document_path:path,signed_at:new Date().toISOString(),status:'active'});
    setBusy(false);if(result.error){await supabase.storage.from('contract-documents').remove([path]);setError(result.error.message);return;}
    setUploadAgreementId('');setNotice('سند امضاشده بارگذاری شد؛ فعال‌سازی در دیتابیس کنترل شد.');await load();
  };

  const canCreate=()=>{
    if(kind==='partner-settlements'||kind==='partner-finance'||kind==='partnership-agreements'||kind==='task-templates')return manager;
    if(['farm-sites','flock-cycles','production-batches','operational-tasks'].includes(kind))return internal;
    if(kind==='daily-production'||kind==='incidents')return internal||membership.role==='supplier';
    return false;
  };
  const headingAction=kind==='partner-settlements'
    ? (manager?<button className="button-primary" onClick={openPeriod}><Plus size={16}/> ایجاد دوره تسویه</button>:null)
    : canCreate()?<button className="button-primary" onClick={()=>{const init:Record<string,unknown>={};fields.forEach(f=>{if(f.defaultValue!==undefined)init[f.name]=f.defaultValue;});setDraft(init);setOpenForm(true);setError('');}}><Plus size={16}/> ثبت رکورد</button>:null;
  const visibleFields=fields.filter(field=>{
    if(kind!=='partner-finance')return true;
    const type=String(draft.entry_type??'sale_invoice');
    if(['expense_category','is_shared_cost','paid_by','paid_amount'].includes(field.name))return type==='expense'||type==='partner_advance';
    if(field.name==='linked_entry_id')return type==='sale_collection';
    if(field.name==='external_reference')return type==='sale_collection'||type==='partner_advance';
    return true;
  });

  const rowActions=(row:Row)=>{
    const buttons:{label:string;fn:()=>void;tone?:string}[]=[];
    if(kind==='task-templates'&&manager&&row.status==='draft')buttons.push({label:'تأیید دستورالعمل',fn:()=>approveTemplate(row)});
    if(kind==='operational-tasks'){
      const mine=assigned(row);
      if(mine&&['pending','rejected','blocked'].includes(String(row.status)))buttons.push({label:'شروع کار',fn:()=>void startTask(row)});
      if(mine&&row.status==='in_progress'){buttons.push({label:'ثبت مدرک',tone:'soft',fn:()=>setEvidenceTask(String(row.id))});buttons.push({label:'ارسال برای بررسی',fn:()=>void submitTask(row)});}
      if(manager&&row.status==='submitted'){buttons.push({label:'تأیید',fn:()=>reviewTask(row,'approved')});buttons.push({label:'رد با دلیل',tone:'danger',fn:()=>reviewTask(row,'rejected')});}
    }
    if(kind==='production-batches'&&manager&&row.status==='planned')buttons.push({label:'شروع تولید',fn:()=>startBatch(row)});
    if(kind==='incidents'&&manager&&['open','investigating','action_required'].includes(String(row.status))){
      if(row.status==='open')buttons.push({label:'شروع بررسی',tone:'soft',fn:()=>void action(()=>updateRow('operational_incidents',row.id,{status:'investigating'}),'رخداد وارد مرحله بررسی شد.')});
      buttons.push({label:'ثبت رفع رخداد',fn:()=>resolveIncident(row)});
    }
    if(kind==='partnership-agreements'&&manager){
      if(row.status==='draft')buttons.push({label:'ارسال برای امضا',tone:'soft',fn:()=>void action(()=>updateRow('partnership_agreements',row.id,{status:'pending_signature'}),'قرارداد برای امضا آماده شد.')});
      if(row.status==='pending_signature')buttons.push({label:'بارگذاری سند امضا',fn:()=>{setUploadAgreementId(String(row.id));document.getElementById('ops-agreement-file')?.click();}});
      if(row.status==='active')buttons.push({label:'تعلیق قرارداد',tone:'danger',fn:()=>void action(()=>updateRow('partnership_agreements',row.id,{status:'suspended'}),'قرارداد تعلیق شد.')});
      if(row.status==='suspended')buttons.push({label:'فعال‌سازی مجدد',fn:()=>void action(()=>updateRow('partnership_agreements',row.id,{status:'active'}),'درخواست فعال‌سازی بررسی شد.')});
    }
    if(kind==='partner-finance'&&manager)for(const status of nextFinance[String(row.status)]??[])buttons.push({
      label:status==='submitted'?'ارسال':status==='approved'?'تأیید':status==='posted'?'ثبت نهایی':status==='rejected'?'رد':'بازگردانی پیش‌نویس',
      tone:status==='rejected'?'danger':'soft',fn:()=>financeTransition(row,status)});
    if(kind==='partner-settlements'){
      if(manager&&row.status==='draft'){buttons.push({label:'بازمحاسبه',tone:'soft',fn:()=>refreshPeriod(row)});buttons.push({label:'تأیید دوره',fn:()=>approvePeriod(row)});}
      if(manager&&row.status==='approved'&&numeric(row.balance_due_to_partner)>numeric(row.settled_amount))buttons.push({label:'ثبت مدرک پرداخت',fn:()=>{setPaymentPeriod(row);setPaymentAmount(String(numeric(row.balance_due_to_partner)-numeric(row.settled_amount)));}});
    }
    return buttons.length?<div className="ops-actions">{buttons.map((button,index)=><button key={button.label+index} className={'ops-action '+(button.tone??'')} disabled={busy} onClick={button.fn}>{button.label}</button>)}</div>:<span className="ops-muted">—</span>;
  };
  const cell=(row:Row,col:Column)=>{
    const value=col.value?col.value(row,refs):row[col.key];
    if(col.key==='status')return <span className={'ops-status '+statusTone(row.status)}>{text(value)}</span>;
    return text(value);
  };

  return <section className="ops-page" dir="rtl">
    <header className="ops-page-heading">
      <div><span className="ops-eyebrow">{cfg.eyebrow}</span><h1>{cfg.title}</h1><p>{cfg.description}</p></div>
      <div className="ops-heading-actions">{headingAction}<button className="ops-refresh" onClick={()=>void load()} disabled={loading||busy} aria-label="بازخوانی اطلاعات"><RefreshCw size={16}/></button></div>
    </header>
    {(kind==='partner-settlements'||kind==='partner-finance')&&<div className="ops-cash-warning"><ShieldCheck size={18}/><div><b>کنترل دفتر مالی</b><p>عددها از اسناد داخلی محاسبه می‌شوند؛ برنامه وجهی انتقال نمی‌دهد و موجودی بانک را مستقلاً تأیید نمی‌کند.</p></div></div>}
    {kind==='partnership-agreements'&&<div className="ops-cash-warning"><FileCheck2 size={18}/><div><b>قرارداد نسخه‌دار</b><p>فعال‌سازی اولیه نیازمند سند امضا در فضای خصوصی است. شروط قرارداد فعال را تغییر ندهید؛ برای اصلاح، نسخه جدید ثبت کنید.</p></div></div>}
    {error&&<div className="ops-alert error"><AlertTriangle size={17}/><span>{error}</span><button onClick={()=>setError('')} aria-label="بستن خطا"><X size={14}/></button></div>}
    {notice&&<div className="ops-alert success"><CheckCircle2 size={17}/><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="بستن پیام"><X size={14}/></button></div>}
    <div className="ops-table-frame">
      <div className="ops-table-top"><div><b>{cfg.title}</b><span>{numberFa(filtered.length)} رکورد</span></div><small>فقط داده‌های مجاز و واقعی نمایش داده می‌شوند.</small></div>
      {loading?<div className="ops-loading"><span className="spinner small"/>در حال دریافت اطلاعات…</div>
      :!filtered.length?<div className="ops-empty"><span className="ops-empty-icon"><cfg.icon size={24}/></span><b>{error?'داده بارگذاری نشد':'هنوز رکوردی وجود ندارد'}</b><p>{error?'خطا را بررسی کن و دوباره تلاش کن.':'داده نمونه‌ای به صورت خودکار ساخته نمی‌شود؛ پس از ثبت رکورد واقعی سوابق اینجا می‌آیند.'}</p>{canCreate()&&kind!=='partner-settlements'&&<button className="button-soft" onClick={()=>{const init:Record<string,unknown>={};fields.forEach(f=>{if(f.defaultValue!==undefined)init[f.name]=f.defaultValue;});setDraft(init);setOpenForm(true);}}><Plus size={15}/> ثبت اولین رکورد</button>}</div>
      :<div className="ops-table-scroll"><table className="ops-table"><thead><tr>{cfg.columns.map(c=><th key={c.key}>{c.label}</th>)}<th>اقدام مجاز</th></tr></thead><tbody>{filtered.map(row=><tr key={String(row.id)}>{cfg.columns.map(c=><td key={c.key}>{cell(row,c)}</td>)}<td>{rowActions(row)}</td></tr>)}</tbody></table></div>}
    </div>

    {openForm&&<div className="ops-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget){setOpenForm(false);setDraft({});}}}>
      <div className="ops-modal" role="dialog" aria-modal="true" aria-label={'ثبت رکورد '+cfg.title}>
        <header><div><span className="ops-eyebrow">ثبت رکورد جدید</span><h2>{kind==='partner-settlements'?'ایجاد دوره تسویه':'ثبت '+cfg.title}</h2><p>وضعیت اولیه و مجوزها توسط PostgreSQL کنترل می‌شوند.</p></div><button className="ops-refresh" onClick={()=>{setOpenForm(false);setDraft({});}} aria-label="بستن"><X size={18}/></button></header>
        {kind==='partner-settlements'
          ?<form className="ops-form" onSubmit={createPeriod}>
            <label className="ops-field full"><span>قرارداد امضاشده</span><select required value={String(draft.agreement_id??'')} onChange={e=>assignDraft('agreement_id',e.target.value)}><option value="">انتخاب قرارداد</option>{refs.agreements.filter(a=>['active','suspended','expired','terminated'].includes(String(a.status))).map(a=><option value={String(a.id)} key={String(a.id)}>{String(a.agreement_code)} · نسخه {String(a.version)}</option>)}</select></label>
            <label className="ops-field"><span>شروع دوره</span><input type="date" required value={periodStart} onChange={e=>setPeriodStart(e.target.value)}/></label>
            <label className="ops-field"><span>پایان دوره</span><input type="date" required min={periodStart||undefined} max={new Date().toISOString().slice(0,10)} value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)}/></label>
            <div className="ops-form-foot"><span>دوره آینده یا هم‌پوشان توسط دیتابیس رد می‌شود.</span><button className="button-primary" type="submit" disabled={busy}>{busy?'در حال ثبت…':'محاسبه و ایجاد دوره'}</button></div>
          </form>
          :<form className="ops-form" onSubmit={submitCreate}>
            {visibleFields.map(field=><FieldControl key={field.name} field={field} value={draft[field.name]} onChange={v=>assignDraft(field.name,v)}/>)}
            <div className="ops-form-foot"><span>مقادیر حساس و وضعیت اولیه در سمت دیتابیس بررسی می‌شوند.</span><button className="button-primary" type="submit" disabled={busy}>{busy?'در حال ثبت…':'ثبت رکورد'}</button></div>
          </form>}
      </div>
    </div>}

    {evidenceTask&&<div className="ops-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setEvidenceTask('');}}>
      <div className="ops-modal compact" role="dialog" aria-modal="true" aria-label="ثبت مدرک وظیفه">
        <header><div><span className="ops-eyebrow">مستندات انجام کار</span><h2>ثبت مدرک انجام کار</h2><p>فایل‌ها در فضای خصوصی و با مسیر محدود به همان شرکت و وظیفه ذخیره می‌شوند.</p></div><button className="ops-refresh" onClick={()=>setEvidenceTask('')} aria-label="بستن"><X size={18}/></button></header>
        <form className="ops-form" onSubmit={addEvidence}>
          <label className="ops-field"><span>نوع مدرک</span><select value={evidenceType} onChange={e=>setEvidenceType(e.target.value)}>{evidenceTypes.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
          {(evidenceType==='photo'||evidenceType==='document')&&<label className="ops-field full"><span>فایل</span><input type="file" accept={evidenceType==='photo'?'image/*':'.pdf,.jpg,.jpeg,.png'} required onChange={e=>setEvidenceFile(e.target.files?.[0]??null)}/></label>}
          {evidenceType==='measurement'&&<><label className="ops-field"><span>مقدار</span><input type="number" step="0.001" required value={measurement} onChange={e=>setMeasurement(e.target.value)}/></label><label className="ops-field"><span>واحد</span><input required value={unit} onChange={e=>setUnit(e.target.value)}/></label></>}
          <label className="ops-field full"><span>یادداشت</span><textarea rows={3} required={evidenceType==='note'} value={evidenceNote} onChange={e=>setEvidenceNote(e.target.value)}/></label>
          <div className="ops-form-foot"><span>مدارک اجباری باید قبل از ارسال وظیفه ثبت شوند.</span><button className="button-primary" type="submit" disabled={busy}>{busy?'در حال بارگذاری…':'ذخیره مدرک'}</button></div>
        </form>
      </div>
    </div>}

    {paymentPeriod&&<div className="ops-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setPaymentPeriod(null);}}>
      <div className="ops-modal compact" role="dialog" aria-modal="true" aria-label="ثبت مرجع پرداخت">
        <header><div><span className="ops-eyebrow">مدرک پرداخت</span><h2>ثبت مدرک پرداخت واقعی</h2><p>انتقال وجه توسط سامانه انجام نمی‌شود؛ مرجع واقعی پرداخت در دفتر ثبت می‌شود.</p></div><button className="ops-refresh" onClick={()=>setPaymentPeriod(null)} aria-label="بستن"><X size={18}/></button></header>
        <form className="ops-form" onSubmit={payPeriod}>
          <label className="ops-field"><span>مبلغ (تومان)</span><input type="number" min="1" max={Math.max(1,numeric(paymentPeriod.balance_due_to_partner)-numeric(paymentPeriod.settled_amount))} step="1" required value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)}/></label>
          <label className="ops-field"><span>مرجع رسید / تراکنش</span><input required value={paymentRef} onChange={e=>setPaymentRef(e.target.value)} placeholder="شناسه واقعی رسید"/></label>
          <div className="ops-form-foot"><span>مبلغ و مانده نقد ثبت‌شده توسط RPC کنترل می‌شوند.</span><button className="button-primary" type="submit" disabled={busy}>{busy?'در حال ثبت…':'ثبت مدرک پرداخت'}</button></div>
        </form>
      </div>
    </div>}
    <input id="ops-agreement-file" hidden type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={uploadAgreement}/>
  </section>;
}

function FieldControl({field,value,onChange}:{field:Field;value:unknown;onChange:(value:unknown)=>void}) {
  const id='ops-'+field.name;
  if(field.type==='checkbox')return <label className="ops-field ops-check" htmlFor={id}><input id={id} type="checkbox" checked={value===true} onChange={e=>onChange(e.target.checked)}/><span>{field.label}</span>{field.helper&&<small>{field.helper}</small>}</label>;
  if(field.type==='multi'){
    const selected=Array.isArray(value)?value.map(String):[];
    return <fieldset className={'ops-field ops-multiselect'+(field.full?' full':'')}><legend>{field.label}</legend>{field.helper&&<small>{field.helper}</small>}<div>{(field.options??[]).map(o=><label key={o.value}><input type="checkbox" checked={selected.includes(o.value)} onChange={e=>onChange(e.target.checked?[...selected,o.value]:selected.filter(v=>v!==o.value))}/><span>{o.label}</span></label>)}</div></fieldset>;
  }
  const common={id,required:field.required,min:field.min,max:field.max,step:field.step,value:String(value??''),onChange:(e:ChangeEvent<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>)=>onChange(e.target.value)};
  return <label className={'ops-field'+(field.full?' full':'')} htmlFor={id}><span>{field.label}</span>
    {field.type==='textarea'?<textarea {...common} rows={3}/>:
      field.type==='select'?<select {...common}><option value="">انتخاب کن</option>{(field.options??[]).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:
      <input {...common} type={field.type==='number'?'number':field.type==='date'?'date':field.type==='datetime-local'?'datetime-local':'text'}/>}
    {field.helper&&<small>{field.helper}</small>}
  </label>;
}
