-- Compatibility additions for the established Medar schema on the Neon medar-migration branch.
-- Existing auth/business tables are medar_users, medar_sessions and the public operational tables.
-- This migration intentionally does not recreate or rename existing tables.

create or replace function public.medar_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('medar.user_id', true), '')::uuid
$$;

create table if not exists public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  role public.app_role not null check (role in ('admin','staff','customer','supplier','driver')),
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_by uuid not null references public.medar_users(id) on delete restrict,
  expires_at timestamptz not null,
  max_uses integer not null default 1 check (max_uses between 1 and 500),
  uses integer not null default 0 check (uses >= 0),
  revoked_at timestamptz,
  customer_id uuid,
  supplier_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_invites_customer_scope_check check (
    (role = 'customer' and customer_id is not null and supplier_id is null)
    or (role = 'supplier' and supplier_id is not null and customer_id is null)
    or (role not in ('customer','supplier') and customer_id is null and supplier_id is null)
  ),
  constraint company_invites_company_customer_fk
    foreign key (company_id, customer_id) references public.customers(company_id, id) on delete cascade,
  constraint company_invites_company_supplier_fk
    foreign key (company_id, supplier_id) references public.suppliers(company_id, id) on delete cascade
);
create index if not exists company_invites_company_expiry_idx
  on public.company_invites(company_id, expires_at desc) where revoked_at is null;

create table if not exists public.medar_files (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null check (bucket_id in ('delivery-evidence','operational-evidence','contract-documents')),
  name text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  content_type text not null,
  size_bytes bigint not null check (size_bytes between 0 and 20971520),
  uploaded_by uuid references public.medar_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(bucket_id, name),
  constraint medar_files_company_path_check check (
    char_length(name) between 40 and 1000 and split_part(name, '/', 1) = company_id::text
  )
);
create index if not exists medar_files_company_bucket_idx
  on public.medar_files(company_id, bucket_id, created_at desc);
