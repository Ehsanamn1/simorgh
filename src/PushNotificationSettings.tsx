import { useEffect, useState } from 'react';
import { Bell, BellOff, CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react';
import { api } from './lib/apiClient';
import type { Membership } from './lib/types';

type PushConfig = { enabled: boolean; publicKey: string | null };
function decodePublicKey(value: string): Uint8Array {
  const base64 = value.replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(base64 + '='.repeat((4-base64.length%4)%4));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
function supported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export function PushNotificationSettings({ membership }: { membership: Membership }) {
  const [config,setConfig] = useState<PushConfig|null>(null);
  const [subscription,setSubscription] = useState<PushSubscription|null>(null);
  const [permission,setPermission] = useState<NotificationPermission| 'unsupported'>(supported()?Notification.permission:'unsupported');
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');

  useEffect(()=>{
    let alive=true;
    (async()=>{
      try {
        const [result,registration] = await Promise.all([
          api.get<PushConfig>('/api/push/config?companyId='+encodeURIComponent(membership.company_id)),
          supported() ? (()=>{ const base=new URL(import.meta.env.BASE_URL,window.location.origin); return navigator.serviceWorker.register(new URL('service-worker.js',base),{scope:base.pathname}); })() : Promise.resolve(null),
        ]);
        const current=registration ? await registration.pushManager.getSubscription() : null;
        if(alive){setConfig(result);setSubscription(current);if(supported())setPermission(Notification.permission);}
      } catch(caught) {
        if(alive) setError(caught instanceof Error?caught.message:'وضعیت اعلان گوشی دریافت نشد.');
      } finally { if(alive)setLoading(false); }
    })();
    return ()=>{alive=false;};
  },[membership.company_id]);

  async function enable() {
    if(!supported()||!config?.enabled||!config.publicKey)return;
    setBusy(true);setError('');setNotice('');
    try {
      const granted=await Notification.requestPermission();
      setPermission(granted);
      if(granted!=='granted')throw new Error(granted==='denied'?'اجازهٔ اعلان در تنظیمات مرورگر رد شده است.':'برای دریافت اعلان گوشی باید اجازه بدهی.');
      const registration=await navigator.serviceWorker.ready;
      const current=await registration.pushManager.getSubscription();
      const next=current??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodePublicKey(config.publicKey) as BufferSource});
      const json=next.toJSON();
      if(!json.endpoint||!json.keys?.p256dh||!json.keys?.auth)throw new Error('مرورگر اطلاعات اشتراک امن را کامل برنگرداند.');
      await api.post('/api/push/subscriptions',{companyId:membership.company_id,endpoint:json.endpoint,expirationTime:next.expirationTime,keys:json.keys});
      setSubscription(next);setNotice('این دستگاه برای دریافت اعلان‌های عملیاتی ثبت شد.');
    } catch(caught) {setError(caught instanceof Error?caught.message:'فعال‌سازی اعلان گوشی انجام نشد.');}
    finally {setBusy(false);}
  }
  async function disable() {
    if(!subscription)return;
    setBusy(true);setError('');setNotice('');
    try {
      await api.post('/api/push/subscriptions/remove',{companyId:membership.company_id,endpoint:subscription.endpoint});
      await subscription.unsubscribe();
      setSubscription(null);setNotice('اعلان گوشی برای این دستگاه غیرفعال شد.');
    } catch(caught) {setError(caught instanceof Error?caught.message:'غیرفعال‌سازی اعلان گوشی انجام نشد.');}
    finally {setBusy(false);}
  }

  return <section className="push-notification-settings" aria-label="تنظیم اعلان گوشی">
    <div className="push-notification-icon">{subscription?<Bell size={17}/>:<ShieldCheck size={17}/>}</div>
    <div className="push-notification-copy">
      <b>اعلان روی گوشی و مرورگر</b>
      {loading?<p>در حال بررسی پشتیبانی دستگاه…</p>:!supported()?<p>این مرورگر اعلان Push را پشتیبانی نمی‌کند؛ اعلان‌های داخل مدار همچنان در دسترس‌اند.</p>:!config?.enabled?<p>ارسال خارجی هنوز روی محیط عملیاتی پیکربندی نشده است؛ این وضعیت به‌معنی فعال‌بودن Push نیست.</p>:permission==='denied'?<p>اجازهٔ اعلان رد شده است. از تنظیمات سایت در مرورگر اجازه را فعال کن.</p>:subscription?<p>این دستگاه مشترک اعلان‌هاست. اعلان‌ها بر اساس عضویت و دسترسی همین حساب ارسال می‌شوند.</p>:<p>با اجازهٔ شما، اعلان‌های مهم مدار روی این دستگاه نمایش داده می‌شوند.</p>}
      {error&&<p className="push-notification-error" role="alert">{error}</p>}
      {notice&&<p className="push-notification-notice" role="status">{notice}</p>}
    </div>
    {loading?<button type="button" disabled><LoaderCircle size={14}/></button>:subscription?<button type="button" disabled={busy} onClick={()=>void disable()}><BellOff size={14}/> خاموش‌کردن</button>:config?.enabled&&supported()&&permission!=='denied'?<button type="button" disabled={busy} onClick={()=>void enable()}>{busy?<LoaderCircle size={14}/>:<Bell size={14}/>} فعال‌سازی</button>:config?.enabled&&permission==='denied'?<span className="push-notification-status"><CheckCircle2 size={13}/> نیازمند اجازه</span>:null}
  </section>;
}
