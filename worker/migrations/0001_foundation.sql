-- Medar username/password foundation for Cloudflare Workers + Neon PostgreSQL.
-- This is the canonical fresh-database schema. No email, OTP or managed-auth dependency.
create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('owner','admin','staff','customer','supplier','driver');
exception when duplicate_object then null;
end $$;

create table if not exists public.medar_users (
  id uuid primary key default gen_random_uuid(),
  username text not null check (char_length(btrim(username)) between 3 and 32),
  username_normalized text not null check (char_length(username_normalized) between 3 and 32),
  phone_e164 text not null,
  display_name text not null check (char_length(trim(display_name)) between 2 and 160),
  password_hash text not null,
  requested_role text not null default 'customer'
    check (requested_role in ('owner','customer','supplier','driver','staff')),
  account_status text not null default 'active'
    check (account_status in ('active','locked','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists medar_users_username_unique on public.medar_users(username_normalized);
create unique index if not exists medar_users_phone_unique on public.medar_users(phone_e164);

create table if not exists public.medar_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.medar_users(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  user_agent text,
  ip_hash text
);
create index if not exists medar_sessions_user_active
  on public.medar_sessions(user_id, expires_at) where revoked_at is null;

create table if not exists public.medar_login_attempts (
  id bigserial primary key,
  username_normalized text not null,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null default false,
  ip_hash text
);
create index if not exists medar_login_attempts_recent
  on public.medar_login_attempts(username_normalized, attempted_at desc);

create table if not exists public.medar_rate_limits (
  key_hash text primary key check (char_length(key_hash) = 64),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists medar_rate_limits_updated_at
  on public.medar_rate_limits(updated_at);

create table if not exists public.medar_audit_log (
  id bigserial primary key,
  actor_user_id uuid references public.medar_users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists medar_audit_log_created_at
  on public.medar_audit_log(created_at desc);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  legal_name text,
  province text not null default 'نامشخص',
  timezone text not null default 'Asia/Tehran',
  created_at timestamptz not null default now(),
  unique(id, name)
);
create index if not exists medar_companies_name on public.companies(lower(name));

create table if not exists public.profiles (
  id uuid primary key references public.medar_users(id) on delete cascade,
  full_name text not null,
  phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.medar_users(id) on delete cascade,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.medar_users(id) on delete set null,
  unique(company_id, user_id, role)
);
create index if not exists medar_memberships_user_active
  on public.memberships(user_id, active);
create unique index if not exists memberships_one_active_owner_per_company_idx
  on public.memberships(company_id) where active and role = 'owner';

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid not null references public.medar_users(id) on delete cascade,
  requested_role text not null check (requested_role in ('customer','supplier','driver','staff')),
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  organization_name text,
  phone text,
  notes text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.medar_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists access_requests_company_status_created_idx
  on public.access_requests(company_id, status, created_at desc);
create unique index if not exists access_requests_one_pending_per_user_company_idx
  on public.access_requests(company_id, user_id) where status = 'pending';
create index if not exists access_requests_user_status_idx
  on public.access_requests(user_id, status);

comment on table public.medar_users is 'Medar username/password identity; email and SMS OTP are not required.';
comment on table public.medar_sessions is 'Opaque session tokens are stored as hashes; browsers receive HttpOnly cookies.';
comment on table public.memberships is 'Tenant membership and role source of truth; browser-supplied roles are never trusted.';
