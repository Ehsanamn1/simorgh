# مدار — راه‌اندازی امن حساب مالک

بررسی دیتابیس متصل در ۱۶ اکتبر ۲۰۲۶ نشان داد یک رکورد شرکت با نام «شبکه سیمرغ» موجود است، اما هیچ کاربر Supabase Auth، هیچ عضویت فعالی و هیچ رکورد عملیاتی در جدول‌های نمونه‌برداری‌شده وجود ندارد. ورود امن فعال است و ثبت‌نام عمومی باز نیست؛ نخستین حساب مالک باید از داشبورد Supabase به‌صورت کنترل‌شده ایجاد شود.

## ایجاد حساب امن مالک

۱. داشبورد پروژه‌ی Supabase با شناسه‌ی `aoxerjimfiwusidaparx` را باز کن و به مسیر **Authentication → Users → Add user** برو.
۲. نخستین کاربر را با ایمیلی که شخصاً کنترل می‌کنی بساز. ایمیل را با دقت بررسی کن؛ گذرواژه‌ای قوی و یکتا بساز و در password manager نگه دار. گذرواژه را در گفتگو نفرست و وارد مخزن نکن.
۳. در داشبورد پروژه، **SQL Editor** را باز کن. پس از بررسی حساب، مقدار `OWNER_EMAIL_HERE` در SQL زیر را با همان ایمیل دقیق جایگزین و سپس دستور محافظت‌شده را اجرا کن.

```sql
do $$
declare
  trusted_email text := lower(trim('OWNER_EMAIL_HERE'));
  trusted_user uuid;
  target_company uuid;
begin
  if trusted_email = '' or trusted_email = 'owner_email_here' then raise exception 'Replace OWNER_EMAIL_HERE with the trusted owner email.'; end if;
  select u.id into trusted_user from auth.users u where lower(u.email) = trusted_email;
  if trusted_user is null then raise exception 'No Supabase Auth account exists for the specified email.'; end if;
  select c.id into target_company from public.companies c where c.name = 'شبکه سیمرغ' order by c.created_at limit 1;
  if target_company is null then raise exception 'The Simorgh company record was not found.'; end if;
  if exists (select 1 from public.memberships m where m.company_id = target_company and m.role = 'owner' and m.active) then raise exception 'An active owner already exists; stop and use the owner-managed flow.'; end if;
  insert into public.profiles(id, full_name) values (trusted_user, coalesce((select u.raw_user_meta_data->>'full_name' from auth.users u where u.id = trusted_user), trusted_email)) on conflict (id) do nothing;
  insert into public.memberships(company_id, user_id, role, created_by) values (target_company, trusted_user, 'owner', trusted_user);
end
$$;
```

5. Sign out and sign in again so the browser reads the new owner membership.
6. Open **دسترسی کاربران** to review access requests from existing accounts. Until a dedicated invite workflow is implemented, create or invite additional Auth users through the Supabase dashboard; do not re-enable public signup as a shortcut.

## وضعیت نسخه‌ی فعلی و پایگاه داده

- نام محصول در رابط کاربری «مدار» است؛ نام رکورد سازمانی فعلی («شبکه سیمرغ») عمداً خودکار تغییر داده نشده تا نام واقعی مجموعه با برند نرم‌افزار اشتباه نشود.
- مهاجرت `20261016123004_general_farm_management.sql` روی پروژه‌ی Supabase اعمال و ستون‌های جدیدِ دسته‌بندی سایت، مختصات GPS، چرخه‌های عمومی و ثبت روزانه تأیید شده‌اند.
- برای ظاهرشدن سایت‌ها روی نقشه‌ی مدیریتی، عرض و طول جغرافیایی واقعی را در ماژول «سایت‌های مزرعه» ثبت کن؛ نشانگر ساختگی تولید نمی‌شود.
- مسیر استقرار Pages و Cloudflare مقدار `VITE_ENABLE_AUTH_UI=true` را در زمان ساخت تنظیم می‌کند. ورود با ایمیل و گذرواژه و بازیابی گذرواژه در دسترس است، اما تا زمانی که حساب مالک ساخته و عضویت معتبر ثبت نشود، هیچ داده‌ی محرمانه‌ای نمایش داده نمی‌شود.

## قواعد اعتبارنامه

- The username is the email created in Supabase Auth; the password is the unique password set for that account.
- No default password or hidden super-admin credential is shipped in frontend code, GitHub, migrations, or logs.
- Never put a Supabase service-role key in a `VITE_*` variable or browser bundle.
- Run the owner SQL only in the trusted Supabase SQL Editor after verifying the target email.

## Supabase Auth configuration

In **Authentication → URL Configuration**, allowlist `https://ehsanamn1.github.io/simorgh/` and `https://ehsanamn1.github.io/simorgh/#signin`. Email invitations and recovery still depend on verified SMTP and the live redirect allowlist.
