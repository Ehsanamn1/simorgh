# Simorgh — first owner provisioning

The production project has one company record for «شبکه سیمرغ», but no Supabase Auth users and no active memberships. Public registration creates an Auth account; choosing a role does **not** grant access. The first trusted owner must be provisioned explicitly.

## Create the trusted account

1. Open the deployed Simorgh site and choose **ورود / ثبت‌نام → ایجاد حساب**.
2. Use an email address you personally control and choose a strong password. **Do not submit a role request for this account before provisioning the owner.**
3. Complete email confirmation if Supabase requires it.
4. In the Supabase project dashboard for `aoxerjimfiwusidaparx`, open **SQL Editor**. Replace `OWNER_EMAIL_HERE` below with the exact email you registered and run this guarded SQL after verifying the account.

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
6. Open **دسترسی کاربران**. New registrations and role requests can now be reviewed by the owner.

## Credential rules

- The username is the email you registered with; the password is the one you set during signup.
- No default password or hidden super-admin credential is shipped in frontend code, GitHub, migrations, or logs.
- Never put a Supabase service-role key in a `VITE_*` variable or browser bundle.
- Run the owner SQL only in the trusted Supabase SQL Editor after verifying the target email.

## Supabase Auth configuration

In **Authentication → URL Configuration**, allowlist `https://ehsanamn1.github.io/simorgh/` and `https://ehsanamn1.github.io/simorgh/#signin`. Actual email delivery, redirect allowlisting and credentials still require verification in the live Supabase dashboard.
