-- Medar application foundation for Cloudflare Workers + Neon PostgreSQL.
-- Identity is stored in public.app_users; no email or managed-auth dependency is required.
create extension if not exists pgcrypto;

do $ begin create type public.app_role as enum ('owner','admin','staff','customer','supplier','driver'); exception when duplicate_object then null; end $;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (char_length(username) between 3 and 32),
  phone_e164 text unique,
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  legal_name text,
  province text not null default 'نامشخص',
  timezone text not null default 'Asia/Tehran',
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references public.app_users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role public.app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.app_users(id),
  unique(company_id,user_id,role)
);

create index if not exists memberships_user_active_idx on public.memberships(user_id, active);
create unique index if not exists memberships_one_active_owner_idx
  on public.memberships(user_id) where active = true and role = 'owner';

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  company_name text,
  full_name text not null,
  phone text,
  requested_role public.app_role not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists access_requests_user_status_idx on public.access_requests(user_id,status);
