-- Medar Neon application foundation.
-- Managed Neon Auth owns identity in neon_auth. This migration owns tenant/application data.
create extension if not exists pgcrypto;

do $ begin create type public.app_role as enum ('owner','admin','staff','customer','supplier','driver'); exception when duplicate_object then null; end $;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  legal_name text,
  province text not null default 'نامشخص',
  timezone text not null default 'Asia/Tehran',
  created_at timestamptz not null default now(),
  unique(name)
);

create table if not exists public.profiles (
  id uuid primary key references neon_auth."user"(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references neon_auth."user"(id),
  unique(company_id,user_id,role)
);

create index if not exists memberships_user_active_idx
  on public.memberships(user_id, active);

create unique index if not exists memberships_one_active_owner_idx
  on public.memberships(user_id)
  where active = true and role = 'owner';

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references neon_auth."user"(id) on delete cascade,
  company_name text,
  full_name text not null,
  phone text,
  requested_role public.app_role not null,
  status text not null default 'pending'
    check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists access_requests_user_status_idx
  on public.access_requests(user_id,status);
