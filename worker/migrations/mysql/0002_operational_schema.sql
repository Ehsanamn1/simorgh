-- Medar operational schema conversion draft for MySQL 8.0.16+.
-- Converted from worker/migrations/0003_operational_schema.sql.
-- This file is additive and is not approved for production until its disposable-MySQL integration
-- tests pass and the Node/MySQL API has been ported. PostgreSQL-only policies/triggers are not copied.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS customers (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  name VARCHAR(160) not null check(length(trim(name)) between 2 and 160), segment TEXT, city TEXT, phone TEXT, address TEXT,
  credit_limit numeric(16,0) check(credit_limit is null or credit_limit >= 0), active boolean not null default true,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id), unique(company_id,name),
  CONSTRAINT fk_customers_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS suppliers (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  name VARCHAR(160) not null check(length(trim(name)) between 2 and 160), city TEXT, phone TEXT, farm_registration TEXT,
  active boolean not null default true, created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id), unique(company_id,name),
  CONSTRAINT fk_suppliers_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS products (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  sku VARCHAR(80) not null, name VARCHAR(160) not null check(length(trim(name)) between 2 and 160), kind VARCHAR(40) NOT NULL CHECK (kind IN ('eggs','meat','other')),
  unit VARCHAR(64) not null default 'کیلوگرم', pack_size integer check(pack_size is null or pack_size>0),
  shelf_life_days integer check(shelf_life_days is null or shelf_life_days>0), storage_note TEXT,
  active boolean not null default true, created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id), unique(company_id,sku),
  CONSTRAINT fk_products_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS price_agreements (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  customer_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  min_qty integer not null default 1 check(min_qty>0), valid_from date not null DEFAULT (CURRENT_DATE), valid_to date,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3), created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  foreign key(company_id,customer_id) references customers(company_id,id) on delete cascade,
  foreign key(company_id,product_id) references products(company_id,id) on delete cascade,
  check(valid_to is null or valid_to>=valid_from),
  CONSTRAINT fk_price_agreements_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_price_agreements_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  customer_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, reference VARCHAR(120) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','confirmed','allocated','in_fulfillment','dispatched','delivered','cancelled')), requested_delivery date, delivery_address TEXT, notes TEXT,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin, created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  foreign key(company_id,customer_id) references customers(company_id,id) on delete restrict,
  unique(company_id,id), unique(company_id,reference),
  CONSTRAINT fk_orders_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null, product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null, quantity numeric(14,3) not null check(quantity>0),
  unit_price numeric(16,0) not null default 0 check(unit_price>=0), supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin, lot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  foreign key(company_id,order_id) references orders(company_id,id) on delete cascade,
  foreign key(company_id,product_id) references products(company_id,id) on delete restrict,
  foreign key(company_id,supplier_id) references suppliers(company_id,id) on delete restrict,
  unique(company_id,id),
  CONSTRAINT fk_order_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS capacity_commitments (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null, product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null, period_start date not null, period_end date not null,
  declared_qty numeric(14,3) not null check(declared_qty>=0), confirmed_qty numeric(14,3) check(confirmed_qty is null or confirmed_qty>=0),
  committed_qty numeric(14,3) check(committed_qty is null or committed_qty>=0), status VARCHAR(40) NOT NULL DEFAULT 'declared' CHECK (status IN ('declared','confirmed','committed','released','cancelled')), note TEXT,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3), created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  foreign key(company_id,supplier_id) references suppliers(company_id,id) on delete cascade,
  foreign key(company_id,product_id) references products(company_id,id) on delete restrict,
  unique(company_id,id),
  check(period_end>=period_start), check(confirmed_qty is null or confirmed_qty<=declared_qty),
  check(committed_qty is null or confirmed_qty is null or committed_qty<=confirmed_qty),
  CONSTRAINT fk_capacity_commitments_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_capacity_commitments_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS lots (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null, product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null, code VARCHAR(80) not null, produced_on date not null, best_before date,
  quantity numeric(14,3) not null check(quantity>0), status VARCHAR(40) NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','released','on_hold','rejected','consumed')),
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  foreign key(company_id,supplier_id) references suppliers(company_id,id) on delete restrict,
  foreign key(company_id,product_id) references products(company_id,id) on delete restrict,
  unique(company_id,id), unique(company_id,code), check(best_before is null or best_before>=produced_on),
  CONSTRAINT fk_lots_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quality_reviews (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  lot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, result VARCHAR(40) NOT NULL CHECK (result IN ('pass','conditional','fail')), checklist JSON not null DEFAULT (JSON_OBJECT()), notes TEXT,
  reviewer_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin, reviewed_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  foreign key(company_id,lot_id) references lots(company_id,id) on delete cascade,
  CONSTRAINT fk_quality_reviews_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_quality_reviews_reviewer_id FOREIGN KEY (reviewer_id) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS shipments (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null, driver_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin, vehicle TEXT,
  stage VARCHAR(40) NOT NULL DEFAULT 'planned' CHECK (stage IN ('planned','loading','in_transit','arrived','delivered','failed','returned')), planned_departure DATETIME(3), departed_at DATETIME(3), delivered_at DATETIME(3),
  failure_reason TEXT, created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  foreign key(company_id,order_id) references orders(company_id,id) on delete restrict, unique(company_id,id),
  CONSTRAINT fk_shipments_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_shipments_driver_user_id FOREIGN KEY (driver_user_id) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS delivery_evidence (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  shipment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, kind VARCHAR(40) NOT NULL CHECK (kind IN ('photo','signature','note','temperature_reading')), storage_path TEXT, recipient_name TEXT, note TEXT,
  reading_celsius numeric(5,2), captured_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin, captured_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  foreign key(company_id,shipment_id) references shipments(company_id,id) on delete cascade,
  check(kind<>'temperature_reading' or reading_celsius is not null),
  CONSTRAINT fk_delivery_evidence_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_evidence_captured_by FOREIGN KEY (captured_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null, customer_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null, reference VARCHAR(120) not null, amount numeric(16,0) not null check(amount>=0),
  paid_amount numeric(16,0) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0), due_date date,
  status VARCHAR(40) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','partially_paid','paid','overdue','void')), issued_at DATETIME(3), created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  foreign key(company_id,order_id) references orders(company_id,id) on delete restrict,
  foreign key(company_id,customer_id) references customers(company_id,id) on delete restrict,
  unique(company_id,reference),
  CONSTRAINT fk_invoices_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
,
  CHECK (paid_amount <= amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS settlements (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null, invoice_ref TEXT, amount numeric(16,0) not null check(amount>=0), due_date date,
  status VARCHAR(40) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','disputed')), note TEXT, created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  foreign key(company_id,supplier_id) references suppliers(company_id,id) on delete restrict,
  CONSTRAINT fk_settlements_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null, title TEXT not null, body TEXT, href TEXT,
  read_at DATETIME(3), created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_notifications_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_user_id FOREIGN KEY (user_id) REFERENCES medar_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_events (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin, table_name TEXT not null, record_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin, action TEXT not null,
  changes JSON, occurred_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_audit_events_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_events_actor_id FOREIGN KEY (actor_id) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS farm_sites (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  site_code VARCHAR(48) not null check (length(trim(site_code)) between 2 and 48),
  name VARCHAR(180) not null check (length(trim(name)) between 2 and 180),
  province VARCHAR(120) not null default 'گلستان',
  city TEXT,
  address TEXT,
  registration_reference TEXT,
  license_expires_on date,
  timezone VARCHAR(64) not null default 'Asia/Tehran',
  active boolean not null default true,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id),
  unique(company_id,site_code),
  foreign key(company_id,supplier_id) references suppliers(company_id,id) on delete restrict,
  CONSTRAINT fk_farm_sites_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_farm_sites_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS partnership_agreements (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  agreement_code VARCHAR(60) not null check (length(trim(agreement_code)) between 2 and 60),
  version integer not null default 1 check (version > 0),
  status VARCHAR(32) not null default 'draft' check (status in ('draft','pending_signature','active','suspended','expired','terminated')),
  effective_from date not null,
  effective_to date,
  company_profit_share_pct numeric(5,2) not null default 50 check (company_profit_share_pct between 0 and 100),
  partner_profit_share_pct numeric(5,2) not null default 50 check (partner_profit_share_pct between 0 and 100),
  shared_expense_categories JSON not null DEFAULT (JSON_OBJECT()),
  settlement_basis VARCHAR(24) not null default 'collected_cash' check (settlement_basis in ('collected_cash','accrual')),
  settlement_due_days integer not null default 14 check (settlement_due_days between 0 and 365),
  terms JSON not null DEFAULT (JSON_OBJECT()),
  signed_document_path TEXT,
  signed_at DATETIME(3),
  supersedes_agreement_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  approved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  approved_at DATETIME(3),
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id),
  unique(company_id,supplier_id,id),
  unique(company_id,agreement_code,version),
  foreign key(company_id,supplier_id) references suppliers(company_id,id) on delete restrict,
  foreign key(company_id,supplier_id,supersedes_agreement_id) references partnership_agreements(company_id,supplier_id,id) on delete restrict,
  check (company_profit_share_pct + partner_profit_share_pct = 100),
  check (effective_to is null or effective_to >= effective_from),
  check ((status <> 'active') or (signed_at is not null and signed_document_path is not null and approved_by is not null and approved_at is not null and JSON_LENGTH(shared_expense_categories)>0)),
  CONSTRAINT fk_partnership_agreements_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_partnership_agreements_approved_by FOREIGN KEY (approved_by) REFERENCES medar_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_partnership_agreements_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS flock_cycles (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  farm_site_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  cycle_code VARCHAR(60) not null check (length(trim(cycle_code)) between 2 and 60),
  species VARCHAR(32) not null default 'quail' check (species = 'quail'),
  arrived_on date,
  planned_end_on date,
  ended_on date,
  initial_bird_count integer check (initial_bird_count is null or initial_bird_count >= 0),
  status VARCHAR(24) not null default 'planned' check (status in ('planned','active','paused','completed','cancelled')),
  source_reference TEXT,
  notes TEXT,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id),
  unique(company_id,farm_site_id,cycle_code),
  foreign key(company_id,farm_site_id) references farm_sites(company_id,id) on delete restrict,
  check (planned_end_on is null or arrived_on is null or planned_end_on >= arrived_on),
  check (ended_on is null or arrived_on is null or ended_on >= arrived_on),
  CONSTRAINT fk_flock_cycles_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_flock_cycles_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS production_batches (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  farm_site_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  agreement_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  flock_cycle_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  lot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  batch_code VARCHAR(80) not null check (length(trim(batch_code)) between 2 and 80),
  production_kind TEXT not null check (production_kind in ('eggs','meat','other')),
  status VARCHAR(32) not null default 'planned' check (status in ('planned','active','submitted_for_review','approved','on_hold','rejected','completed','cancelled')),
  unit VARCHAR(64) not null default 'کیلوگرم',
  planned_quantity numeric(14,3) check (planned_quantity is null or planned_quantity >= 0),
  produced_quantity numeric(14,3) not null default 0 check (produced_quantity >= 0),
  rejected_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  started_on date,
  expected_on date,
  completed_on date,
  quality_status VARCHAR(24) not null default 'not_inspected' check (quality_status in ('not_inspected','pending','passed','conditional','failed')),
  manager_notes TEXT,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id),
  unique(company_id,batch_code),
  foreign key(company_id,farm_site_id) references farm_sites(company_id,id) on delete restrict,
  foreign key(company_id,supplier_id) references suppliers(company_id,id) on delete restrict,
  foreign key(company_id,agreement_id) references partnership_agreements(company_id,id) on delete restrict,
  foreign key(company_id,flock_cycle_id) references flock_cycles(company_id,id) on delete restrict,
  foreign key(company_id,product_id) references products(company_id,id) on delete restrict,
  foreign key(company_id,lot_id) references lots(company_id,id) on delete restrict,
  check (expected_on is null or started_on is null or expected_on >= started_on),
  check (completed_on is null or started_on is null or completed_on >= started_on),
  CONSTRAINT fk_production_batches_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_production_batches_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE SET NULL
,
  CHECK (rejected_quantity <= produced_quantity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS daily_production_records (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  record_date date not null,
  shift_label VARCHAR(32) not null default 'daily',
  feed_consumed_kg numeric(14,3) not null default 0 check (feed_consumed_kg >= 0),
  mortality_count integer not null default 0 check (mortality_count >= 0),
  eggs_collected integer not null default 0 check (eggs_collected >= 0),
  eggs_rejected integer NOT NULL DEFAULT 0 CHECK (eggs_rejected >= 0),
  produced_quantity numeric(14,3) check (produced_quantity is null or produced_quantity >= 0),
  average_weight_grams numeric(10,2) check (average_weight_grams is null or average_weight_grams >= 0),
  note TEXT,
  recorded_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  recorded_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id),
  foreign key(company_id,batch_id) references production_batches(company_id,id) on delete restrict,
  CONSTRAINT fk_daily_production_records_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_daily_production_records_recorded_by FOREIGN KEY (recorded_by) REFERENCES medar_users(id) ON DELETE SET NULL
,
  CHECK (eggs_rejected <= eggs_collected)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS task_templates (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  template_code VARCHAR(60) not null check (length(trim(template_code)) between 2 and 60),
  version integer not null default 1 check (version > 0),
  title TEXT not null check (length(trim(title)) between 2 and 180),
  instructions TEXT not null,
  category VARCHAR(64) not null default 'operations',
  priority VARCHAR(24) not null default 'normal' check (priority in ('low','normal','high','critical')),
  evidence_required boolean not null default false,
  expected_evidence_types JSON not null DEFAULT (JSON_OBJECT()),
  status VARCHAR(24) not null default 'draft' check (status in ('draft','approved','retired')),
  approved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  approved_at DATETIME(3),
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id),
  unique(company_id,template_code,version),
  check ((status <> 'approved') or (approved_by is not null and approved_at is not null)),
  CONSTRAINT fk_task_templates_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_templates_approved_by FOREIGN KEY (approved_by) REFERENCES medar_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_task_templates_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS operational_tasks (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  farm_site_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  template_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  assignee_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  assignee_supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  assigned_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  title TEXT not null check (length(trim(title)) between 2 and 180),
  instructions_snapshot VARCHAR(2048) not null default '',
  category VARCHAR(64) not null default 'operations',
  priority VARCHAR(24) not null default 'normal' check (priority in ('low','normal','high','critical')),
  status VARCHAR(24) not null default 'pending' check (status in ('pending','in_progress','submitted','approved','rejected','blocked','cancelled')),
  due_at DATETIME(3),
  started_at DATETIME(3),
  submitted_at DATETIME(3),
  reviewed_at DATETIME(3),
  reviewed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  completion_note TEXT,
  review_note TEXT,
  evidence_required boolean not null default false,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id),
  foreign key(company_id,farm_site_id) references farm_sites(company_id,id) on delete restrict,
  foreign key(company_id,batch_id) references production_batches(company_id,id) on delete restrict,
  foreign key(company_id,template_id) references task_templates(company_id,id) on delete restrict,
  foreign key(company_id,assignee_supplier_id) references suppliers(company_id,id) on delete restrict,
  check (assignee_user_id is not null or assignee_supplier_id is not null),
  check (status <> 'approved' or (reviewed_by is not null and reviewed_at is not null)),
  check (status <> 'submitted' or submitted_at is not null),
  CONSTRAINT fk_operational_tasks_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_operational_tasks_assignee_user_id FOREIGN KEY (assignee_user_id) REFERENCES medar_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_operational_tasks_assigned_by FOREIGN KEY (assigned_by) REFERENCES medar_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_operational_tasks_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS task_evidence (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  evidence_type TEXT not null check (evidence_type in ('photo','document','note','measurement')),
  storage_path TEXT,
  note TEXT,
  measurement_value numeric(14,3),
  measurement_unit TEXT,
  uploaded_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  captured_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id),
  foreign key(company_id,task_id) references operational_tasks(company_id,id) on delete restrict,
  check ((evidence_type in ('photo','document') and storage_path is not null) or (evidence_type in ('note','measurement'))),
  constraint task_evidence_storage_path_scope_check check (storage_path is null or storage_path like (CONCAT(company_id, '/', task_id, '/%'))), 
  constraint task_evidence_note_nonempty_check check (evidence_type <> 'note' or length(trim(coalesce(note,'')))>0),
  check (evidence_type <> 'measurement' or measurement_value is not null),
  CONSTRAINT fk_task_evidence_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_evidence_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS operational_incidents (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  farm_site_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  batch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  reported_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  reported_supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  severity VARCHAR(16) not null default 'medium' check (severity in ('low','medium','high','critical')),
  category TEXT not null check (category in ('production','quality','animal_welfare','inventory','safety','logistics','finance','other')),
  title TEXT not null check (length(trim(title)) between 3 and 180),
  description VARCHAR(3000) not null default '',
  status VARCHAR(24) not null default 'open' check (status in ('open','investigating','action_required','resolved','closed')),
  resolution_note TEXT,
  resolved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  resolved_at DATETIME(3),
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id),
  foreign key(company_id,farm_site_id) references farm_sites(company_id,id) on delete restrict,
  foreign key(company_id,batch_id) references production_batches(company_id,id) on delete restrict,
  foreign key(company_id,task_id) references operational_tasks(company_id,id) on delete restrict,
  foreign key(company_id,reported_supplier_id) references suppliers(company_id,id) on delete restrict,
  check (status not in ('resolved','closed') or (resolved_by is not null and resolved_at is not null)),
  CONSTRAINT fk_operational_incidents_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_operational_incidents_reported_by FOREIGN KEY (reported_by) REFERENCES medar_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_operational_incidents_resolved_by FOREIGN KEY (resolved_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS partner_financial_entries (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  agreement_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  entry_type TEXT not null check (entry_type in ('sale_invoice','sale_collection','expense','partner_advance','settlement_payment','adjustment')),
  status VARCHAR(16) not null default 'draft' check (status in ('draft','submitted','approved','rejected','posted')),
  direction VARCHAR(32) not null default 'not_cash' check (direction in ('not_cash','inflow_to_company','outflow_from_company','company_to_partner','partner_to_company')),
  amount numeric(16,0) not null check (amount > 0),
  paid_amount numeric(16,0) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  currency VARCHAR(8) not null default 'TOMAN' check (currency in ('IRR','TOMAN')),
  expense_category TEXT,
  is_shared_cost boolean not null default false,
  paid_by VARCHAR(20) not null default 'none' check (paid_by in ('none','company','partner','customer','vendor','third_party')),
  payment_status VARCHAR(24) not null default 'not_applicable' check (payment_status in ('not_applicable','unpaid','partial','paid')),
  recognized_on date not null DEFAULT (CURRENT_DATE),
  external_reference VARCHAR(160),
  source_table TEXT,
  source_record_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  linked_entry_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  adjustment_effect TEXT check (adjustment_effect in ('increase','decrease')),
  notes TEXT,
  submitted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  submitted_at DATETIME(3),
  approved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  approved_at DATETIME(3),
  posted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  posted_at DATETIME(3),
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id),
  foreign key(company_id,supplier_id) references suppliers(company_id,id) on delete restrict,
  foreign key(company_id,agreement_id) references partnership_agreements(company_id,id) on delete restrict,
  foreign key(company_id,linked_entry_id) references partner_financial_entries(company_id,id) on delete restrict,
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
  constraint partner_financial_posted_cash_entry_evidence_check check (entry_type not in ('partner_advance','settlement_payment') or status <> 'posted' or (paid_amount=amount and payment_status='paid' and external_reference is not null)),
  CONSTRAINT fk_partner_financial_entries_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_partner_financial_entries_submitted_by FOREIGN KEY (submitted_by) REFERENCES medar_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_partner_financial_entries_approved_by FOREIGN KEY (approved_by) REFERENCES medar_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_partner_financial_entries_posted_by FOREIGN KEY (posted_by) REFERENCES medar_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_partner_financial_entries_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE SET NULL
,
  CHECK (paid_amount <= amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS partner_settlement_periods (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  agreement_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  period_start date not null,
  period_end date not null,
  status VARCHAR(24) not null default 'draft' check (status in ('draft','approved','settled','disputed','cancelled')),
  currency VARCHAR(8) not null default 'TOMAN' check (currency in ('IRR','TOMAN')),
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
  calculation_snapshot JSON not null DEFAULT (JSON_OBJECT()),
  calculated_at DATETIME(3),
  approved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  approved_at DATETIME(3),
  settled_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  settled_at DATETIME(3),
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  unique(company_id,id),
  unique(company_id,agreement_id,period_start,period_end),
  foreign key(company_id,supplier_id) references suppliers(company_id,id) on delete restrict,
  foreign key(company_id,agreement_id) references partnership_agreements(company_id,id) on delete restrict,
  check (period_end >= period_start),
  check (balance_due_to_partner = 0 or balance_due_to_company = 0),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
  check (status <> 'settled' or (settled_by is not null and settled_at is not null)),
  CONSTRAINT fk_partner_settlement_periods_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_partner_settlement_periods_approved_by FOREIGN KEY (approved_by) REFERENCES medar_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_partner_settlement_periods_settled_by FOREIGN KEY (settled_by) REFERENCES medar_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_partner_settlement_periods_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS shipment_locations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  shipment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  driver_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  latitude double precision not null check (latitude >= -90 and latitude <= 90),
  longitude double precision not null check (longitude >= -180 and longitude <= 180),
  accuracy_m double precision check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000)),
  captured_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_shipment_locations_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_shipment_locations_shipment_id FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE,
  CONSTRAINT fk_shipment_locations_driver_user_id FOREIGN KEY (driver_user_id) REFERENCES medar_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  movement_type TEXT not null check (movement_type in ('purchase_in','sale_out','adjustment_in','adjustment_out','waste_out','return_in')),
  quantity numeric(16,3) not null check (quantity > 0),
  unit_cost numeric(16,2) check (unit_cost is null or unit_cost >= 0),
  supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  lot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  reference_code TEXT check (reference_code is null or length(reference_code) <= 120),
  note TEXT check (note is null or length(note) <= 2000),
  recorded_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  occurred_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_inventory_movements_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_inventory_movements_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_movements_supplier_id FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_inventory_movements_order_id FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_inventory_movements_lot_id FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE SET NULL,
  CONSTRAINT fk_inventory_movements_recorded_by FOREIGN KEY (recorded_by) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS company_goals (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  title TEXT not null check (length(trim(title)) between 3 and 160),
  description VARCHAR(3000) not null default '' check (length(description) <= 3000),
  category VARCHAR(24) not null default 'operations'
    check (category in ('operations','production','sales','quality','logistics','finance','people','growth','other')),
  unit VARCHAR(40) not null default '' check (length(unit) <= 40),
  baseline_value numeric(18,3) not null default 0,
  target_value numeric(18,3) not null default 0,
  current_value numeric(18,3) not null default 0,
  priority VARCHAR(24) not null default 'normal' check (priority in ('low','normal','high','critical')),
  status VARCHAR(24) not null default 'planned' check (status in ('planned','active','at_risk','achieved','paused','cancelled')),
  period_start date,
  due_date date,
  owner_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  check (due_date is null or period_start is null or due_date >= period_start),
  check (target_value >= 0),
  CONSTRAINT fk_company_goals_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_company_goals_owner_user_id FOREIGN KEY (owner_user_id) REFERENCES medar_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_company_goals_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_company_goals_updated_by FOREIGN KEY (updated_by) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
