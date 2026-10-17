-- Upgrade the initial migration in-place to username/password auth.
-- This migration keeps UUIDs and memberships of any legacy Neon Auth users, but disables their old passwords
-- so an administrator must verify the account holder before enabling a replacement credential.
create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (char_length(username) between 3 and 32),
  phone_e164 text unique,
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('neon_auth."user"') is not null then
    execute $copy$
      insert into public.app_users(id, username, full_name, password_hash)
      select u.id,
        'legacy_' || substr(encode(digest(u.id::text, 'sha256'), 'hex'), 1, 16),
        coalesce(nullif(trim(p.full_name), ''), 'کاربر منتقل‌شده'),
        'legacy_disabled$credential-reset-required'
      from neon_auth."user" u
      left join public.profiles p on p.id = u.id
      on conflict (id) do nothing
    $copy$;
  end if;
end $$;

alter table public.companies drop constraint if exists companies_name_key;

-- Drop the old FKs by their stable names, then connect every application relationship to public.app_users.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.memberships drop constraint if exists memberships_user_id_fkey;
alter table public.memberships drop constraint if exists memberships_created_by_fkey;
alter table public.access_requests drop constraint if exists access_requests_user_id_fkey;

alter table public.profiles
  add constraint profiles_id_fkey foreign key (id) references public.app_users(id) on delete cascade;
alter table public.memberships
  add constraint memberships_user_id_fkey foreign key (user_id) references public.app_users(id) on delete cascade;
alter table public.memberships
  add constraint memberships_created_by_fkey foreign key (created_by) references public.app_users(id);
alter table public.access_requests
  add constraint access_requests_user_id_fkey foreign key (user_id) references public.app_users(id) on delete cascade;

create table if not exists public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_sessions_user_expiry_idx on public.auth_sessions(user_id, expires_at);
create index if not exists auth_sessions_expiry_idx on public.auth_sessions(expires_at);

create table if not exists public.auth_rate_limits (
  bucket_key text primary key check (char_length(bucket_key) = 64),
  attempts integer not null default 0 check (attempts >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists auth_rate_limits_updated_idx on public.auth_rate_limits(updated_at);

create table if not exists public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  role public.app_role not null check (role in ('admin','staff','customer','supplier','driver')),
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_by uuid not null references public.app_users(id),
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses between 1 and 500),
  uses integer not null default 0 check (uses >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists company_invites_company_idx on public.company_invites(company_id, expires_at);
alter table public.company_invites add column if not exists customer_id uuid;
alter table public.company_invites add column if not exists supplier_id uuid;
alter table public.company_invites drop constraint if exists company_invites_role_scope;
alter table public.company_invites add constraint company_invites_role_scope check (
  (role = 'customer' and customer_id is not null and supplier_id is null) or
  (role = 'supplier' and supplier_id is not null and customer_id is null) or
  (role not in ('customer','supplier') and customer_id is null and supplier_id is null)
);


create table if not exists public.auth_audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_users(id) on delete set null,
  event_type text not null check (char_length(event_type) between 2 and 80),
  success boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_audit_events_user_time_idx on public.auth_audit_events(user_id, created_at desc);

-- Reconcile the access-request shape when upgrading from an earlier draft of the migration.
alter table public.access_requests add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.access_requests add column if not exists notes text;
alter table public.access_requests add column if not exists reviewed_by uuid references public.app_users(id);
alter table public.access_requests add column if not exists reviewed_at timestamptz;
alter table public.access_requests add column if not exists updated_at timestamptz not null default now();
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='access_requests' and column_name='company_name') then
    execute 'update public.access_requests r set company_id = c.id from public.companies c where r.company_id is null and (r.company_name is null or trim(r.company_name)=trim(c.name))';
  end if;
end $$;
create index if not exists access_requests_company_status_created_idx on public.access_requests(company_id,status,created_at desc);
create unique index if not exists access_requests_one_pending_per_user_company_idx on public.access_requests(company_id,user_id) where status='pending';
