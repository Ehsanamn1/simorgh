# Simorgh — Network Operations

سیمرغ یک نرم‌افزار عملیاتی برای شبکه تأمین تخم و گوشت بلدرچین است: مشتری، تأمین‌کننده، سفارش، ظرفیت، کیفیت، ارسال، فاکتور، تسویه و کنترل دسترسی.

**وضعیت فعلی (۱۵ اکتبر ۲۰۲۶):** رابط وب روی [GitHub Pages](https://ehsanamn1.github.io/simorgh/) منتشر شده، پروژه Supabase `aoxerjimfiwusidaparx` فعال است و migration اصلی روی دیتابیس اجرا شده است. شرکت اولیه «شبکه سیمرغ» ایجاد شده، اما هیچ کاربری/مالک هنوز ثبت‌نام نکرده و فرآیند ورود واقعی و دسترسی‌های نقش‌محور هنوز end-to-end آزمون نشده‌اند؛ تا تکمیل آن‌ها، این سامانه را برای ثبت عملیات مالی یا تحویل واقعی به‌عنوان سیستم عملیاتی نهایی در نظر نگیرید. هیچ داده ساختگی مشتری/سفارش وارد نشده است.

## فناوری‌ها

- React + TypeScript + Vite، اپ SPA با خروجی `dist/`
- Supabase Auth و PostgreSQL از طریق `@supabase/supabase-js`
- Row Level Security (RLS)، عضویت نقش‌محور و audit trail در migration SQL
- GitHub Pages برای میزبانی فعلی رایگان؛ بدون Vercel. Workflow جایگزین Cloudflare نیز در مخزن نگه داشته شده است.
- GitHub Actions برای typecheck/lint/test/build

## اجرای محلی

نیازمند Node.js 22+ و npm 10+ (یا Bun نسخه سازگار).

```bash
npm install
cp .env.example .env.local
npm run dev
```

اگر متغیرهای Supabase تنظیم نشده باشند، صفحه راه‌اندازی نمایش داده می‌شود؛ اپ به داده fake یا localStorage عملیاتی برنمی‌گردد.

## پایگاه داده متصل

- پروژه Supabase: `aoxerjimfiwusidaparx`
- Project URL: `https://aoxerjimfiwusidaparx.supabase.co`
- Migration `supabase/migrations/20261015000000_simorgh_core.sql` اجرا شده و ۱۸ جدول اپلیکیشن با RLS فعال دارد.
- کلید قابل استفاده در مرورگر از نوع publishable است. کلید secret/service-role نباید در سورس یا متغیر `VITE_` قرار گیرد.

### ایجاد حساب اولین مالک

1. سایت [سیمرغ](https://ehsanamn1.github.io/simorgh/) را باز کن و با ایمیل مورد استفاده برای مالک، ثبت‌نام را انجام بده.
2. در داشبورد Supabase → **Authentication → URL Configuration**، مقدار **Site URL** را روی `https://ehsanamn1.github.io/simorgh/` بگذار و همین آدرس دقیق را به **Redirect URLs** اضافه کن. برای توسعه محلی نیز `http://localhost:5173/**` را اضافه کن. آدرس تأیید ایمیل/بازیابی باید در فهرست مجاز باشد.
3. پس از ثبت‌نام (و تأیید ایمیل، اگر فعال است)، حساب هنوز عضویت سازمانی ندارد. در Supabase SQL Editor با نقش `postgres` دستور زیر را با ایمیل واقعی مالک اجرا کن؛ آن را فقط برای یک حساب مورداعتماد اجرا کن:

```sql
insert into public.memberships (company_id, user_id, role, active)
select c.id, u.id, 'owner', true
from public.companies c
join auth.users u on lower(u.email) = lower('OWNER_EMAIL_HERE')
where c.name = 'شبکه سیمرغ'
  and not exists (
    select 1 from public.memberships m
    where m.company_id = c.id and m.user_id = u.id and m.role = 'owner'
  );
```

پس از آن از سایت خارج و دوباره وارد شو. کاربر عمومی نمی‌تواند برای خودش نقش مالک/مدیر بسازد؛ عضویت اولیه عمداً نیازمند اقدام کنترل‌شده است.

`.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

### امنیت و محدودیت‌هایی که باید پیش از بهره‌برداری بازبینی شوند

- تمام عملیات تجاری باید با آزمون RLS، گردش‌های نقش، قواعد قیمت، انتقال وضعیت، حذف و Storage بررسی شوند. migration یک مبنای اولیه است و جای audit مستقل امنیتی را نمی‌گیرد.
- کاربر عمومی خودنقشی یا عضویت سازمانی نمی‌سازد؛ بعد از ثبت‌نام باید مالک/مدیر با تابع `grant_membership` اتصال را برقرار کند.
- انتشار فاکتور رسمی، اتصال بانکی، پیامک/ایمیل عملیاتی، اتصال ربات/ERP بیرونی، زنجیره سرد سنسوری، PDF فاکتور و محاسبه بهای تمام‌شده کامل در این نسخه ارائه نشده‌اند.
- صفحه‌های مالی در حال حاضر وضعیت دفتر داخلی را نگه می‌دارند، نه انتقال بانکی.
- رکوردهای قیمت و ظرفیت را قبل از استفاده با فرآیند واقعی شرکت تطبیق بده.
- کد بارگذاری مدرک برای bucket خصوصی تنظیم شده است، اما Storage policy و مجوز خواندن/نوشتن باید با سناریوی واقعی و کاربر تستی بررسی شود.

## Build و تست

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

خروجی Vite در `dist/` ساخته می‌شود. `public/_redirects` مسیریابی SPA را برای Cloudflare Pages تنظیم می‌کند.

## وضعیت انتشار و استقرار

- سایت: **https://ehsanamn1.github.io/simorgh/**
- مخزن سورس: [Ehsanamn1/simorgh](https://github.com/Ehsanamn1/simorgh)
- استقرار اولیه GitHub Pages با موفقیت انجام شده: [GitHub Actions deployment run](https://github.com/Ehsanamn1/simorgh/actions/runs/38744301095)
- هر push روی `main`، workflow انتشار GitHub Pages را اجرا می‌کند؛ workflow CI نیز typecheck، lint، آزمون‌ها، ممیزی وابستگی‌های production و build را انجام می‌دهد.
- Workflow جایگزین Cloudflare در `.github/workflows/deploy.yml` قرار دارد و برای اجرا به secrets مربوط به Cloudflare و Supabase نیاز دارد.

### پیش از استفاده واقعی

1. تنظیمات Auth URL بالا را تکمیل کن.
2. اولین حساب مالک را ثبت و به شرکت «شبکه سیمرغ» متصل کن.
3. ورود/خروج، تأیید ایمیل، بازیابی رمز عبور، و دسترسی جداگانه مالک، کارمند، مشتری، تأمین‌کننده و راننده را آزمون کن.
4. پیش از ثبت تراکنش واقعی، سیاست‌های RLS، ذخیره‌سازی مدارک، قیمت توافقی، ظرفیت و گردش وضعیت سفارش‌ها را با داده‌های کنترل‌شده بررسی کن.

## انتقال به هاست خودت

این یک اپ SPA است؛ خروجی `dist/` را می‌توان روی هر وب‌سرور استاتیک با fallback به `index.html` منتشر کرد. برای Nginx باید مسیرهای SPA به `index.html` fallback شوند. دیتابیس/Auth/Storage مستقل از میزبان front-end در Supabase می‌ماند. اگر در آینده Supabase را نیز self-host کنی، اتصال‌ها، ایمیل، بکاپ، HTTPS، Storage و ارتقای نسخه‌ها جداگانه باید نگهداری شوند.
