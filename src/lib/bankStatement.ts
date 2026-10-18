export type ParsedBankTransaction = {
  externalTransactionId: string;
  bookedAt: string;
  amount: number;
  currency: string;
  description: string;
  counterparty: string;
  reference: string;
};

const digitMap: Record<string, string> = {
  '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
  '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
};
export function normalizeBankDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, digit => digitMap[digit] ?? digit);
}
function normalizeHeader(value: string): string {
  return normalizeBankDigits(value).trim().toLocaleLowerCase('fa-IR')
    .replace(/[\u200c\u200f\u202a-\u202e]/g, '')
    .replace(/[\s-]+/g, '_');
}
function detectDelimiter(firstLine: string): string {
  const candidates = [',',';','\t'];
  let best = ',', bestCount = -1;
  for (const delimiter of candidates) {
    let count = 0, inQuotes = false;
    for (let i=0;i<firstLine.length;i++) {
      if(firstLine[i]==='"' && inQuotes && firstLine[i+1]==='"'){i++;continue;}
      if(firstLine[i]==='"'){inQuotes=!inQuotes;continue;}
      if(!inQuotes && firstLine[i]===delimiter)count++;
    }
    if(count>bestCount){best=delimiter;bestCount=count;}
  }
  return best;
}
function parseCsv(text: string): string[][] {
  if(text.length > 5*1024*1024)throw new Error('حجم فایل صورت‌حساب نباید بیشتر از ۵ مگابایت باشد.');
  const delimiter=detectDelimiter(text.split(/\r?\n/,1)[0]??'');
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){
      if(quoted && text[i+1]==='"'){field+='"';i++;}
      else quoted=!quoted;
      continue;
    }
    if(!quoted && ch===delimiter){row.push(field);field='';continue;}
    if(!quoted && (ch==='\n'||ch==='\r')){
      if(ch==='\r'&&text[i+1]==='\n')i++;
      row.push(field);field='';
      if(row.some(cell=>cell.trim()))rows.push(row);
      row=[];continue;
    }
    field+=ch;
  }
  if(quoted)throw new Error('یکی از نقل‌قول‌های CSV بسته نشده است.');
  row.push(field);
  if(row.some(cell=>cell.trim()))rows.push(row);
  return rows;
}
function findColumn(headers:string[], aliases:string[]):number {
  const normalized = new Set(aliases.map(normalizeHeader));
  return headers.findIndex(header=>normalized.has(normalizeHeader(header)));
}
function parseAmount(value:string):number {
  const normalized=normalizeBankDigits(value).trim()
    .replace(/[٬,\s]/g,'').replace(/(ریال|تومان|IRR|IRT|RIAL|TOMAN)/gi,'');
  if(!normalized)return 0;
  if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized))return NaN;
  return Number(normalized);
}
function jalaliToGregorianDate(year:number,month:number,day:number,hour:number,minute:number,second:number):Date {
  const jy=year-979,jm=month-1,jd=day-1;
  let jDayNo=365*jy+Math.floor(jy/33)*8+Math.floor((jy%33+3)/4);
  for(let index=0;index<jm;index++)jDayNo+=index<6?31:30;
  jDayNo+=jd;
  let gDayNo=jDayNo+79;
  let gy=1600+400*Math.floor(gDayNo/146097);
  gDayNo%=146097;
  let leap=true;
  if(gDayNo>=36525){
    gDayNo--;
    gy+=100*Math.floor(gDayNo/36524);
    gDayNo%=36524;
    if(gDayNo>=365)gDayNo++;else leap=false;
  }
  gy+=4*Math.floor(gDayNo/1461);
  gDayNo%=1461;
  if(gDayNo>=366){
    leap=false;gDayNo--;
    gy+=Math.floor(gDayNo/365);gDayNo%=365;
  }
  let gd=gDayNo+1;
  const monthDays=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  let gm=0;
  while(gm<12&&gd>monthDays[gm]){gd-=monthDays[gm];gm++;}
  if(gm>=12)throw new Error('تاریخ شمسی معتبر نیست.');
  return new Date(Date.UTC(gy,gm,gd,hour,minute,second));
}
export function parseBankStatementDate(rawValue:string):string {
  const value=normalizeBankDigits(rawValue).trim();
  if(!value)throw new Error('تاریخ تراکنش خالی است.');
  const parts=value.match(/^(\d{4})[.\x2f-](\d{1,2})[.\x2f-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if(parts){
    const year=Number(parts[1]),month=Number(parts[2]),day=Number(parts[3]);
    const hour=Number(parts[4]??0),minute=Number(parts[5]??0),second=Number(parts[6]??0);
    if(month<1||month>12||day<1||day>(month<=6?31:30)||hour>23||minute>59||second>59)throw new Error('تاریخ تراکنش معتبر نیست.');
    const date=year>=1600
      ? new Date(Date.UTC(year,month-1,day,hour,minute,second))
      : year>=1200 ? jalaliToGregorianDate(year,month,day,hour,minute,second) : new Date(NaN);
    if(!Number.isFinite(date.getTime()))throw new Error('تاریخ تراکنش معتبر نیست.');
    return date.toISOString();
  }
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('تاریخ تراکنش باید میلادی ISO یا شمسی به قالب سال/ماه/روز باشد.');
  return date.toISOString();
}
const aliases={
  id:['transaction_id','transactionid','transaction_no','transaction_number','trace_id','trace_no','tracking_code','شناسه_تراکنش','شناسه_تراکنش_بانکی','شماره_تراکنش','شماره_پیگیری','کد_رهگیری','کد_تراکنش'],
  date:['booked_at','booking_date','transaction_date','date','تاریخ','تاریخ_تراکنش','تاریخ_ثبت','تاریخ_شمسی'],
  amount:['amount','net_amount','value','مبلغ','مبلغ_تراکنش','مبلغ_خالص'],
  debit:['debit','withdrawal','برداشت','بدهکار','مبلغ_برداشت'],
  credit:['credit','deposit','واریز','بستانکار','مبلغ_واریز'],
  currency:['currency','ارز','واحد_پول'],
  description:['description','memo','details','شرح','توضیحات','شرح_تراکنش'],
  counterparty:['counterparty','beneficiary','payer','طرف_حساب','نام_طرف_حساب','ذینفع','پرداخت_کننده'],
  reference:['reference','bank_reference','reference_number','مرجع','شماره_مرجع','شناسه_مرجع'],
};
export function parseBankStatementCsv(text:string,defaultCurrency='IRR'):ParsedBankTransaction[] {
  const rows=parseCsv(text);
  if(rows.length<2)throw new Error('فایل باید یک ردیف عنوان ستون و دست‌کم یک تراکنش داشته باشد.');
  const headers=rows[0].map(normalizeHeader);
  const indexes={
    id:findColumn(headers,aliases.id),date:findColumn(headers,aliases.date),amount:findColumn(headers,aliases.amount),
    debit:findColumn(headers,aliases.debit),credit:findColumn(headers,aliases.credit),currency:findColumn(headers,aliases.currency),
    description:findColumn(headers,aliases.description),counterparty:findColumn(headers,aliases.counterparty),reference:findColumn(headers,aliases.reference),
  };
  if(indexes.id<0)throw new Error('ستون شناسه یکتای تراکنش الزامی است؛ از شناسه تراکنش یا کد پیگیری بانک استفاده کن.');
  if(indexes.date<0)throw new Error('ستون تاریخ تراکنش پیدا نشد.');
  if(indexes.amount<0&&indexes.debit<0&&indexes.credit<0)throw new Error('ستون مبلغ یا ستون‌های بدهکار/بستانکار الزامی‌اند.');
  const result:ParsedBankTransaction[]=[];
  const ids=new Set<string>();
  for(let rowIndex=1;rowIndex<rows.length;rowIndex++){
    const row=rows[rowIndex];
    const cell=(index:number)=>index>=0?String(row[index]??'').trim():'';
    const externalTransactionId=cell(indexes.id);
    if(!externalTransactionId)throw new Error('شناسه تراکنش در ردیف '+(rowIndex+1)+' خالی است.');
    if(externalTransactionId.length<8||externalTransactionId.length>240)throw new Error('شناسه تراکنش در ردیف '+(rowIndex+1)+' باید بین ۸ تا ۲۴۰ نویسه باشد.');
    if(ids.has(externalTransactionId))throw new Error('شناسه تراکنش تکراری در فایل: '+externalTransactionId);
    ids.add(externalTransactionId);
    const rawAmount=cell(indexes.amount);
    let amount=rawAmount?parseAmount(rawAmount):0;
    if(!rawAmount || amount===0){
      const debit=parseAmount(cell(indexes.debit));
      const credit=parseAmount(cell(indexes.credit));
      if(!Number.isFinite(debit)||!Number.isFinite(credit))throw new Error('مبلغ در ردیف '+(rowIndex+1)+' قابل خواندن نیست.');
      if(debit<0||credit<0)throw new Error('مبلغ بدهکار/بستانکار در ردیف '+(rowIndex+1)+' نباید منفی باشد.');
      amount=credit>0?credit:debit>0?-debit:amount;
    }
    if(!Number.isFinite(amount)||Math.abs(amount)<0.01||Math.abs(amount)>1e15||Math.abs(amount*100-Math.round(amount*100))>0.0001)throw new Error('مبلغ در ردیف '+(rowIndex+1)+' باید غیرصفر و حداکثر با دو رقم اعشار باشد.');
    const currency=(cell(indexes.currency)||defaultCurrency).toUpperCase();
    if(!/^[A-Z]{3}$/.test(currency))throw new Error('کد ارز در ردیف '+(rowIndex+1)+' معتبر نیست.');
    result.push({
      externalTransactionId,
      bookedAt:parseBankStatementDate(cell(indexes.date)),
      amount,
      currency,
      description:cell(indexes.description).slice(0,1500),
      counterparty:cell(indexes.counterparty).slice(0,300),
      reference:cell(indexes.reference).slice(0,240),
    });
  }
  if(!result.length)throw new Error('تراکنش قابل واردکردنی در فایل پیدا نشد.');
  if(result.length>500)throw new Error('در هر بار ورود حداکثر ۵۰۰ تراکنش مجاز است؛ فایل را به چند بخش تقسیم کن.');
  return result;
}
