# Simorgh — Network Operations

سیمرغ یک نرم‌افزار عملیاتی برای کسب‌وکار شبکه تأمین تخم و گوشت بلدرچین است: سفارش، مشتری، تأمین‌کننده، ظرفیت، سری محصول/کیفیت، ارسال، فاکتور و تسویه. سورس برای انتشار روی Cloudflare Pages و انتقال بعدی به هاست استاتیک یا هر میزبان SPA آماده شده است.

**وضعیت این بسته:** سورس مستقل نوشته شده؛ هنوز به پروژه Supabase متصل نشده، روی حساب Cloudflare منتشر نشده و مخزن GitHub اختصاصی از این محیط ایجاد نشده است. هیچ داده نمونه یا seed آزمایشی در آن قرار ندارد. نباید قبل از اجرای migration، تنظیم کلیدها و تکمیل تست استقرار به‌عنوان سیستم عملیاتی استفاده شود.

## فناوری‌ها

- React + TypeScript + Vite، اپ SPA با خروجی `dist/`
- Supabase Auth و PostgreSQL از طریق `@supabase/supabase-js`
- Row Level Security (RLS)، عضویت نقش‌محور و audit trail در migration SQL
- Cloudflare Pages برای فایل‌های front-end؛ بدون Vercel و بدون وابستگی به Replit
- GitHub Actions برای typecheck/lint/test/build

## اجرای محلی

نیازمند Node.js 22+ و npm 10+ (یا Bun نسخه سازگار).

```bash
npm install
cp .env.example .env.local
npm run dev
```

اگر متغیرهای Supabase تنظیم نشده باشند، صفحه راه‌اندازی نمایش داده می‌شود؛ اپ به داده fake یا localStorage عملیاتی برنمی‌گردد.

## ایجاد پایگاه داده

1. در [Supabase Dashboard](https://supabase.com/dashboard) یک پروژه اختصاصی Simorgh بساز.
2. فایل `supabase/migrations/20261015000000_simorgh_core.sql` را از ابتدا تا انتها review کن و در SQL Editor اجرا کن. این migration در این بسته اجرا نشده است.
3. بعد از ایجاد اولین حساب با ایمیل مالک، از Supabase SQL Editor (با نقش `postgres`) شرکت اصلی و عضویت مالک را بساز. نمونه زیر را با UUID واقعی کاربر و نام شرکت واقعی جایگزین کن:

```sql
-- First create a company. Run only once per company.
insert into public.companies (name, province)
values ('نام واقعی شرکت', 'گلستان')
returning id;

-- Use the returned company UUID and the auth.users UUID for the first owner.
insert into public.memberships (company_id, user_id, role, active)
values ('COMPANY_UUID', 'AUTH_USER_UUID', 'owner', true);
```

4. تنظیمات Authentication URL Configuration را مطابق دامنه Cloudflare و دامنه محلی تنظیم کن. ایمیل تأیید/بازیابی به تنظیمات SMTP و Auth پروژه بستگی دارد.
5. در **Project Settings → API Keys** مقدار Project URL و **publishable key** را دریافت کن. فقط این دو مقدار را به مرورگر بده؛ `service_role`/secret key را در هیچ متغیر `VITE_` قرار نده.

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

## GitHub → Cloudflare Pages

1. یک مخزن مستقل به نام `simorgh` بساز؛ به `cortex-ai` push نکن.
2. سورس این پوشه را در ریشه مخزن قرار بده و `package-lock.json` یا `bun.lock` را commit کن.
3. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git را انتخاب و همان مخزن را وصل کن.
4. تنظیم Build command برابر `npm run build` و Build output directory برابر `dist` باشد.
5. دو متغیر `VITE_SUPABASE_URL` و `VITE_SUPABASE_PUBLISHABLE_KEY` را برای Production (و بعداً Preview در صورت نیاز) در تنظیمات پروژه قرار بده. چون متغیرهای `VITE_` هنگام build وارد bundle سمت مرورگر می‌شوند، آن‌ها باید فقط مقادیر عمومی باشند.
6. اولین deploy را بازبینی کن؛ سپس تست ورود/خروج، ثبت سفارش و RLS را با نقش‌های واقعی و حساب‌های جدا اجرا کن.

Workflow موجود در `.github/workflows/ci.yml` تنها CI را اجرا می‌کند؛ عمداً هیچ توکن مخفی یا deploy خودکاری به Cloudflare در آن تعبیه نشده است. بعد از ساخت مخزن و تأیید دسترسی Cloudflare می‌توان Git integration خود Cloudflare را فعال کرد.

## انتقال به هاست خودت

این یک اپ SPA است؛ خروجی `dist/` را می‌توان روی هر وب‌سرور استاتیک با fallback به `index.html` منتشر کرد. برای Nginx باید مسیرهای SPA به `index.html` fallback شوند. دیتابیس/Auth/Storage مستقل از میزبان front-end در Supabase می‌ماند. اگر در آینده Supabase را نیز self-host کنی، اتصال‌ها، ایمیل، بکاپ، HTTPS، Storage و ارتقای نسخه‌ها جداگانه باید نگهداری شوند.
