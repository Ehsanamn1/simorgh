-- Medar operational schema ported from the existing Simorgh Supabase migrations.
-- This migration creates relational tables and indexes only. Supabase RLS policies/triggers/functions
-- are intentionally not copied: all access must go through the authenticated Worker API.
-- It is additive and does not delete existing rows.

-- 1. PostgreSQL enum types.
DO $$ BEGIN CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'staff', 'customer', 'supplier', 'driver'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'staff';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'customer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'supplier';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'driver';
DO $$ BEGIN CREATE TYPE public.product_kind AS ENUM ('eggs', 'meat', 'other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE public.product_kind ADD VALUE IF NOT EXISTS 'eggs';
ALTER TYPE public.product_kind ADD VALUE IF NOT EXISTS 'meat';
ALTER TYPE public.product_kind ADD VALUE IF NOT EXISTS 'other';
DO $$ BEGIN CREATE TYPE public.order_status AS ENUM ('draft', 'submitted', 'confirmed', 'allocated', 'in_fulfillment', 'dispatched', 'delivered', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'submitted';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'confirmed';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'allocated';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'in_fulfillment';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'dispatched';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'delivered';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'cancelled';
DO $$ BEGIN CREATE TYPE public.capacity_status AS ENUM ('declared', 'confirmed', 'committed', 'released', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE public.capacity_status ADD VALUE IF NOT EXISTS 'declared';
ALTER TYPE public.capacity_status ADD VALUE IF NOT EXISTS 'confirmed';
ALTER TYPE public.capacity_status ADD VALUE IF NOT EXISTS 'committed';
ALTER TYPE public.capacity_status ADD VALUE IF NOT EXISTS 'released';
ALTER TYPE public.capacity_status ADD VALUE IF NOT EXISTS 'cancelled';
DO $$ BEGIN CREATE TYPE public.lot_status AS ENUM ('pending_review', 'released', 'on_hold', 'rejected', 'consumed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE public.lot_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE public.lot_status ADD VALUE IF NOT EXISTS 'released';
ALTER TYPE public.lot_status ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE public.lot_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE public.lot_status ADD VALUE IF NOT EXISTS 'consumed';
DO $$ BEGIN CREATE TYPE public.review_result AS ENUM ('pass', 'conditional', 'fail'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE public.review_result ADD VALUE IF NOT EXISTS 'pass';
ALTER TYPE public.review_result ADD VALUE IF NOT EXISTS 'conditional';
ALTER TYPE public.review_result ADD VALUE IF NOT EXISTS 'fail';
DO $$ BEGIN CREATE TYPE public.shipment_stage AS ENUM ('planned', 'loading', 'in_transit', 'arrived', 'delivered', 'failed', 'returned'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE public.shipment_stage ADD VALUE IF NOT EXISTS 'planned';
ALTER TYPE public.shipment_stage ADD VALUE IF NOT EXISTS 'loading';
ALTER TYPE public.shipment_stage ADD VALUE IF NOT EXISTS 'in_transit';
ALTER TYPE public.shipment_stage ADD VALUE IF NOT EXISTS 'arrived';
ALTER TYPE public.shipment_stage ADD VALUE IF NOT EXISTS 'delivered';
ALTER TYPE public.shipment_stage ADD VALUE IF NOT EXISTS 'failed';
ALTER TYPE public.shipment_stage ADD VALUE IF NOT EXISTS 'returned';
DO $$ BEGIN CREATE TYPE public.invoice_status AS ENUM ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'issued';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'partially_paid';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'paid';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'overdue';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'void';
DO $$ BEGIN CREATE TYPE public.settlement_status AS ENUM ('pending', 'approved', 'paid', 'disputed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE public.settlement_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE public.settlement_status ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE public.settlement_status ADD VALUE IF NOT EXISTS 'paid';
ALTER TYPE public.settlement_status ADD VALUE IF NOT EXISTS 'disputed';
DO $$ BEGIN CREATE TYPE public.evidence_kind AS ENUM ('photo', 'signature', 'note', 'temperature_reading'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TYPE public.evidence_kind ADD VALUE IF NOT EXISTS 'photo';
ALTER TYPE public.evidence_kind ADD VALUE IF NOT EXISTS 'signature';
ALTER TYPE public.evidence_kind ADD VALUE IF NOT EXISTS 'note';
ALTER TYPE public.evidence_kind ADD VALUE IF NOT EXISTS 'temperature_reading';

-- 2. Create operational tables in source migration order.
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check(length(trim(name)) between 2 and 160), segment text, city text, phone text, address text,
  credit_limit numeric(16,0) check(credit_limit is null or credit_limit >= 0), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,name)
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check(length(trim(name)) between 2 and 160), city text, phone text, farm_registration text,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,name)
);

CREATE TABLE IF NOT EXISTS public.products (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  sku text not null, name text not null check(length(trim(name)) between 2 and 160), kind public.product_kind not null,
  unit text not null default 'کیلوگرم', pack_size integer check(pack_size is null or pack_size>0),
  shelf_life_days integer check(shelf_life_days is null or shelf_life_days>0), storage_note text,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,sku)
);

CREATE TABLE IF NOT EXISTS public.price_agreements (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null, product_id uuid not null, unit_price numeric(16,0) not null check(unit_price>0),
  min_qty integer not null default 1 check(min_qty>0), valid_from date not null default current_date, valid_to date,
  created_at timestamptz not null default now(), created_by uuid REFERENCES public.medar_users(id),
  foreign key(company_id,customer_id) references public.customers(company_id,id) on delete cascade,
  foreign key(company_id,product_id) references public.products(company_id,id) on delete cascade,
  check(valid_to is null or valid_to>=valid_from)
);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null, reference text not null default ('SO-'||to_char(now(),'YYMMDD')||'-'||upper(substr(gen_random_uuid()::text,1,6))),
  status public.order_status not null default 'draft', requested_delivery date, delivery_address text, notes text,
  created_by uuid REFERENCES public.medar_users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(company_id,customer_id) references public.customers(company_id,id) on delete restrict,
  unique(company_id,id), unique(company_id,reference)
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null, product_id uuid not null, quantity numeric(14,3) not null check(quantity>0),
  unit_price numeric(16,0) not null default 0 check(unit_price>=0), supplier_id uuid, lot_id uuid,
  created_at timestamptz not null default now(),
  foreign key(company_id,order_id) references public.orders(company_id,id) on delete cascade,
  foreign key(company_id,product_id) references public.products(company_id,id) on delete restrict,
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict,
  unique(company_id,id)
);

CREATE TABLE IF NOT EXISTS public.capacity_commitments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null, product_id uuid not null, period_start date not null, period_end date not null,
  declared_qty numeric(14,3) not null check(declared_qty>=0), confirmed_qty numeric(14,3) check(confirmed_qty is null or confirmed_qty>=0),
  committed_qty numeric(14,3) check(committed_qty is null or committed_qty>=0), status public.capacity_status not null default 'declared', note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid REFERENCES public.medar_users(id),
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete cascade,
  foreign key(company_id,product_id) references public.products(company_id,id) on delete restrict,
  unique(company_id,id),
  check(period_end>=period_start), check(confirmed_qty is null or confirmed_qty<=declared_qty),
  check(committed_qty is null or confirmed_qty is null or committed_qty<=confirmed_qty)
);

CREATE TABLE IF NOT EXISTS public.lots (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null, product_id uuid not null, code text not null, produced_on date not null, best_before date,
  quantity numeric(14,3) not null check(quantity>0), status public.lot_status not null default 'pending_review',
  created_at timestamptz not null default now(),
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict,
  foreign key(company_id,product_id) references public.products(company_id,id) on delete restrict,
  unique(company_id,id), unique(company_id,code), check(best_before is null or best_before>=produced_on)
);

CREATE TABLE IF NOT EXISTS public.quality_reviews (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  lot_id uuid not null, result public.review_result not null, checklist jsonb not null default '{}'::jsonb, notes text,
  reviewer_id uuid REFERENCES public.medar_users(id), reviewed_at timestamptz not null default now(),
  foreign key(company_id,lot_id) references public.lots(company_id,id) on delete cascade
);

CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null, driver_user_id uuid REFERENCES public.medar_users(id) on delete set null, vehicle text,
  stage public.shipment_stage not null default 'planned', planned_departure timestamptz, departed_at timestamptz, delivered_at timestamptz,
  failure_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(company_id,order_id) references public.orders(company_id,id) on delete restrict, unique(company_id,id)
);

CREATE TABLE IF NOT EXISTS public.delivery_evidence (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  shipment_id uuid not null, kind public.evidence_kind not null, storage_path text, recipient_name text, note text,
  reading_celsius numeric(5,2), captured_by uuid REFERENCES public.medar_users(id), captured_at timestamptz not null default now(),
  foreign key(company_id,shipment_id) references public.shipments(company_id,id) on delete cascade,
  check(kind<>'temperature_reading' or reading_celsius is not null)
);

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  order_id uuid not null, customer_id uuid not null, reference text not null, amount numeric(16,0) not null check(amount>=0),
  paid_amount numeric(16,0) not null default 0 check(paid_amount>=0 and paid_amount<=amount), due_date date,
  status public.invoice_status not null default 'draft', issued_at timestamptz, created_at timestamptz not null default now(),
  foreign key(company_id,order_id) references public.orders(company_id,id) on delete restrict,
  foreign key(company_id,customer_id) references public.customers(company_id,id) on delete restrict,
  unique(company_id,reference)
);

CREATE TABLE IF NOT EXISTS public.settlements (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null, invoice_ref text, amount numeric(16,0) not null check(amount>=0), due_date date,
  status public.settlement_status not null default 'pending', note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null REFERENCES public.medar_users(id) on delete cascade, title text not null, body text, href text,
  read_at timestamptz, created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid REFERENCES public.medar_users(id) on delete set null, table_name text not null, record_id uuid, action text not null,
  changes jsonb, occurred_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.farm_sites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid,
  site_code text not null check (length(trim(site_code)) between 2 and 48),
  name text not null check (length(trim(name)) between 2 and 180),
  province text not null default 'گلستان',
  city text,
  address text,
  registration_reference text,
  license_expires_on date,
  timezone text not null default 'Asia/Tehran',
  active boolean not null default true,
  created_by uuid REFERENCES public.medar_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,site_code),
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict
);

CREATE TABLE IF NOT EXISTS public.partnership_agreements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null,
  agreement_code text not null check (length(trim(agreement_code)) between 2 and 60),
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft','pending_signature','active','suspended','expired','terminated')),
  effective_from date not null,
  effective_to date,
  company_profit_share_pct numeric(5,2) not null default 50 check (company_profit_share_pct between 0 and 100),
  partner_profit_share_pct numeric(5,2) not null default 50 check (partner_profit_share_pct between 0 and 100),
  shared_expense_categories text[] not null default '{}'::text[],
  settlement_basis text not null default 'collected_cash' check (settlement_basis in ('collected_cash','accrual')),
  settlement_due_days integer not null default 14 check (settlement_due_days between 0 and 365),
  terms jsonb not null default '{}'::jsonb,
  signed_document_path text,
  signed_at timestamptz,
  supersedes_agreement_id uuid,
  approved_by uuid REFERENCES public.medar_users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid REFERENCES public.medar_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,supplier_id,id),
  unique(company_id,agreement_code,version),
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict,
  foreign key(company_id,supplier_id,supersedes_agreement_id) references public.partnership_agreements(company_id,supplier_id,id) on delete restrict,
  check (company_profit_share_pct + partner_profit_share_pct = 100),
  check (effective_to is null or effective_to >= effective_from),
  check ((status <> 'active') or (signed_at is not null and signed_document_path is not null and approved_by is not null and approved_at is not null and cardinality(shared_expense_categories)>0))
);

CREATE TABLE IF NOT EXISTS public.flock_cycles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  farm_site_id uuid not null,
  cycle_code text not null check (length(trim(cycle_code)) between 2 and 60),
  species text not null default 'quail' check (species = 'quail'),
  arrived_on date,
  planned_end_on date,
  ended_on date,
  initial_bird_count integer check (initial_bird_count is null or initial_bird_count >= 0),
  status text not null default 'planned' check (status in ('planned','active','paused','completed','cancelled')),
  source_reference text,
  notes text,
  created_by uuid REFERENCES public.medar_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,farm_site_id,cycle_code),
  foreign key(company_id,farm_site_id) references public.farm_sites(company_id,id) on delete restrict,
  check (planned_end_on is null or arrived_on is null or planned_end_on >= arrived_on),
  check (ended_on is null or arrived_on is null or ended_on >= arrived_on)
);

CREATE TABLE IF NOT EXISTS public.production_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  farm_site_id uuid not null,
  supplier_id uuid,
  agreement_id uuid,
  flock_cycle_id uuid,
  product_id uuid,
  lot_id uuid,
  batch_code text not null check (length(trim(batch_code)) between 2 and 80),
  production_kind text not null check (production_kind in ('eggs','meat','other')),
  status text not null default 'planned' check (status in ('planned','active','submitted_for_review','approved','on_hold','rejected','completed','cancelled')),
  unit text not null default 'کیلوگرم',
  planned_quantity numeric(14,3) check (planned_quantity is null or planned_quantity >= 0),
  produced_quantity numeric(14,3) not null default 0 check (produced_quantity >= 0),
  rejected_quantity numeric(14,3) not null default 0 check (rejected_quantity >= 0 and rejected_quantity <= produced_quantity),
  started_on date,
  expected_on date,
  completed_on date,
  quality_status text not null default 'not_inspected' check (quality_status in ('not_inspected','pending','passed','conditional','failed')),
  manager_notes text,
  created_by uuid REFERENCES public.medar_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,batch_code),
  foreign key(company_id,farm_site_id) references public.farm_sites(company_id,id) on delete restrict,
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict,
  foreign key(company_id,agreement_id) references public.partnership_agreements(company_id,id) on delete restrict,
  foreign key(company_id,flock_cycle_id) references public.flock_cycles(company_id,id) on delete restrict,
  foreign key(company_id,product_id) references public.products(company_id,id) on delete restrict,
  foreign key(company_id,lot_id) references public.lots(company_id,id) on delete restrict,
  check (expected_on is null or started_on is null or expected_on >= started_on),
  check (completed_on is null or started_on is null or completed_on >= started_on)
);

CREATE TABLE IF NOT EXISTS public.daily_production_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  batch_id uuid not null,
  record_date date not null,
  shift_label text not null default 'daily',
  feed_consumed_kg numeric(14,3) not null default 0 check (feed_consumed_kg >= 0),
  mortality_count integer not null default 0 check (mortality_count >= 0),
  eggs_collected integer not null default 0 check (eggs_collected >= 0),
  eggs_rejected integer not null default 0 check (eggs_rejected >= 0 and eggs_rejected <= eggs_collected),
  produced_quantity numeric(14,3) check (produced_quantity is null or produced_quantity >= 0),
  average_weight_grams numeric(10,2) check (average_weight_grams is null or average_weight_grams >= 0),
  note text,
  recorded_by uuid REFERENCES public.medar_users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,batch_id) references public.production_batches(company_id,id) on delete restrict
);

CREATE TABLE IF NOT EXISTS public.task_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  template_code text not null check (length(trim(template_code)) between 2 and 60),
  version integer not null default 1 check (version > 0),
  title text not null check (length(trim(title)) between 2 and 180),
  instructions text not null,
  category text not null default 'operations',
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  evidence_required boolean not null default false,
  expected_evidence_types text[] not null default '{}'::text[],
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  approved_by uuid REFERENCES public.medar_users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid REFERENCES public.medar_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,template_code,version),
  check ((status <> 'approved') or (approved_by is not null and approved_at is not null))
);

CREATE TABLE IF NOT EXISTS public.operational_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  farm_site_id uuid,
  batch_id uuid,
  template_id uuid,
  assignee_user_id uuid REFERENCES public.medar_users(id) on delete set null,
  assignee_supplier_id uuid,
  assigned_by uuid REFERENCES public.medar_users(id) on delete set null,
  title text not null check (length(trim(title)) between 2 and 180),
  instructions_snapshot text not null default '',
  category text not null default 'operations',
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'pending' check (status in ('pending','in_progress','submitted','approved','rejected','blocked','cancelled')),
  due_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.medar_users(id) on delete set null,
  completion_note text,
  review_note text,
  evidence_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,farm_site_id) references public.farm_sites(company_id,id) on delete restrict,
  foreign key(company_id,batch_id) references public.production_batches(company_id,id) on delete restrict,
  foreign key(company_id,template_id) references public.task_templates(company_id,id) on delete restrict,
  foreign key(company_id,assignee_supplier_id) references public.suppliers(company_id,id) on delete restrict,
  check (assignee_user_id is not null or assignee_supplier_id is not null),
  check (status <> 'approved' or (reviewed_by is not null and reviewed_at is not null)),
  check (status <> 'submitted' or submitted_at is not null)
);

CREATE TABLE IF NOT EXISTS public.task_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  task_id uuid not null,
  evidence_type text not null check (evidence_type in ('photo','document','note','measurement')),
  storage_path text,
  note text,
  measurement_value numeric(14,3),
  measurement_unit text,
  uploaded_by uuid REFERENCES public.medar_users(id) on delete set null,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,task_id) references public.operational_tasks(company_id,id) on delete restrict,
  check ((evidence_type in ('photo','document') and storage_path is not null) or (evidence_type in ('note','measurement'))),
  constraint task_evidence_storage_path_scope_check check (storage_path is null or storage_path like (company_id::text || '/' || task_id::text || '/%')), 
  constraint task_evidence_note_nonempty_check check (evidence_type <> 'note' or length(trim(coalesce(note,'')))>0),
  check (evidence_type <> 'measurement' or measurement_value is not null)
);

CREATE TABLE IF NOT EXISTS public.operational_incidents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  farm_site_id uuid,
  batch_id uuid,
  task_id uuid,
  reported_by uuid REFERENCES public.medar_users(id) on delete set null,
  reported_supplier_id uuid,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  category text not null check (category in ('production','quality','animal_welfare','inventory','safety','logistics','finance','other')),
  title text not null check (length(trim(title)) between 3 and 180),
  description text not null default '',
  status text not null default 'open' check (status in ('open','investigating','action_required','resolved','closed')),
  resolution_note text,
  resolved_by uuid REFERENCES public.medar_users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,farm_site_id) references public.farm_sites(company_id,id) on delete restrict,
  foreign key(company_id,batch_id) references public.production_batches(company_id,id) on delete restrict,
  foreign key(company_id,task_id) references public.operational_tasks(company_id,id) on delete restrict,
  foreign key(company_id,reported_supplier_id) references public.suppliers(company_id,id) on delete restrict,
  check (status not in ('resolved','closed') or (resolved_by is not null and resolved_at is not null))
);

CREATE TABLE IF NOT EXISTS public.partner_financial_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null,
  agreement_id uuid not null,
  entry_type text not null check (entry_type in ('sale_invoice','sale_collection','expense','partner_advance','settlement_payment','adjustment')),
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','posted')),
  direction text not null default 'not_cash' check (direction in ('not_cash','inflow_to_company','outflow_from_company','company_to_partner','partner_to_company')),
  amount numeric(16,0) not null check (amount > 0),
  paid_amount numeric(16,0) not null default 0 check (paid_amount >= 0 and paid_amount <= amount),
  currency text not null default 'TOMAN' check (currency in ('IRR','TOMAN')),
  expense_category text,
  is_shared_cost boolean not null default false,
  paid_by text not null default 'none' check (paid_by in ('none','company','partner','customer','vendor','third_party')),
  payment_status text not null default 'not_applicable' check (payment_status in ('not_applicable','unpaid','partial','paid')),
  recognized_on date not null default current_date,
  external_reference text,
  source_table text,
  source_record_id uuid,
  linked_entry_id uuid,
  adjustment_effect text check (adjustment_effect in ('increase','decrease')),
  notes text,
  submitted_by uuid REFERENCES public.medar_users(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid REFERENCES public.medar_users(id) on delete set null,
  approved_at timestamptz,
  posted_by uuid REFERENCES public.medar_users(id) on delete set null,
  posted_at timestamptz,
  created_by uuid REFERENCES public.medar_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict,
  foreign key(company_id,agreement_id) references public.partnership_agreements(company_id,id) on delete restrict,
  foreign key(company_id,linked_entry_id) references public.partner_financial_entries(company_id,id) on delete restrict,
  unique(company_id,external_reference),
  check (payment_status <> 'paid' or paid_amount = amount),
  check (payment_status <> 'partial' or (paid_amount > 0 and paid_amount < amount)),
  check (entry_type <> 'expense' or expense_category is not null),
  check (not is_shared_cost or entry_type = 'expense'),
  check (entry_type <> 'sale_invoice' or direction = 'not_cash'),
  check (entry_type <> 'sale_collection' or direction = 'inflow_to_company'),
  check (entry_type <> 'expense' or direction in ('not_cash','outflow_from_company')),
  check (entry_type <> 'partner_advance' or direction in ('company_to_partner','partner_to_company')),
  check (entry_type <> 'settlement_payment' or direction in ('company_to_partner','partner_to_company')),
  check ((entry_type='adjustment' and linked_entry_id is not null and adjustment_effect is not null) or (entry_type<>'adjustment' and adjustment_effect is null)),
  check (status <> 'posted' or (posted_at is not null and posted_by is not null)),
  constraint partner_financial_posted_sale_collection_evidence_check check (entry_type <> 'sale_collection' or status <> 'posted' or (paid_amount=amount and payment_status='paid' and external_reference is not null)), 
  constraint partner_financial_posted_cash_entry_evidence_check check (entry_type not in ('partner_advance','settlement_payment') or status <> 'posted' or (paid_amount=amount and payment_status='paid' and external_reference is not null))
);

CREATE TABLE IF NOT EXISTS public.partner_settlement_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null,
  agreement_id uuid not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','approved','settled','disputed','cancelled')),
  currency text not null default 'TOMAN' check (currency in ('IRR','TOMAN')),
  invoiced_revenue numeric(16,0) not null default 0,
  collected_revenue numeric(16,0) not null default 0,
  recognized_revenue numeric(16,0) not null default 0,
  approved_shared_expenses numeric(16,0) not null default 0,
  unpaid_approved_expenses numeric(16,0) not null default 0,
  company_paid_shared_expenses numeric(16,0) not null default 0,
  partner_paid_shared_expenses numeric(16,0) not null default 0,
  net_result numeric(16,0) not null default 0,
  company_share_amount numeric(16,0) not null default 0,
  partner_share_amount numeric(16,0) not null default 0,
  balance_due_to_partner numeric(16,0) not null default 0,
  balance_due_to_company numeric(16,0) not null default 0,
  recorded_cash_available numeric(16,0) not null default 0,
  settled_amount numeric(16,0) not null default 0 check (settled_amount >= 0),
  calculation_snapshot jsonb not null default '{}'::jsonb,
  calculated_at timestamptz,
  approved_by uuid REFERENCES public.medar_users(id) on delete set null,
  approved_at timestamptz,
  settled_by uuid REFERENCES public.medar_users(id) on delete set null,
  settled_at timestamptz,
  created_by uuid REFERENCES public.medar_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,agreement_id,period_start,period_end),
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict,
  foreign key(company_id,agreement_id) references public.partnership_agreements(company_id,id) on delete restrict,
  check (period_end >= period_start),
  check (balance_due_to_partner = 0 or balance_due_to_company = 0),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
  check (status <> 'settled' or (settled_by is not null and settled_at is not null))
);

CREATE TABLE IF NOT EXISTS public.shipment_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  driver_user_id uuid not null REFERENCES public.medar_users(id) on delete cascade,
  latitude double precision not null check (latitude >= -90 and latitude <= 90),
  longitude double precision not null check (longitude >= -180 and longitude <= 180),
  accuracy_m double precision check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000)),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('purchase_in','sale_out','adjustment_in','adjustment_out','waste_out','return_in')),
  quantity numeric(16,3) not null check (quantity > 0),
  unit_cost numeric(16,2) check (unit_cost is null or unit_cost >= 0),
  supplier_id uuid references public.suppliers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  lot_id uuid references public.lots(id) on delete set null,
  reference_code text check (reference_code is null or length(reference_code) <= 120),
  note text check (note is null or length(note) <= 2000),
  recorded_by uuid REFERENCES public.medar_users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS public.company_goals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null check (length(trim(title)) between 3 and 160),
  description text not null default '' check (length(description) <= 3000),
  category text not null default 'operations'
    check (category in ('operations','production','sales','quality','logistics','finance','people','growth','other')),
  unit text not null default '' check (length(unit) <= 40),
  baseline_value numeric(18,3) not null default 0,
  target_value numeric(18,3) not null default 0,
  current_value numeric(18,3) not null default 0,
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'planned' check (status in ('planned','active','at_risk','achieved','paused','cancelled')),
  period_start date,
  due_date date,
  owner_user_id uuid REFERENCES public.medar_users(id) on delete set null,
  created_by uuid REFERENCES public.medar_users(id) on delete set null,
  updated_by uuid REFERENCES public.medar_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or period_start is null or due_date >= period_start),
  check (target_value >= 0)
);

-- 3. Add missing compatibility columns to the existing foundation tables.
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS vehicle text;
ALTER TABLE public.medar_users ALTER COLUMN phone_e164 DROP NOT NULL;
ALTER TABLE public.medar_users DROP CONSTRAINT IF EXISTS medar_users_active_phone_required;
ALTER TABLE public.medar_users ADD CONSTRAINT medar_users_active_phone_required CHECK (account_status <> 'active' OR phone_e164 IS NOT NULL);
-- Keep new foreign-key fields nullable until request review and data reconciliation are complete.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS legal_name text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS province text DEFAULT 'نامشخص';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'Asia/Tehran';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS customer_id uuid;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS supplier_id uuid;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS customer_id uuid;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS supplier_id uuid;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS organization_name text;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.medar_users(id) ON DELETE SET NULL;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
DO $
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'access_requests'
      AND column_name = 'company_name'
  ) THEN
    EXECUTE 'UPDATE public.access_requests SET organization_name = company_name WHERE organization_name IS NULL AND company_name IS NOT NULL';
  END IF;
END $;

-- 4. Add later schema columns (idempotent).
ALTER TABLE public.order_items add column if not exists capacity_commitment_id uuid;
ALTER TABLE public.farm_sites add column if not exists site_type text not null default 'mixed',
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
ALTER TABLE public.flock_cycles add column if not exists cycle_type text not null default 'poultry',
  add column if not exists initial_quantity numeric(14,3),
  add column if not exists quantity_unit text not null default 'عدد';
ALTER TABLE public.daily_production_records add column if not exists resource_name text,
  add column if not exists input_quantity numeric(14,3) not null default 0,
  add column if not exists input_unit text not null default 'کیلوگرم',
  add column if not exists loss_quantity numeric(14,3) not null default 0,
  add column if not exists loss_unit text not null default 'عدد';
ALTER TABLE public.farm_sites add column if not exists site_type text not null default 'mixed';
ALTER TABLE public.farm_sites add column if not exists latitude double precision;
ALTER TABLE public.farm_sites add column if not exists longitude double precision;
ALTER TABLE public.flock_cycles add column if not exists cycle_type text not null default 'poultry';
ALTER TABLE public.flock_cycles add column if not exists initial_quantity numeric(14,3);
ALTER TABLE public.flock_cycles add column if not exists quantity_unit text not null default 'عدد';
ALTER TABLE public.daily_production_records add column if not exists resource_name text;
ALTER TABLE public.daily_production_records add column if not exists input_quantity numeric(14,3) not null default 0;
ALTER TABLE public.daily_production_records add column if not exists input_unit text not null default 'کیلوگرم';
ALTER TABLE public.daily_production_records add column if not exists loss_quantity numeric(14,3) not null default 0;
ALTER TABLE public.daily_production_records add column if not exists loss_unit text not null default 'عدد';
ALTER TABLE public.daily_production_records add column if not exists rejected_quantity numeric(14,3) not null default 0;

-- 5. Access requests use Medar identities, not Neon Auth identities.
ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS membership_role_scope;
ALTER TABLE public.memberships ADD CONSTRAINT membership_role_scope CHECK (
  (role='customer' AND customer_id IS NOT NULL AND supplier_id IS NULL) OR
  (role='supplier' AND supplier_id IS NOT NULL AND customer_id IS NULL) OR
  (role NOT IN ('customer','supplier') AND customer_id IS NULL AND supplier_id IS NULL)
);
ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_company_id_customer_id_fkey;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_company_id_customer_id_fkey FOREIGN KEY(company_id,customer_id) REFERENCES public.customers(company_id,id) ON DELETE CASCADE;
ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_company_id_supplier_id_fkey;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_company_id_supplier_id_fkey FOREIGN KEY(company_id,supplier_id) REFERENCES public.suppliers(company_id,id) ON DELETE CASCADE;
ALTER TABLE public.access_requests DROP CONSTRAINT IF EXISTS access_requests_company_id_customer_id_fkey;
ALTER TABLE public.access_requests ADD CONSTRAINT access_requests_company_id_customer_id_fkey FOREIGN KEY(company_id,customer_id) REFERENCES public.customers(company_id,id) ON DELETE CASCADE;
ALTER TABLE public.access_requests DROP CONSTRAINT IF EXISTS access_requests_company_id_supplier_id_fkey;
ALTER TABLE public.access_requests ADD CONSTRAINT access_requests_company_id_supplier_id_fkey FOREIGN KEY(company_id,supplier_id) REFERENCES public.suppliers(company_id,id) ON DELETE CASCADE;
ALTER TABLE public.access_requests DROP CONSTRAINT IF EXISTS access_requests_user_id_fkey;
ALTER TABLE public.access_requests ADD CONSTRAINT access_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.medar_users(id) ON DELETE CASCADE;
UPDATE public.access_requests SET organization_name = company_name WHERE organization_name IS NULL AND company_name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending_per_role ON public.access_requests(user_id, requested_role) WHERE status='pending';

-- 6. Generalized farm/product constraints from later source migrations.
ALTER TABLE public.products ALTER COLUMN kind TYPE text USING kind::text;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_kind_check;
ALTER TABLE public.products ADD CONSTRAINT products_kind_check
  CHECK (kind IN ('farm_product','crop','livestock','poultry','aquaculture','dairy','eggs','meat','honey','forestry','greenhouse','orchard','input','feed','equipment','processed','service','other'));

ALTER TABLE public.production_batches DROP CONSTRAINT IF EXISTS production_batches_production_kind_check;
ALTER TABLE public.production_batches ADD CONSTRAINT production_batches_production_kind_check
  CHECK (production_kind IN ('farm_product','crop','livestock','poultry','dairy','eggs','meat','aquaculture','honey','forestry','greenhouse','orchard','input','feed','equipment','processed','service','other'));

ALTER TABLE public.farm_sites ALTER COLUMN province SET DEFAULT 'نامشخص';
ALTER TABLE public.farm_sites ALTER COLUMN province DROP NOT NULL;
ALTER TABLE public.farm_sites DROP CONSTRAINT IF EXISTS farm_sites_site_type_check;
ALTER TABLE public.farm_sites ADD CONSTRAINT farm_sites_site_type_check
  CHECK (site_type IN ('crop','livestock','poultry','dairy','aquaculture','greenhouse','orchard','apiary','processing','warehouse','distribution','mixed','other'));
ALTER TABLE public.farm_sites DROP CONSTRAINT IF EXISTS farm_sites_coordinates_pair_check;
ALTER TABLE public.farm_sites ADD CONSTRAINT farm_sites_coordinates_pair_check
  CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180));

ALTER TABLE public.flock_cycles ALTER COLUMN species SET DEFAULT 'عمومی';
ALTER TABLE public.flock_cycles ALTER COLUMN cycle_type SET DEFAULT 'mixed';
ALTER TABLE public.flock_cycles DROP CONSTRAINT IF EXISTS flock_cycles_species_check;
ALTER TABLE public.flock_cycles ADD CONSTRAINT flock_cycles_species_check CHECK (length(trim(species)) BETWEEN 1 AND 80);
ALTER TABLE public.flock_cycles DROP CONSTRAINT IF EXISTS flock_cycles_cycle_type_check;
ALTER TABLE public.flock_cycles ADD CONSTRAINT flock_cycles_cycle_type_check
  CHECK (cycle_type IN ('crop','livestock','poultry','dairy','aquaculture','greenhouse','orchard','apiary','mixed','other'));
ALTER TABLE public.flock_cycles DROP CONSTRAINT IF EXISTS flock_cycles_initial_quantity_check;
ALTER TABLE public.flock_cycles ADD CONSTRAINT flock_cycles_initial_quantity_check CHECK (initial_quantity IS NULL OR initial_quantity >= 0);
ALTER TABLE public.flock_cycles DROP CONSTRAINT IF EXISTS flock_cycles_quantity_unit_check;
ALTER TABLE public.flock_cycles ADD CONSTRAINT flock_cycles_quantity_unit_check CHECK (length(trim(quantity_unit)) BETWEEN 1 AND 24);

ALTER TABLE public.daily_production_records DROP CONSTRAINT IF EXISTS daily_production_records_resource_name_check;
ALTER TABLE public.daily_production_records ADD CONSTRAINT daily_production_records_resource_name_check CHECK (resource_name IS NULL OR length(trim(resource_name)) <= 120);
ALTER TABLE public.daily_production_records DROP CONSTRAINT IF EXISTS daily_production_records_input_quantity_check;
ALTER TABLE public.daily_production_records ADD CONSTRAINT daily_production_records_input_quantity_check CHECK (input_quantity >= 0);
ALTER TABLE public.daily_production_records DROP CONSTRAINT IF EXISTS daily_production_records_input_unit_check;
ALTER TABLE public.daily_production_records ADD CONSTRAINT daily_production_records_input_unit_check CHECK (length(trim(input_unit)) BETWEEN 1 AND 24);
ALTER TABLE public.daily_production_records DROP CONSTRAINT IF EXISTS daily_production_records_loss_quantity_check;
ALTER TABLE public.daily_production_records ADD CONSTRAINT daily_production_records_loss_quantity_check CHECK (loss_quantity >= 0);
ALTER TABLE public.daily_production_records DROP CONSTRAINT IF EXISTS daily_production_records_loss_unit_check;
ALTER TABLE public.daily_production_records ADD CONSTRAINT daily_production_records_loss_unit_check CHECK (length(trim(loss_unit)) BETWEEN 1 AND 24);
ALTER TABLE public.daily_production_records DROP CONSTRAINT IF EXISTS daily_production_records_rejected_quantity_check;
ALTER TABLE public.daily_production_records ADD CONSTRAINT daily_production_records_rejected_quantity_check
  CHECK (rejected_quantity >= 0 AND (rejected_quantity = 0 OR (produced_quantity IS NOT NULL AND rejected_quantity <= produced_quantity)));

ALTER TABLE public.company_goals DROP CONSTRAINT IF EXISTS company_goals_baseline_nonnegative;
ALTER TABLE public.company_goals ADD CONSTRAINT company_goals_baseline_nonnegative CHECK (baseline_value >= 0);
ALTER TABLE public.company_goals DROP CONSTRAINT IF EXISTS company_goals_current_nonnegative;
ALTER TABLE public.company_goals ADD CONSTRAINT company_goals_current_nonnegative CHECK (current_value >= 0);
ALTER TABLE public.company_goals DROP CONSTRAINT IF EXISTS company_goals_target_above_baseline;
ALTER TABLE public.company_goals ADD CONSTRAINT company_goals_target_above_baseline CHECK (target_value > baseline_value);

-- 7. Query indexes.
CREATE INDEX IF NOT EXISTS memberships_user_idx on public.memberships(user_id,active);
CREATE INDEX IF NOT EXISTS price_agreements_lookup_idx on public.price_agreements(company_id,customer_id,product_id,valid_from);
CREATE INDEX IF NOT EXISTS orders_company_status_idx on public.orders(company_id,status,created_at desc);
CREATE INDEX IF NOT EXISTS orders_customer_idx on public.orders(customer_id,created_at desc);
CREATE INDEX IF NOT EXISTS order_items_order_idx on public.order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_supplier_idx on public.order_items(supplier_id);
CREATE INDEX IF NOT EXISTS shipment_driver_idx on public.shipments(driver_user_id,stage);
CREATE INDEX IF NOT EXISTS audit_company_date_idx on public.audit_events(company_id,occurred_at desc);
CREATE INDEX IF NOT EXISTS partnership_agreement_supplier_status_idx on public.partnership_agreements(company_id,supplier_id,status,effective_from desc);
CREATE INDEX IF NOT EXISTS flock_cycles_site_status_idx on public.flock_cycles(company_id,farm_site_id,status);
CREATE INDEX IF NOT EXISTS production_batches_site_status_idx on public.production_batches(company_id,farm_site_id,status,expected_on);
CREATE INDEX IF NOT EXISTS production_batches_supplier_idx on public.production_batches(company_id,supplier_id,created_at desc);
CREATE INDEX IF NOT EXISTS daily_production_batch_date_idx on public.daily_production_records(company_id,batch_id,record_date desc);
CREATE INDEX IF NOT EXISTS operational_tasks_user_queue_idx on public.operational_tasks(company_id,assignee_user_id,status,due_at);
CREATE INDEX IF NOT EXISTS operational_tasks_supplier_queue_idx on public.operational_tasks(company_id,assignee_supplier_id,status,due_at);
CREATE INDEX IF NOT EXISTS task_evidence_task_idx on public.task_evidence(company_id,task_id,captured_at desc);
CREATE INDEX IF NOT EXISTS operational_incidents_open_idx on public.operational_incidents(company_id,status,severity,created_at desc);
CREATE INDEX IF NOT EXISTS partner_financial_supplier_date_idx on public.partner_financial_entries(company_id,supplier_id,recognized_on desc);
CREATE INDEX IF NOT EXISTS partner_financial_agreement_date_idx on public.partner_financial_entries(company_id,agreement_id,recognized_on,status,entry_type);
CREATE INDEX IF NOT EXISTS partner_financial_source_idx on public.partner_financial_entries(company_id,source_table,source_record_id);
CREATE INDEX IF NOT EXISTS partner_settlement_supplier_idx on public.partner_settlement_periods(company_id,supplier_id,period_end desc,status);
CREATE INDEX IF NOT EXISTS access_requests_company_status_created_idx on public.access_requests(company_id,status,created_at desc);
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending_per_user_company_idx on public.access_requests(company_id,user_id) where status='pending';
CREATE INDEX IF NOT EXISTS shipment_locations_company_captured_idx
  on public.shipment_locations(company_id, captured_at desc);
CREATE INDEX IF NOT EXISTS shipment_locations_shipment_captured_idx
  on public.shipment_locations(shipment_id, captured_at desc);
CREATE INDEX IF NOT EXISTS inventory_movements_company_product_time_idx
  on public.inventory_movements(company_id, product_id, occurred_at desc);
CREATE INDEX IF NOT EXISTS inventory_movements_company_supplier_time_idx
  on public.inventory_movements(company_id, supplier_id, occurred_at desc);
CREATE INDEX IF NOT EXISTS company_goals_company_status_due_idx
  on public.company_goals(company_id, status, due_date);
CREATE INDEX IF NOT EXISTS company_goals_company_created_idx
  on public.company_goals(company_id, created_at desc);
