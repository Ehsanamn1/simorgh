-- Public signup may create a new, isolated workspace for the verified user only.
-- It never grants access to an existing company or an existing tenant's data.

begin;

create or replace function public.create_company_workspace(
  _company_name text,
  _full_name text,
  _phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  confirmed_at timestamptz;
  existing_company uuid;
  created_company uuid;
  safe_company_name text := trim(coalesce(_company_name, ''));
  safe_full_name text := trim(coalesce(_full_name, ''));
  safe_phone text := nullif(trim(coalesce(_phone, '')), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required to create a workspace.'
      using errcode = '28000';
  end if;

  if length(safe_company_name) < 2 or length(safe_company_name) > 160 then
    raise exception 'Company name must be between 2 and 160 characters.'
      using errcode = '22023';
  end if;

  if length(safe_full_name) < 2 or length(safe_full_name) > 160 then
    raise exception 'Full name must be between 2 and 160 characters.'
      using errcode = '22023';
  end if;

  if safe_phone is not null and length(safe_phone) > 40 then
    raise exception 'Phone must be at most 40 characters.'
      using errcode = '22023';
  end if;

  select u.email_confirmed_at
    into confirmed_at
    from auth.users u
   where u.id = actor_id;

  if not found then
    raise exception 'Auth user was not found.'
      using errcode = '28000';
  end if;

  if confirmed_at is null then
    raise exception 'Email confirmation is required before creating a workspace.'
      using errcode = '28000';
  end if;

  -- Idempotent retry: return the workspace already created for this owner.
  select m.company_id
    into existing_company
    from public.memberships m
   where m.user_id = actor_id
     and m.active = true
     and m.role = 'owner'
     and m.created_by = actor_id
   order by m.created_at
   limit 1;

  if existing_company is not null then
    return existing_company;
  end if;

  -- An account already attached to another organization cannot self-enroll into
  -- a different tenant through this endpoint.
  if exists (
    select 1 from public.memberships m
     where m.user_id = actor_id and m.active = true
  ) then
    raise exception 'This account already has an active organization membership.'
      using errcode = '23505';
  end if;

  insert into public.companies (name, province, timezone)
  values (safe_company_name, 'نامشخص', 'Asia/Tehran')
  returning id into created_company;

  insert into public.profiles (id, full_name, phone)
  values (actor_id, safe_full_name, safe_phone)
  on conflict (id) do update
    set full_name = excluded.full_name,
        phone = coalesce(excluded.phone, profiles.phone),
        updated_at = now();

  insert into public.memberships (company_id, user_id, role, active, created_by)
  values (created_company, actor_id, 'owner', true, actor_id);

  return created_company;
end;
$$;

revoke all on function public.create_company_workspace(text, text, text) from public;
revoke all on function public.create_company_workspace(text, text, text) from anon;
grant execute on function public.create_company_workspace(text, text, text) to authenticated;

commit;
