# Simorgh — Network Operations

سیمرغ یک نرم‌افزار عملیاتی برای شبکه تأمین تخم و گوشت بلدرچین است: مشتری، تأمین‌کننده، سفارش، ظرفیت، کیفیت، ارسال، فاکتور، تسویه و کنترل دسترسی.

**وضعیت فعلی رابط (۱۵ اکتبر ۲۰۲۶):** صفحه‌ی عمومی [GitHub Pages](https://ehsanamn1.github.io/simorgh/) با طراحی RTL فارسی، موشن کنترل‌شده و چهار پیش‌نمایش مجزای مدیر/مالک، تأمین‌کننده/مزرعه، راننده/حمل و مشتری سازمانی منتشر شده است. فرم ورود و ثبت‌نام بنا به تصمیم فعلی غیرفعال‌اند. انتخاب کارت نقش فقط ساختار و قابلیت‌های پیشنهادی آن فضا را نشان می‌دهد؛ دسترسی واقعی، نشست کاربری یا داده‌ی خصوصی ایجاد نمی‌کند. CI شامل ۲۱ آزمون مرورگر در سه اندازه‌ی صفحه و ۴ تست واحد است؛ هر دو موفق شده‌اند. آخرین بررسی موفق: [CI](https://github.com/Ehsanamn1/simorgh/actions/runs/38769548002) و [انتشار](https://github.com/Ehsanamn1/simorgh/actions/runs/38769835859). با این حال حساب مالک هنوز bootstrap نشده و جداسازی دسترسی‌ها با حساب‌های واقعی end-to-end آزموده نشده، بنابراین پیش‌نمایش عمومی را برای ثبت عملیات تجاری نهایی استفاده نکن.

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

### ورود و تعیین نقش — فرم‌های عمومی موقتاً غیرفعال

در نسخه‌ی فعلی، صفحه‌ی عمومی فقط برای معرفی و غربال اولیه‌ی فضاهای کاری است؛ فرم ورود/ثبت‌نام و بازیابی رمز عبور نمایش داده نمی‌شود. کد Supabase Auth و پنل عملیاتی نقش‌محور در پروژه باقی مانده‌اند، اما برای آغاز نشست جدید فعلاً از رابط عمومی راهی وجود ندارد. بنابراین کارت مدیر، تأمین‌کننده، راننده یا مشتری صرفاً پیش‌نمایش است و نباید به‌عنوان ورود یا تخصیص نقش تلقی شود.

برای آماده‌سازی حساب مالک در مرحله‌ی راه‌اندازی کنترل‌شده، حساب مورداعتماد باید از Supabase Dashboard با روند امن دعوت/ایجاد کاربر ساخته شود. اگر بعدها فرم ورود دوباره فعال شد، در داشبورد Supabase → **Authentication → URL Configuration** مقدار **Site URL** را روی `https://ehsanamn1.github.io/simorgh/` بگذار و همین آدرس دقیق را به **Redirect URLs** اضافه کن؛ برای توسعه محلی نیز `http://localhost:5173/**` را اضافه کن.

پس از ایجاد حساب واقعی (و تأیید ایمیل، اگر فعال است)، عضویت سازمانی را با نقش postgres از SQL Editor و برای همان ایمیل معتبر اختصاص بده. این دستور را فقط برای حساب مالک مورداعتماد اجرا کن:

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

کاربر عمومی نمی‌تواند برای خودش نقش مالک/مدیر بسازد؛ عضویت اولیه عمداً نیازمند اقدام کنترل‌شده است. چون ورود از رابط عمومی فعلاً غیرفعال است، بعداً که مسیر امن ورود فعال شد، باید نشست و دسترسی مالک نیز جداگانه آزموده شود.

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
npm run build:pages
npm run test:e2e
```

خروجی Vite در `dist/` ساخته می‌شود. `public/_redirects` مسیریابی SPA را برای Cloudflare Pages تنظیم می‌کند. آخرین CI تأییدشده ۴ تست واحد و ۱۸ آزمون Playwright را با موفقیت اجرا کرد؛ typecheck، lint، build و ممیزی وابستگی‌های production نیز موفق بودند. [گزارش CI](https://github.com/Ehsanamn1/simorgh/actions/runs/38757452211). این آزمون‌ها UI عمومی را پوشش می‌دهند، نه RLS عملیاتی با حساب‌های جداگانه.

## وضعیت انتشار و استقرار

- سایت: **https://ehsanamn1.github.io/simorgh/**
- مخزن سورس: [Ehsanamn1/simorgh](https://github.com/Ehsanamn1/simorgh)
- آخرین استقرار تأییدشده‌ی همین نسخه: [GitHub Pages deployment run](https://github.com/Ehsanamn1/simorgh/actions/runs/38757731921) — موفق.
- هر push روی `main`، workflow CI را اجرا می‌کند. انتشار GitHub Pages تنها پس از موفقیت CI انجام می‌شود؛ CI شامل typecheck، lint، تست واحد، ممیزی وابستگی‌های production، build با مسیر `/simorgh/` و آزمون‌های مرورگر Chromium در دسکتاپ و موبایل است.
- Workflow جایگزین Cloudflare در `.github/workflows/deploy.yml` قرار دارد و برای اجرا به secrets مربوط به Cloudflare و Supabase نیاز دارد.

### پیش از استفاده واقعی

1. تا زمانی که احراز هویت از رابط عمومی غیرفعال است، از پیش‌نمایش نقش‌ها برای عملیات واقعی استفاده نکن.
2. در راه‌اندازی کنترل‌شده یک حساب مالک امن ایجاد کن، آن را به شرکت «شبکه سیمرغ» متصل کن و سیاست تخصیص نقش را بازبینی کن.
3. پیش از فعال‌کردن مجدد ورود، نشست، بازیابی رمز، و دسترسی جداگانه مالک، کارمند، مشتری، تأمین‌کننده و راننده را end-to-end آزمایش کن.
4. پیش از ثبت تراکنش واقعی، RLS، ذخیره‌سازی مدارک، قیمت توافقی، ظرفیت و گردش سفارش را با حساب‌های آزمایشی جداگانه در محیط غیرعملیاتی بررسی کن.

## گزارش پذیرش و شکاف‌های باقی‌مانده

چک‌لیست معیارهای پاس‌شده و موارد لازم پیش از عملیات واقعی در [docs/ACCEPTANCE_CHECKLIST.md](docs/ACCEPTANCE_CHECKLIST.md) است. ممیزی معماری و ماتریس قابلیت‌ها نیز در [docs/PRODUCT_AUDIT.md](docs/PRODUCT_AUDIT.md) قرار دارد.

## انتقال به هاست خودت

این یک اپ SPA است؛ خروجی `dist/` را می‌توان روی هر وب‌سرور استاتیک با fallback به `index.html` منتشر کرد. برای Nginx باید مسیرهای SPA به `index.html` fallback شوند. دیتابیس/Auth/Storage مستقل از میزبان front-end در Supabase می‌ماند. اگر در آینده Supabase را نیز self-host کنی، اتصال‌ها، ایمیل، بکاپ، HTTPS، Storage و ارتقای نسخه‌ها جداگانه باید نگهداری شوند.
