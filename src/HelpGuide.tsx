import { useEffect } from 'react';
import { ArrowLeft, BookOpen, CheckCircle2, Package, ShieldCheck, Smartphone, Truck, Users, Warehouse, X } from 'lucide-react';
import type { AppRole } from './lib/types';

type HelpGuideProps = {
  role?: AppRole;
  onClose: () => void;
};

const roleNames: Record<string, string> = {
  owner: 'مالک مجموعه',
  admin: 'مدیر',
  staff: 'کارشناس',
  supplier: 'تأمین‌کننده',
  customer: 'مشتری سازمانی',
  driver: 'راننده',
};

function roleSteps(role?: AppRole): string[] {
  if (role === 'driver') {
    return [
      'از «محموله‌های من» فهرست ارسال‌های واگذارشده به حساب خودت را باز کن.',
      'جزئیات محموله، مقصد و وضعیت فعلی را بررسی کن.',
      'پس از انجام واقعی هر مرحله، وضعیت را طبق گزینه‌های مجاز ثبت کن؛ اگر موردی مبهم است با مدیر مجموعه هماهنگ کن.',
    ];
  }
  if (role === 'supplier') {
    return [
      'در «کارهای واگذارشده» کارهای مربوط به خودت و وضعیت هر کدام را ببین.',
      'مقدار و بازه‌ی قابل ارائه را در «ظرفیت من» ثبت یا به‌روزرسانی کن.',
      'برای بررسی توافق‌ها و پرداخت‌ها، از «تسویه‌های من» و بخش مشارکت در صورت دسترسی استفاده کن.',
    ];
  }
  if (role === 'customer') {
    return [
      'در «خرید سازمانی» محصولات و شرایطی را که برای مجموعه‌ات فعال شده بررسی کن.',
      'سفارش را ثبت کن و روند آن را از «سفارش‌های من» دنبال کن.',
      'برای اطلاعات حساب و اسناد مالی، از «حساب سازمانی» و «مالی و تسویه» استفاده کن.',
    ];
  }
  return [
    'برای شروع، اطلاعات پایه‌ی واقعی را در «کاتالوگ و قیمت»، «تأمین‌کنندگان» و «مشتریان» کامل کن.',
    'سفارش‌ها را ثبت و پیگیری کن؛ تأمین، ظرفیت، کیفیت و تحویل از بخش‌های مربوط به هم متصل‌اند.',
    'برای ثبت کارهای روزانه و مغایرت‌ها از «وظایف عملیاتی» و «رخدادها» و برای اسناد از «مالی و تسویه» استفاده کن.',
  ];
}

export function HelpGuide({ role, onClose }: HelpGuideProps) {
  const steps = roleSteps(role);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="guide-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="guide-dialog" role="dialog" aria-modal="true" aria-labelledby="medar-guide-title" dir="rtl">
        <header className="guide-heading">
          <span className="guide-book-icon"><BookOpen size={23}/></span>
          <div className="guide-heading-copy">
            <span className="eyebrow">راهنمای کوتاه مدار</span>
            <h2 id="medar-guide-title">از اینجا شروع کن</h2>
            <p>نمای فعلی برای نقش «{roleNames[role ?? ''] ?? 'کاربر'}» تنظیم شده است.</p>
          </div>
          <button type="button" className="guide-close" onClick={onClose} aria-label="بستن راهنما"><X size={18}/></button>
        </header>

        <div className="guide-trust-note">
          <ShieldCheck size={19}/>
          <p><b>یک فضای کاری مشترک</b><span>وب و اپ‌های موبایل با یک حساب، API مرکزی و پایگاه داده کار می‌کنند. نقش شما تعیین می‌کند کدام بخش‌ها و عملیات در دسترس باشند.</span></p>
        </div>

        <div className="guide-section-title"><span>قدم‌های پیشنهادی</span><small>۳ مرحله</small></div>
        <ol className="guide-steps">
          {steps.map((step, index) => (
            <li key={step}>
              <span className="guide-step-number">{index + 1}</span>
              <span>{step}</span>
              <CheckCircle2 size={17} className="guide-step-check"/>
            </li>
          ))}
        </ol>

        <div className="guide-mobile-tip">
          <span className="guide-tip-icon"><Smartphone size={21}/></span>
          <div>
            <b>روی موبایل چطور کار کنم؟</b>
            <p>با نام کاربری و گذرواژه وارد شو. دکمه‌ی منو، فهرست بخش‌های مجاز تو را باز می‌کند؛ روی هر بخش بزن، رکورد را بررسی کن و تغییرات را ذخیره کن. اطلاعات زنده برای همگام‌شدن به اتصال اینترنت نیاز دارند.</p>
          </div>
        </div>

        <div className="guide-role-links">
          <span><Package size={16}/> عملیات ثبت‌شده</span>
          <span><Warehouse size={16}/> داده‌ی مرکزی</span>
          <span><Users size={16}/> دسترسی بر اساس نقش</span>
          <span><Truck size={16}/> گردش‌کار متصل</span>
        </div>

        <footer className="guide-footer">
          <span>هر تغییری که ثبت می‌کنی در فضای کاری همان مجموعه ذخیره می‌شود.</span>
          <button type="button" className="button-primary" onClick={onClose}>متوجه شدم <ArrowLeft size={16}/></button>
        </footer>
      </section>
    </div>
  );
}
