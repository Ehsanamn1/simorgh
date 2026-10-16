type ApiError = { message:string; code?:string; details?:string; hint?:string };
type ApiResult<T=unknown> = { data:T|null; error:ApiError|null; count:number|null };
type Filter = {column:string;op:string;value:unknown};
type QueryOptions = {select:string;filters:Filter[];orders:{column:string;ascending:boolean}[];limit:number|null;offset:number;count:'exact'|'planned'|'estimated'|null;head:boolean};
const API_BASE=(import.meta.env.VITE_API_BASE_URL?.trim()||'').replace(/\/$/,'');
async function readResult<T>(response:Response):Promise<ApiResult<T>>{
  let body:Record<string,unknown>={};
  try{body=await response.json() as Record<string,unknown>;}catch{ /* Non-JSON responses use the empty payload below. */ }
  if(!response.ok){
    const message=typeof body.error==='string'?body.error:typeof body.message==='string'?body.message:'درخواست به سرور انجام نشد.';
    return {data:null,error:{message,code:typeof body.code==='string'?body.code:undefined},count:null};
  }
  return {data:(body.data??null) as T|null,error:null,count:typeof body.count==='number'?body.count:null};
}
class MedarQueryBuilder implements PromiseLike<ApiResult<unknown[]>> {
  private operation:'select'|'insert'|'update'|'delete'|'upsert'='select';
  private selectFields='*';
  private values:unknown;
  private filters:Filter[]=[];
  private orders:{column:string;ascending:boolean}[]=[];
  private limitValue:number|null=null;
  private offsetValue=0;
  private countValue:'exact'|'planned'|'estimated'|null=null;
  private headValue=false;
  private returning=false;
  private singleMode:'single'|'maybeSingle'|null=null;
  private cached:Promise<ApiResult<unknown[]>>|null=null;
  constructor(private table:string){}
  select(fields='*',options?:{count?:'exact'|'planned'|'estimated';head?:boolean}):this{
    this.selectFields=fields||'*';this.countValue=options?.count??this.countValue;this.headValue=options?.head??this.headValue;
    if(this.operation!=='select')this.returning=true;
    this.cached=null;return this;
  }
  insert(values:unknown):this{this.operation='insert';this.values=values;this.cached=null;return this;}
  update(values:Record<string,unknown>):this{this.operation='update';this.values=values;this.cached=null;return this;}
  delete():this{this.operation='delete';this.cached=null;return this;}
  upsert(values:unknown,options?:{onConflict?:string}):this{this.operation='upsert';this.values=values;if(options?.onConflict)this.filters.push({column:'__onConflict',op:'value',value:options.onConflict});this.cached=null;return this;}
  eq(column:string,value:unknown):this{return this.filter(column,'eq',value);}
  neq(column:string,value:unknown):this{return this.filter(column,'neq',value);}
  in(column:string,value:unknown[]):this{return this.filter(column,'in',value);}
  is(column:string,value:unknown):this{return this.filter(column,'is',value);}
  not(column:string,operator:string,value:unknown):this{
    if(operator==='in'){
      const items=Array.isArray(value)?value:String(value).replace(/^\(|\)$/g,'').split(',').map(v=>v.trim()).filter(Boolean);
      return this.filter(column,'not_in',items);
    }
    return this.filter(column,'not_'+operator,value);
  }
  gte(column:string,value:unknown):this{return this.filter(column,'gte',value);}
  gt(column:string,value:unknown):this{return this.filter(column,'gt',value);}
  lte(column:string,value:unknown):this{return this.filter(column,'lte',value);}
  lt(column:string,value:unknown):this{return this.filter(column,'lt',value);}
  or(expression:string):this{return this.filter('__or','or',expression);}
  order(column:string,options?:{ascending?:boolean}):this{this.orders.push({column,ascending:options?.ascending!==false});this.cached=null;return this;}
  limit(value:number):this{this.limitValue=Math.max(0,Math.floor(value));this.cached=null;return this;}
  range(from:number,to:number):this{this.offsetValue=Math.max(0,Math.floor(from));this.limitValue=Math.max(0,Math.floor(to)-this.offsetValue+1);this.cached=null;return this;}
  single():Promise<ApiResult<Record<string, unknown>>>{this.singleMode='single';return this.execute().then(result=>this.one(result,false));}
  maybeSingle():Promise<ApiResult<Record<string, unknown>>>{this.singleMode='maybeSingle';return this.execute().then(result=>this.one(result,true));}
  private filter(column:string,op:string,value:unknown):this{this.filters.push({column,op,value});this.cached=null;return this;}
  private one(result:ApiResult<unknown[]>,allowEmpty:boolean):ApiResult<Record<string, unknown>>{
    if(result.error)return {data:null,error:result.error,count:result.count};
    const rows=Array.isArray(result.data)?result.data:[];
    if(rows.length===0&&!allowEmpty)return {data:null,error:{message:'درخواست باید دقیقاً یک رکورد برگرداند.',code:'PGRST116'},count:result.count};
    if(rows.length>1)return {data:null,error:{message:'بیش از یک رکورد برگشت؛ شناسه یا فیلتر را دقیق‌تر کن.',code:'PGRST116'},count:result.count};
    return {data:rows[0] as Record<string, unknown>,error:null,count:result.count};
  }
  private execute():Promise<ApiResult<unknown[]>>{
    if(this.cached)return this.cached;
    const query:QueryOptions={select:this.selectFields,filters:this.filters,orders:this.orders,limit:this.limitValue,offset:this.offsetValue,count:this.countValue,head:this.headValue};
    const path=this.operation==='select'?'/api/data/'+encodeURIComponent(this.table)+'/query':'/api/data/'+encodeURIComponent(this.table);
    this.cached=fetch(API_BASE+path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({operation:this.operation,query,values:this.values,returning:this.returning})})
      .then(response=>readResult<unknown[]>(response))
      .catch((error):ApiResult<unknown[]>=>({data:null,error:{message:error instanceof Error?error.message:'ارتباط با سرور برقرار نشد.'},count:null}));
    return this.cached;
  }
  then<TResult1=ApiResult<unknown[]>,TResult2=never>(
    onfulfilled?:((value:ApiResult<unknown[]>)=>TResult1|PromiseLike<TResult1>)|null,
    onrejected?:((reason:unknown)=>TResult2|PromiseLike<TResult2>)|null,
  ):PromiseLike<TResult1|TResult2>{return this.execute().then(onfulfilled??undefined,onrejected??undefined);}
}
class MedarDataClient {
  from(table:string){return new MedarQueryBuilder(table);}
  async rpc(name:string,args:Record<string,unknown>={}):Promise<ApiResult<unknown>>{
    try{return await readResult(await fetch(API_BASE+'/api/rpc/'+encodeURIComponent(name),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(args)}));}
    catch(error){return {data:null,error:{message:error instanceof Error?error.message:'اجرای عملیات سمت سرور انجام نشد.'},count:null};}
  }
  storage={from:(bucket:string)=>({
    upload:async(path:string,file:File,options?:{contentType?:string;upsert?:boolean}):Promise<ApiResult<{path:string}>>=>{
      const form=new FormData();form.set('file',file);if(options?.contentType)form.set('contentType',options.contentType);form.set('upsert',String(Boolean(options?.upsert)));
      try{return await readResult<{path:string}>(await fetch(API_BASE+'/api/storage/'+encodeURIComponent(bucket)+'/upload?path='+encodeURIComponent(path),{method:'POST',credentials:'same-origin',body:form}));}
      catch(error){return {data:null,error:{message:error instanceof Error?error.message:'بارگذاری فایل انجام نشد.'},count:null};}
    },
  })}
}
export const isMedarDataConfigured=true;
export const medarData=new MedarDataClient();
