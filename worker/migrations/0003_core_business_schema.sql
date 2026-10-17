-- Port of the original Medar core schema to Cloudflare Worker + Neon.
-- No Supabase Auth, email, JWT or storage service is required.
create extension if not exists pgcrypto;
create or replace function public.medar_user_id() returns uuid
language sql stable
as $$ select nullif(current_setting('medar.user_id', true), '')::uuid $$;

-- Simorgh core operational schema for Supabase Postgres 15+.
-- No demo rows are inserted. Apply only after creating a dedicated Supabase project and reviewing this migration.
create extension if not exists pgcrypto;

do $$ begin create type public.app_role as enum ('owner','admin','staff','customer','supplier','driver'); exception when duplicate_object then null; end $$;
do $$ begin create type public.product_kind as enum ('eggs','meat','other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.order_status as enum ('draft','submitted','confirmed','allocated','in_fulfillment','dispatched','delivered','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.capacity_status as enum ('declared','confirmed','committed','released','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lot_status as enum ('pending_review','released','on_hold','rejected','consumed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.review_result as enum ('pass','conditional','fail'); exception when duplicate_object then null; end $$;
do $$ begin create type public.shipment_stage as enum ('planned','loading','in_transit','arrived','delivered','failed','returned'); exception when duplicate_object then null; end $$;
do $$ begin create type public.invoice_status as enum ('draft','issued','partially_paid','paid','overdue','void'); exception when duplicate_object then null; end $$;
do $$ begin create type public.settlement_status as enum ('pending','approved','paid','disputed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.evidence_kind as enum ('photo','signature','note','temperature_reading'); exception when duplicate_object then null; end $$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  legal_name text,
  province text not null default 'گلستان',
  timezone text not null default 'Asia/Tehran',
  created_at timestamptz not null default now(),
  unique(id, name)
);
alter table public.companies drop constraint if exists companies_id_name_key;
alter table public.companies add constraint companies_id_name_key unique (id, name);
create table if not exists public.medar_files (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null check (bucket_id in ('delivery-evidence','operational-evidence','contract-documents')),
  name text not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  content_type text not null,
  size_bytes bigint not null check (size_bytes between 0 and 20971520),
  uploaded_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(bucket_id, name)
);
create index if not exists medar_files_company_bucket_idx on public.medar_files(company_id, bucket_id, created_at desc);

create table if not exists public.profiles (
  id uuid primary key references public.app_users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check(length(trim(name)) between 2 and 160), segment text, city text, phone text, address text,
  credit_limit numeric(16,0) check(credit_limit is null or credit_limit >= 0), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,name)
);
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check(length(trim(name)) between 2 and 160), city text, phone text, farm_registration text,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,name)
);
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade, role public.app_role not null,
  customer_id uuid, supplier_id uuid, active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid references public.app_users(id),
  unique(company_id,user_id,role),
  foreign key(company_id,customer_id) references public.customers(company_id,id) on delete cascade,
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete cascade,
  constraint membership_role_scope check(
    (role='customer' and customer_id is not null and supplier_id is null) or
    (role='supplier' and supplier_id is not null and customer_id is null) or
    (role not in ('customer','supplier') and customer_id is null and supplier_id is null)
  )
);
-- These columns/constraints are missing from the temporary auth foundation on existing databases.
alter table public.memberships add column if not exists customer_id uuid;
alter table public.memberships add column if not exists supplier_id uuid;
alter table public.memberships drop constraint if exists memberships_company_customer_fk;
alter table public.memberships add constraint memberships_company_customer_fk
  foreign key (company_id, customer_id) references public.customers(company_id, id) on delete cascade;
alter table public.memberships drop constraint if exists memberships_company_supplier_fk;
alter table public.memberships add constraint memberships_company_supplier_fk
  foreign key (company_id, supplier_id) references public.suppliers(company_id, id) on delete cascade;
alter table public.company_invites drop constraint if exists company_invites_customer_fk;
alter table public.company_invites add constraint company_invites_customer_fk
  foreign key (company_id, customer_id) references public.customers(company_id, id) on delete cascade;
alter table public.company_invites drop constraint if exists company_invites_supplier_fk;
alter table public.company_invites add constraint company_invites_supplier_fk
  foreign key (company_id, supplier_id) references public.suppliers(company_id, id) on delete cascade;
alter table public.memberships drop constraint if exists membership_role_scope;
alter table public.memberships add constraint membership_role_scope check (
  (role = 'customer' and customer_id is not null and supplier_id is null) or
  (role = 'supplier' and supplier_id is not null and customer_id is null) or
  (role not in ('customer','supplier') and customer_id is null and supplier_id is null)
);
drop index if exists public.memberships_one_active_owner_idx;
create unique index if not exists memberships_one_active_owner_per_company_idx
  on public.memberships(company_id) where active = true and role = 'owner';

create index if not exists memberships_user_idx on public.memberships(user_id,active);

-- SECURITY DEFINER functions are narrowly scoped helpers used by RLS. Fully qualified references avoid search_path hijacking.
create or replace function public.has_company_role(_company uuid, _roles public.app_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.memberships m where m.company_id=_company and m.user_id=public.medar_user_id() and m.active and m.role=any(_roles));
$$;
create or replace function public.is_company_member(_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.memberships m where m.company_id=_company and m.user_id=public.medar_user_id() and m.active);
$$;
create or replace function public.is_company_internal(_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_company_role(_company,array['owner','admin','staff']::public.app_role[]);
$$;
create or replace function public.is_company_manager(_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_company_role(_company,array['owner','admin']::public.app_role[]);
$$;
create or replace function public.my_customer_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.customer_id from public.memberships m where m.user_id=public.medar_user_id() and m.active and m.role='customer' and m.customer_id is not null;
$$;
create or replace function public.my_supplier_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.supplier_id from public.memberships m where m.user_id=public.medar_user_id() and m.active and m.role='supplier' and m.supplier_id is not null;
$$;













create table if not exists public.products (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  sku text not null, name text not null check(length(trim(name)) between 2 and 160), kind public.product_kind not null,
  unit text not null default 'کیلوگرم', pack_size integer check(pack_size is null or pack_size>0),
  shelf_life_days integer check(shelf_life_days is null or shelf_life_days>0), storage_note text,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,sku)
);
create table if not exists public.price_agreements (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null, product_id uuid not null, unit_price numeric(16,0) not null check(unit_price>0),
  min_qty integer not null default 1 check(min_qty>0), valid_from date not null default current_date, valid_to date,
  created_at timestamptz not null default now(), created_by uuid references public.app_users(id),
  foreign key(company_id,customer_id) references public.customers(company_id,id) on delete cascade,
  foreign key(company_id,product_id) references public.products(company_id,id) on delete cascade,
  check(valid_to is null or valid_to>=valid_from)
);
create index if not exists price_agreements_lookup_idx on public.price_agreements(company_id,customer_id,product_id,valid_from);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null, reference text not null default ('SO-'||to_char(now(),'YYMMDD')||'-'||upper(substr(gen_random_uuid()::text,1,6))),
  status public.order_status not null default 'draft', requested_delivery date, delivery_address text, notes text,
  created_by uuid references public.app_users(id) default public.medar_user_id(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(company_id,customer_id) references public.customers(company_id,id) on delete restrict,
  unique(company_id,id), unique(company_id,reference)
);
create index if not exists orders_company_status_idx on public.orders(company_id,status,created_at desc);
create index if not exists orders_customer_idx on public.orders(customer_id,created_at desc);
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null, product_id uuid not null, quantity numeric(14,3) not null check(quantity>0),
  unit_price numeric(16,0) not null default 0 check(unit_price>=0), supplier_id uuid, lot_id uuid,
  created_at timestamptz not null default now(),
  foreign key(company_id,order_id) references public.orders(company_id,id) on delete cascade,
  foreign key(company_id,product_id) references public.products(company_id,id) on delete restrict,
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict,
  unique(company_id,id)
);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_supplier_idx on public.order_items(supplier_id);

create table if not exists public.capacity_commitments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null, product_id uuid not null, period_start date not null, period_end date not null,
  declared_qty numeric(14,3) not null check(declared_qty>=0), confirmed_qty numeric(14,3) check(confirmed_qty is null or confirmed_qty>=0),
  committed_qty numeric(14,3) check(committed_qty is null or committed_qty>=0), status public.capacity_status not null default 'declared', note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.app_users(id),
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete cascade,
  foreign key(company_id,product_id) references public.products(company_id,id) on delete restrict,
  unique(company_id,id),
  check(period_end>=period_start), check(confirmed_qty is null or confirmed_qty<=declared_qty),
  check(committed_qty is null or confirmed_qty is null or committed_qty<=confirmed_qty)
);
alter table public.order_items add column if not exists capacity_commitment_id uuid;
alter table public.order_items drop constraint if exists order_items_capacity_fk;
alter table public.order_items add constraint order_items_capacity_fk foreign key(company_id,capacity_commitment_id) references public.capacity_commitments(company_id,id) on delete restrict;

create table if not exists public.lots (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null, product_id uuid not null, code text not null, produced_on date not null, best_before date,
  quantity numeric(14,3) not null check(quantity>0), status public.lot_status not null default 'pending_review',
  created_at timestamptz not null default now(),
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict,
  foreign key(company_id,product_id) references public.products(company_id,id) on delete restrict,
  unique(company_id,id), unique(company_id,code), check(best_before is null or best_before>=produced_on)
);
alter table public.order_items drop constraint if exists order_items_lot_fk;
alter table public.order_items add constraint order_items_lot_fk foreign key(company_id,lot_id) references public.lots(company_id,id) on delete restrict;
create table if not exists public.quality_reviews (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  lot_id uuid not null, result public.review_result not null, checklist jsonb not null default '{}'::jsonb, notes text,
  reviewer_id uuid references public.app_users(id) default public.medar_user_id(), reviewed_at timestamptz not null default now(),
  foreign key(company_id,lot_id) references public.lots(company_id,id) on delete cascade
);
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null, driver_user_id uuid references public.app_users(id) on delete set null, vehicle text,
  stage public.shipment_stage not null default 'planned', planned_departure timestamptz, departed_at timestamptz, delivered_at timestamptz,
  failure_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(company_id,order_id) references public.orders(company_id,id) on delete restrict, unique(company_id,id)
);
create index if not exists shipment_driver_idx on public.shipments(driver_user_id,stage);
create table if not exists public.delivery_evidence (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  shipment_id uuid not null, kind public.evidence_kind not null, storage_path text, recipient_name text, note text,
  reading_celsius numeric(5,2), captured_by uuid references public.app_users(id) default public.medar_user_id(), captured_at timestamptz not null default now(),
  foreign key(company_id,shipment_id) references public.shipments(company_id,id) on delete cascade,
  check(kind<>'temperature_reading' or reading_celsius is not null)
);
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null, customer_id uuid not null, reference text not null, amount numeric(16,0) not null check(amount>=0),
  paid_amount numeric(16,0) not null default 0 check(paid_amount>=0 and paid_amount<=amount), due_date date,
  status public.invoice_status not null default 'draft', issued_at timestamptz, created_at timestamptz not null default now(),
  foreign key(company_id,order_id) references public.orders(company_id,id) on delete restrict,
  foreign key(company_id,customer_id) references public.customers(company_id,id) on delete restrict,
  unique(company_id,reference)
);
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null, invoice_ref text, amount numeric(16,0) not null check(amount>=0), due_date date,
  status public.settlement_status not null default 'pending', note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade, title text not null, body text, href text,
  read_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid references public.app_users(id) on delete set null, table_name text not null, record_id uuid, action text not null,
  changes jsonb, occurred_at timestamptz not null default now()
);
create index if not exists audit_company_date_idx on public.audit_events(company_id,occurred_at desc);

-- Updated timestamp trigger helper
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at:=now(); return new; end $$;
do $$ declare t text; begin foreach t in array array['profiles','customers','suppliers','products','orders','capacity_commitments','shipments','settlements'] loop execute format('drop trigger if exists touch_%I on public.%I',t,t); execute format('create trigger touch_%I before update on public.%I for each row execute function public.touch_updated_at()',t,t); end loop; end $$;

-- Role-aware, auditable business invariants. Use a controlled role transition workflow, never client-supplied admin metadata.
create or replace function public.enforce_order_status_transition() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.status<>'draft' then raise exception 'سفارش جدید باید ابتدا در وضعیت پیش‌نویس ثبت شود'; end if;
    return new;
  end if;
  if new.company_id<>old.company_id or new.customer_id<>old.customer_id then raise exception 'شرکت و مشتری سفارش قابل تغییر نیستند'; end if;
  if new.status is distinct from old.status then
    if not public.is_company_internal(old.company_id) then
      if not (old.status='draft' and new.status in ('submitted','cancelled')) then raise exception 'اجازه تغییر این وضعیت را ندارید'; end if;
    elsif not (
      (old.status='draft' and new.status in ('submitted','cancelled')) or
      (old.status='submitted' and new.status in ('confirmed','cancelled')) or
      (old.status='confirmed' and new.status in ('allocated','cancelled')) or
      (old.status='allocated' and new.status in ('in_fulfillment','cancelled')) or
      (old.status='in_fulfillment' and new.status in ('dispatched','cancelled')) or
      (old.status='dispatched' and new.status='delivered')
    ) then raise exception 'گذار وضعیت سفارش از % به % مجاز نیست',old.status,new.status; end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_status_transition on public.orders;
create trigger orders_status_transition before insert or update on public.orders for each row execute function public.enforce_order_status_transition();

create or replace function public.set_agreed_order_price() returns trigger language plpgsql security definer set search_path='' as $$
declare cust uuid; agreed numeric;
begin
  select o.customer_id into cust from public.orders o where o.id=new.order_id and o.company_id=new.company_id;
  if cust is null then raise exception 'سفارش نامعتبر است'; end if;
  select pa.unit_price into agreed from public.price_agreements pa
   where pa.company_id=new.company_id and pa.customer_id=cust and pa.product_id=new.product_id
     and pa.valid_from<=current_date and (pa.valid_to is null or pa.valid_to>=current_date) and pa.min_qty<=new.quantity
   order by pa.valid_from desc limit 1;
  if agreed is null then raise exception 'قرارداد قیمت فعال برای این محصول/مقدار وجود ندارد'; end if;
  -- The contract is the source of truth; a browser cannot override the unit price.
  new.unit_price:=agreed;
  if public.medar_user_id() is not null and not public.is_company_internal(new.company_id) then new.supplier_id:=null; new.lot_id:=null; end if;
  return new;
end $$;
drop trigger if exists order_items_price_guard on public.order_items;
create trigger order_items_price_guard before insert or update of unit_price,quantity,product_id,order_id on public.order_items for each row execute function public.set_agreed_order_price();

-- A submitted/confirmed order line is immutable except for allocation performed by the guarded RPC.
create or replace function public.enforce_order_item_mutability() returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid; cid uuid; order_state public.order_status;
begin
  if tg_op='DELETE' then oid:=old.order_id; cid:=old.company_id; else oid:=new.order_id; cid:=new.company_id; end if;
  select o.status into order_state from public.orders o where o.id=oid and o.company_id=cid;
  if order_state is null then raise exception 'سفارش مرتبط پیدا نشد'; end if;
  if tg_op='INSERT' then
    if order_state<>'draft' then raise exception 'اقلام فقط به پیش‌نویس سفارش اضافه می‌شوند'; end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if order_state<>'draft' then raise exception 'پس از ارسال سفارش، حذف قلم مجاز نیست'; end if;
    return old;
  end if;
  if new.company_id<>old.company_id or new.order_id<>old.order_id then raise exception 'انتقال قلم به سفارش یا شرکت دیگر ممنوع است'; end if;
  if order_state='draft' then return new; end if;
  if order_state in ('confirmed','allocated')
     and current_setting('simorgh.allow_capacity_allocation',true)='on'
     and new.product_id=old.product_id and new.quantity=old.quantity and new.unit_price=old.unit_price and new.lot_id is not distinct from old.lot_id
     and new.supplier_id is not null and new.capacity_commitment_id is not null then
    return new;
  end if;
  raise exception 'اقلام سفارش پس از ارسال تغییرناپذیرند؛ فقط تخصیص تأمین از مسیر مجاز قابل انجام است';
end $$;

drop trigger if exists order_items_mutability_guard on public.order_items;
create trigger order_items_mutability_guard before insert or update or delete on public.order_items for each row execute function public.enforce_order_item_mutability();

create or replace function public.enforce_capacity_permissions() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.medar_user_id() is null or public.is_company_internal(new.company_id) then return new; end if;
  if tg_op='INSERT' then new.confirmed_qty:=null; new.committed_qty:=null; new.status:='declared'; return new; end if;
  if new.confirmed_qty is distinct from old.confirmed_qty or new.committed_qty is distinct from old.committed_qty or new.supplier_id<>old.supplier_id or new.company_id<>old.company_id or new.product_id<>old.product_id or new.status is distinct from old.status then
    raise exception 'تأمین‌کننده فقط مجاز به ویرایش ظرفیت اعلامی و یادداشت آن است'; end if;
  return new;
end $$;
drop trigger if exists capacity_permissions_guard on public.capacity_commitments;
create trigger capacity_permissions_guard before insert or update on public.capacity_commitments for each row execute function public.enforce_capacity_permissions();

create or replace function public.enforce_shipment_permissions() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.stage<>'planned' then raise exception 'محموله جدید باید ابتدا در وضعیت برنامه‌ریزی‌شده ثبت شود'; end if;
    new.departed_at:=null; new.delivered_at:=null;
    return new;
  end if;
  if public.medar_user_id() is not null and not public.is_company_internal(new.company_id) then
    if new.company_id<>old.company_id or new.order_id<>old.order_id or new.driver_user_id is distinct from old.driver_user_id or new.vehicle is distinct from old.vehicle or new.planned_departure is distinct from old.planned_departure then raise exception 'راننده مجاز به تغییر مشخصات اصلی محموله نیست'; end if;
    if new.departed_at is distinct from old.departed_at or new.delivered_at is distinct from old.delivered_at then raise exception 'زمان خروج و تحویل را سرور ثبت می‌کند'; end if;
    if new.stage is distinct from old.stage and not ((old.stage='planned' and new.stage='loading') or (old.stage='loading' and new.stage='in_transit') or (old.stage='in_transit' and new.stage in ('arrived','failed')) or (old.stage='arrived' and new.stage in ('delivered','failed','returned'))) then raise exception 'گذار وضعیت ارسال مجاز نیست'; end if;
  end if;
  if new.stage='in_transit' and old.stage<>'in_transit' then new.departed_at:=now(); end if;
  if new.stage='delivered' and old.stage<>'delivered' then new.delivered_at:=now(); end if;
  return new;
end $$;
drop trigger if exists shipment_permissions_guard on public.shipments;
create trigger shipment_permissions_guard before insert or update on public.shipments for each row execute function public.enforce_shipment_permissions();

create or replace function public.apply_quality_review() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not public.is_company_internal(new.company_id) then raise exception 'فقط تیم داخلی می‌تواند کیفیت را بازبینی کند'; end if;
  update public.lots set status=case new.result when 'pass' then 'released'::public.lot_status when 'conditional' then 'on_hold'::public.lot_status else 'rejected'::public.lot_status end where id=new.lot_id and company_id=new.company_id;
  return new;
end $$;
drop trigger if exists quality_review_apply on public.quality_reviews;
create trigger quality_review_apply before insert on public.quality_reviews for each row execute function public.apply_quality_review();

create or replace function public.create_profile_for_auth_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id, full_name, phone)
  values (new.id, nullif(trim(new.full_name), ''), new.phone_e164)
  on conflict(id) do update set full_name = excluded.full_name, phone = excluded.phone;
  return new;
end $$
drop trigger if exists on_auth_user_created_profile on public.app_users;
drop trigger if exists on_app_user_created_profile on public.app_users;
create trigger on_app_user_created_profile after insert on public.app_users for each row execute function public.create_profile_for_auth_user();

create or replace function public.audit_row_change() returns trigger language plpgsql security definer set search_path='' as $$
declare rec jsonb; prev jsonb; cid uuid; rid uuid;
begin
  rec:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  prev:=case when tg_op='UPDATE' then to_jsonb(old) else null end;
  cid:=nullif(rec->>'company_id','')::uuid; rid:=nullif(rec->>'id','')::uuid;
  if cid is not null then
    insert into public.audit_events(company_id,actor_id,table_name,record_id,action,changes)
    values(cid,public.medar_user_id(),tg_table_name, rid,lower(tg_op), case when tg_op='UPDATE' then (select jsonb_object_agg(k,jsonb_build_object('from',prev->k,'to',rec->k)) from jsonb_object_keys(rec) as x(k) where rec->k is distinct from prev->k and k not in ('updated_at')) else rec end);
  end if;
  return null;
end $$;
do $$ declare t text; begin foreach t in array array['memberships','customers','suppliers','products','price_agreements','orders','order_items','capacity_commitments','lots','quality_reviews','shipments','delivery_evidence','invoices','settlements'] loop execute format('drop trigger if exists audit_%I on public.%I',t,t); execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.audit_row_change()',t,t); end loop; end $$;

-- Invitation/approval: only an existing owner/admin may bind an already-registered account to this company.
drop function if exists public.grant_membership(uuid,text,public.app_role,uuid,uuid);
create or replace function public.grant_membership(_company uuid,_username text,_role public.app_role,_customer uuid default null,_supplier uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; new_id uuid;
begin
  if not public.is_company_manager(_company) then raise exception 'دسترسی مدیر مجموعه لازم است'; end if;
  if _role='owner' and not public.has_company_role(_company,array['owner']::public.app_role[]) then raise exception 'فقط مالک می‌تواند نقش مالک اعطا کند'; end if;
  if (_role='customer' and _customer is null) or (_role='supplier' and _supplier is null) or (_role not in ('customer','supplier') and (_customer is not null or _supplier is not null)) then raise exception 'اتصال نقش به حساب کسب‌وکار معتبر نیست'; end if;
  if _customer is not null and not exists(select 1 from public.customers c where c.id=_customer and c.company_id=_company) then raise exception 'مشتری به این شرکت تعلق ندارد'; end if;
  if _supplier is not null and not exists(select 1 from public.suppliers s where s.id=_supplier and s.company_id=_company) then raise exception 'تأمین‌کننده به این شرکت تعلق ندارد'; end if;
  select u.id into target from public.app_users u where lower(u.username)=lower(trim(_username));
  if target is null then raise exception 'کاربر باید ابتدا حساب کاربری بسازد'; end if;
  insert into public.memberships(company_id,user_id,role,customer_id,supplier_id,created_by) values(_company,target,_role,_customer,_supplier,public.medar_user_id()) returning id into new_id;
  return new_id;
end $$;



drop function if exists public.company_members(uuid);
create or replace function public.company_members(_company uuid)
returns table(membership_id uuid,user_id uuid,username text,phone text,full_name text,role public.app_role,customer_id uuid,supplier_id uuid,active boolean,created_at timestamptz)
language sql stable security definer set search_path='' as $
  select m.id,m.user_id,u.username,u.phone_e164::text,p.full_name,m.role,m.customer_id,m.supplier_id,m.active,m.created_at
  from public.memberships m join public.app_users u on u.id=m.user_id
  left join public.profiles p on p.id=m.user_id
  where m.company_id=_company and public.is_company_manager(_company)
  order by m.created_at;
$;



-- RLS on every application table in public schema.
do $$ declare t text; begin foreach t in array array['companies','profiles','customers','suppliers','memberships','products','price_agreements','orders','order_items','capacity_commitments','lots','quality_reviews','shipments','delivery_evidence','invoices','settlements','notifications','audit_events'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
-- Companies and profiles
drop policy if exists companies_read_member on public.companies;
create policy companies_read_member on public.companies for select to public using(public.is_company_member(id));
drop policy if exists profiles_read_self_or_colleague on public.profiles;
create policy profiles_read_self_or_colleague on public.profiles for select to public using(id=public.medar_user_id() or exists(select 1 from public.memberships mine join public.memberships theirs on theirs.company_id=mine.company_id where mine.user_id=public.medar_user_id() and mine.active and theirs.user_id=profiles.id and theirs.active and public.is_company_manager(mine.company_id)));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to public using(id=public.medar_user_id()) with check(id=public.medar_user_id());
-- Membership: users see own memberships; managers see company roster; only grant_membership can insert roles.
drop policy if exists memberships_read_own_or_managed on public.memberships;
create policy memberships_read_own_or_managed on public.memberships for select to public using(user_id=public.medar_user_id() or public.is_company_manager(company_id));
drop policy if exists memberships_manager_update on public.memberships;
create policy memberships_manager_update on public.memberships for update to public using(public.is_company_manager(company_id) and not (role='owner' and user_id<>public.medar_user_id())) with check(public.is_company_manager(company_id));
-- Business entities: internal roles administer; clients/suppliers see only bound records.
drop policy if exists customers_internal_all on public.customers;
create policy customers_internal_all on public.customers for all to public using(public.is_company_internal(company_id)) with check(public.is_company_internal(company_id));
drop policy if exists customers_customer_read on public.customers;
create policy customers_customer_read on public.customers for select to public using(id in (select public.my_customer_ids()));
drop policy if exists suppliers_internal_all on public.suppliers;
create policy suppliers_internal_all on public.suppliers for all to public using(public.is_company_internal(company_id)) with check(public.is_company_internal(company_id));
drop policy if exists suppliers_supplier_read on public.suppliers;
create policy suppliers_supplier_read on public.suppliers for select to public using(id in (select public.my_supplier_ids()));
drop policy if exists products_internal_all on public.products;
create policy products_internal_all on public.products for all to public using(public.is_company_internal(company_id)) with check(public.is_company_internal(company_id));
drop policy if exists products_customer_catalog on public.products;
create policy products_customer_catalog on public.products for select to public using(active and exists(select 1 from public.price_agreements pa where pa.company_id=products.company_id and pa.product_id=products.id and pa.customer_id in (select public.my_customer_ids()) and pa.valid_from<=current_date and (pa.valid_to is null or pa.valid_to>=current_date)));
drop policy if exists price_agreements_internal_all on public.price_agreements;
create policy price_agreements_internal_all on public.price_agreements for all to public using(public.is_company_internal(company_id)) with check(public.is_company_internal(company_id));
drop policy if exists price_agreements_customer_read on public.price_agreements;
create policy price_agreements_customer_read on public.price_agreements for select to public using(customer_id in (select public.my_customer_ids()) and valid_from<=current_date and (valid_to is null or valid_to>=current_date));
drop policy if exists orders_internal_all on public.orders;
create policy orders_internal_all on public.orders for all to public using(public.is_company_internal(company_id)) with check(public.is_company_internal(company_id));
drop policy if exists orders_customer_read on public.orders;
create policy orders_customer_read on public.orders for select to public using(customer_id in (select public.my_customer_ids()));
drop policy if exists orders_customer_insert_draft on public.orders;
create policy orders_customer_insert_draft on public.orders for insert to public with check(status='draft' and customer_id in (select public.my_customer_ids()) and created_by=public.medar_user_id());
drop policy if exists orders_customer_update_draft on public.orders;
create policy orders_customer_update_draft on public.orders for update to public using(customer_id in (select public.my_customer_ids()) and status in ('draft','submitted')) with check(customer_id in (select public.my_customer_ids()));
drop policy if exists order_items_internal_all on public.order_items;
create policy order_items_internal_all on public.order_items for all to public using(public.is_company_internal(company_id)) with check(public.is_company_internal(company_id));
drop policy if exists order_items_customer_read on public.order_items;
create policy order_items_customer_read on public.order_items for select to public using(exists(select 1 from public.orders o where o.id=order_items.order_id and o.company_id=order_items.company_id and o.customer_id in (select public.my_customer_ids())));
drop policy if exists order_items_customer_insert on public.order_items;
create policy order_items_customer_insert on public.order_items for insert to public with check(exists(select 1 from public.orders o where o.id=order_items.order_id and o.company_id=order_items.company_id and o.status='draft' and o.customer_id in (select public.my_customer_ids())));
drop policy if exists order_items_supplier_read on public.order_items;
create policy order_items_supplier_read on public.order_items for select to public using(supplier_id in (select public.my_supplier_ids()));
drop policy if exists capacity_internal_all on public.capacity_commitments;
create policy capacity_internal_all on public.capacity_commitments for all to public using(public.is_company_internal(company_id)) with check(public.is_company_internal(company_id));
drop policy if exists capacity_supplier_read on public.capacity_commitments;
create policy capacity_supplier_read on public.capacity_commitments for select to public using(supplier_id in (select public.my_supplier_ids()));
drop policy if exists capacity_supplier_insert on public.capacity_commitments;
create policy capacity_supplier_insert on public.capacity_commitments for insert to public with check(supplier_id in (select public.my_supplier_ids()) and status='declared' and confirmed_qty is null and committed_qty is null);
drop policy if exists capacity_supplier_update_declared on public.capacity_commitments;
create policy capacity_supplier_update_declared on public.capacity_commitments for update to public using(supplier_id in (select public.my_supplier_ids()) and status='declared') with check(supplier_id in (select public.my_supplier_ids()));
drop policy if exists lots_internal_all on public.lots;
create policy lots_internal_all on public.lots for all to public using(public.is_company_internal(company_id)) with check(public.is_company_internal(company_id));
drop policy if exists lots_supplier_read on public.lots;
create policy lots_supplier_read on public.lots for select to public using(supplier_id in (select public.my_supplier_ids()));
drop policy if exists quality_internal_read on public.quality_reviews;
create policy quality_internal_read on public.quality_reviews for select to public using(public.is_company_internal(company_id));
drop policy if exists quality_internal_insert on public.quality_reviews;
create policy quality_internal_insert on public.quality_reviews for insert to public with check(public.is_company_internal(company_id) and reviewer_id=public.medar_user_id());
drop policy if exists shipments_internal_all on public.shipments;
create policy shipments_internal_all on public.shipments for all to public using(public.is_company_internal(company_id)) with check(public.is_company_internal(company_id));
drop policy if exists shipments_driver_read on public.shipments;
create policy shipments_driver_read on public.shipments for select to public using(driver_user_id=public.medar_user_id());
drop policy if exists shipments_driver_update on public.shipments;
create policy shipments_driver_update on public.shipments for update to public using(driver_user_id=public.medar_user_id()) with check(driver_user_id=public.medar_user_id());
drop policy if exists evidence_internal_all on public.delivery_evidence;
create policy evidence_internal_all on public.delivery_evidence for all to public using(public.is_company_internal(company_id)) with check(public.is_company_internal(company_id));
drop policy if exists evidence_driver_read on public.delivery_evidence;
create policy evidence_driver_read on public.delivery_evidence for select to public using(exists(select 1 from public.shipments s where s.id=delivery_evidence.shipment_id and s.company_id=delivery_evidence.company_id and s.driver_user_id=public.medar_user_id()));
drop policy if exists evidence_driver_insert on public.delivery_evidence;
create policy evidence_driver_insert on public.delivery_evidence for insert to public with check(exists(select 1 from public.shipments s where s.id=delivery_evidence.shipment_id and s.company_id=delivery_evidence.company_id and s.driver_user_id=public.medar_user_id()) and captured_by=public.medar_user_id());
drop policy if exists invoices_internal_all on public.invoices;
create policy invoices_internal_all on public.invoices for all to public using(public.is_company_internal(company_id)) with check(public.is_company_internal(company_id));
drop policy if exists invoices_customer_read on public.invoices;
create policy invoices_customer_read on public.invoices for select to public using(customer_id in (select public.my_customer_ids()));
drop policy if exists settlements_manager_all on public.settlements;
create policy settlements_manager_all on public.settlements for all to public using(public.is_company_manager(company_id)) with check(public.is_company_manager(company_id));
drop policy if exists settlements_supplier_read on public.settlements;
create policy settlements_supplier_read on public.settlements for select to public using(supplier_id in (select public.my_supplier_ids()));
drop policy if exists notifications_own_read on public.notifications;
create policy notifications_own_read on public.notifications for select to public using(user_id=public.medar_user_id());
drop policy if exists notifications_own_update on public.notifications;
create policy notifications_own_update on public.notifications for update to public using(user_id=public.medar_user_id()) with check(user_id=public.medar_user_id());
drop policy if exists notifications_internal_insert on public.notifications;
create policy notifications_internal_insert on public.notifications for insert to public with check(public.is_company_internal(company_id));
drop policy if exists audit_manager_read on public.audit_events;
create policy audit_manager_read on public.audit_events for select to public using(public.is_company_manager(company_id));

-- Storage evidence is private; path = <company_uuid>/<shipment_uuid>/<filename>. Image evidence is not food-safety certification.
-- delivery-evidence is provisioned as a private Cloudflare R2 bucket by the Worker deployment.




-- Role-specific read paths needed by the customer/supplier portals.
drop policy if exists products_supplier_read on public.products;
create policy products_supplier_read on public.products for select to public using(active and exists(select 1 from public.memberships m where m.company_id=products.company_id and m.user_id=public.medar_user_id() and m.active and m.role='supplier'));
drop policy if exists orders_supplier_read on public.orders;
create policy orders_supplier_read on public.orders for select to public using(exists(select 1 from public.order_items oi where oi.order_id=orders.id and oi.company_id=orders.company_id and oi.supplier_id in (select public.my_supplier_ids())));
drop policy if exists shipments_customer_read on public.shipments;
create policy shipments_customer_read on public.shipments for select to public using(exists(select 1 from public.orders o where o.id=shipments.order_id and o.company_id=shipments.company_id and o.customer_id in (select public.my_customer_ids())));

-- Least-privilege database grants: RLS remains the row-level boundary.




-- Membership creation is restricted to grant_membership(); the only direct change permitted is deactivation/reactivation.













-- Atomically allocate one order line against confirmed supplier capacity.
-- The row locks and single transaction prevent the same confirmed capacity being consumed twice.
create or replace function public.allocate_order_item(_company uuid, _order_item uuid, _capacity uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  oid uuid; pid uuid; qty numeric; current_supplier uuid; current_capacity uuid; order_state public.order_status; due_on date;
  cap_supplier uuid; cap_product uuid; cap_start date; cap_end date; cap_confirmed numeric; cap_committed numeric; cap_state public.capacity_status; new_committed numeric;
begin
  if not public.is_company_manager(_company) then raise exception 'فقط مالک یا مدیر می‌تواند تأمین را تخصیص دهد'; end if;
  select oi.order_id,oi.product_id,oi.quantity,oi.supplier_id,oi.capacity_commitment_id,o.status,coalesce(o.requested_delivery,current_date)
    into oid,pid,qty,current_supplier,current_capacity,order_state,due_on
  from public.order_items oi join public.orders o on o.id=oi.order_id and o.company_id=oi.company_id
  where oi.id=_order_item and oi.company_id=_company for update of oi,o;
  if oid is null then raise exception 'ردیف سفارش در این شرکت پیدا نشد'; end if;
  if order_state not in ('confirmed','allocated') then raise exception 'ابتدا سفارش باید تأیید شده باشد'; end if;
  if current_supplier is not null or current_capacity is not null then raise exception 'این ردیف قبلاً تخصیص یافته است؛ برای تغییر، ابتدا تخصیص قبلی را آزاد کنید'; end if;
  select c.supplier_id,c.product_id,c.period_start,c.period_end,c.confirmed_qty,c.committed_qty,c.status
    into cap_supplier,cap_product,cap_start,cap_end,cap_confirmed,cap_committed,cap_state
  from public.capacity_commitments c where c.id=_capacity and c.company_id=_company for update;
  if cap_supplier is null then raise exception 'رکورد ظرفیت پیدا نشد'; end if;
  if cap_product<>pid then raise exception 'محصول ظرفیت با محصول سفارش یکسان نیست'; end if;
  if cap_state not in ('confirmed','committed') or cap_confirmed is null then raise exception 'این ظرفیت هنوز تأیید نشده است'; end if;
  if due_on<cap_start or due_on>cap_end then raise exception 'تاریخ تحویل در بازه ظرفیت تأییدشده نیست'; end if;
  new_committed:=coalesce(cap_committed,0)+qty;
  if new_committed>cap_confirmed then raise exception 'ظرفیت آزاد کافی نیست؛ مقدار آزاد: %', greatest(0,cap_confirmed-coalesce(cap_committed,0)); end if;
  update public.capacity_commitments set committed_qty=new_committed,status=case when new_committed>=cap_confirmed then 'committed'::public.capacity_status else 'confirmed'::public.capacity_status end where id=_capacity and company_id=_company;
  perform set_config('simorgh.allow_capacity_allocation','on',true);
  update public.order_items set supplier_id=cap_supplier,capacity_commitment_id=_capacity where id=_order_item and company_id=_company;
  if not exists(select 1 from public.order_items oi where oi.order_id=oid and oi.company_id=_company and oi.supplier_id is null) then
    update public.orders set status='allocated' where id=oid and company_id=_company and status='confirmed';
  end if;
end $$;



-- Force policies to apply even when queries use the database owner role from the Worker.
do $$ declare table_name text; begin foreach table_name in array array['customers','suppliers','products','price_agreements','orders','order_items','capacity_commitments','lots','quality_reviews','shipments','delivery_evidence','invoices','settlements','notifications','audit_events'] loop execute format('alter table public.%I force row level security', table_name); end loop; end $$;
