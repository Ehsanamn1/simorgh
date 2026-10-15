-- Simorgh Operational Integrity / Phase 1
-- Additive migration: farms, flock cycles, production evidence, assigned tasks,
-- versioned 50/50 partner agreements, auditable finance entries and statements.
-- Does not seed customers, suppliers, orders, farms, financial entries or test users.

create table public.farm_sites (
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
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,site_code),
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict
);

create table public.partnership_agreements (
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
  shared_expense_categories text[] not null default array['feed','production','packaging','processing','logistics']::text[],
  settlement_basis text not null default 'collected_cash' check (settlement_basis in ('collected_cash','accrual')),
  settlement_due_days integer not null default 14 check (settlement_due_days between 0 and 365),
  terms jsonb not null default '{}'::jsonb,
  signed_document_path text,
  signed_at timestamptz,
  supersedes_agreement_id uuid,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,agreement_code,version),
  foreign key(company_id,supplier_id) references public.suppliers(company_id,id) on delete restrict,
  foreign key(company_id,supersedes_agreement_id) references public.partnership_agreements(company_id,id) on delete restrict,
  check (company_profit_share_pct + partner_profit_share_pct = 100),
  check (effective_to is null or effective_to >= effective_from),
  check ((status <> 'active') or (signed_at is not null and approved_at is not null))
);
create index partnership_agreement_supplier_status_idx on public.partnership_agreements(company_id,supplier_id,status,effective_from desc);

create table public.flock_cycles (
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
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,farm_site_id,cycle_code),
  foreign key(company_id,farm_site_id) references public.farm_sites(company_id,id) on delete restrict,
  check (planned_end_on is null or arrived_on is null or planned_end_on >= arrived_on),
  check (ended_on is null or arrived_on is null or ended_on >= arrived_on)
);
create index flock_cycles_site_status_idx on public.flock_cycles(company_id,farm_site_id,status);

create table public.production_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  farm_site_id uuid not null,
  supplier_id uuid not null,
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
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
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
create index production_batches_site_status_idx on public.production_batches(company_id,farm_site_id,status,expected_on);
create index production_batches_supplier_idx on public.production_batches(company_id,supplier_id,created_at desc);

create table public.daily_production_records (
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
  recorded_by uuid references auth.users(id) on delete set null default auth.uid(),
  recorded_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,batch_id) references public.production_batches(company_id,id) on delete restrict
);
create index daily_production_batch_date_idx on public.daily_production_records(company_id,batch_id,record_date desc);

create table public.task_templates (
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
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,template_code,version),
  check ((status <> 'approved') or (approved_by is not null and approved_at is not null))
);

create table public.operational_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  farm_site_id uuid,
  batch_id uuid,
  template_id uuid,
  assignee_user_id uuid references auth.users(id) on delete set null,
  assignee_supplier_id uuid,
  assigned_by uuid references auth.users(id) on delete set null default auth.uid(),
  title text not null check (length(trim(title)) between 2 and 180),
  instructions_snapshot text not null default '',
  category text not null default 'operations',
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status text not null default 'pending' check (status in ('pending','in_progress','submitted','approved','rejected','blocked','cancelled')),
  due_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
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
create index operational_tasks_user_queue_idx on public.operational_tasks(company_id,assignee_user_id,status,due_at);
create index operational_tasks_supplier_queue_idx on public.operational_tasks(company_id,assignee_supplier_id,status,due_at);

create table public.task_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  task_id uuid not null,
  evidence_type text not null check (evidence_type in ('photo','document','note','measurement')),
  storage_path text,
  note text,
  measurement_value numeric(14,3),
  measurement_unit text,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,task_id) references public.operational_tasks(company_id,id) on delete restrict,
  check ((evidence_type in ('photo','document') and storage_path is not null) or (evidence_type in ('note','measurement'))),
  check (evidence_type <> 'measurement' or measurement_value is not null)
);
create index task_evidence_task_idx on public.task_evidence(company_id,task_id,captured_at desc);

create table public.operational_incidents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  farm_site_id uuid,
  batch_id uuid,
  task_id uuid,
  reported_by uuid references auth.users(id) on delete set null default auth.uid(),
  reported_supplier_id uuid,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  category text not null check (category in ('production','quality','animal_welfare','inventory','safety','logistics','finance','other')),
  title text not null check (length(trim(title)) between 3 and 180),
  description text not null default '',
  status text not null default 'open' check (status in ('open','investigating','action_required','resolved','closed')),
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
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
create index operational_incidents_open_idx on public.operational_incidents(company_id,status,severity,created_at desc);

-- One append-only finance source per event: invoices and collections stay separate;
-- shared costs and actual funder are distinct; cash settlement is recorded, never simulated.
create table public.partner_financial_entries (
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
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  posted_by uuid references auth.users(id) on delete set null,
  posted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
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
  check (status <> 'posted' or (posted_at is not null and posted_by is not null))
);
create index partner_financial_supplier_date_idx on public.partner_financial_entries(company_id,supplier_id,recognized_on desc);
create index partner_financial_agreement_date_idx on public.partner_financial_entries(company_id,agreement_id,recognized_on,status,entry_type);
create index partner_financial_source_idx on public.partner_financial_entries(company_id,source_table,source_record_id);

create table public.partner_settlement_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null,
  agreement_id uuid not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','approved','settled','disputed','cancelled')),
  currency text not null default 'IRR' check (currency in ('IRR','TOMAN')),
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
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  settled_by uuid references auth.users(id) on delete set null,
  settled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
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
create index partner_settlement_supplier_idx on public.partner_settlement_periods(company_id,supplier_id,period_end desc,status);

-- All operational tables are tenant-scoped and use the existing identity helpers.
alter table public.farm_sites enable row level security;
alter table public.partnership_agreements enable row level security;
alter table public.flock_cycles enable row level security;
alter table public.production_batches enable row level security;
alter table public.daily_production_records enable row level security;
alter table public.task_templates enable row level security;
alter table public.operational_tasks enable row level security;
alter table public.task_evidence enable row level security;
alter table public.operational_incidents enable row level security;
alter table public.partner_financial_entries enable row level security;
alter table public.partner_settlement_periods enable row level security;

create policy farm_sites_internal_all on public.farm_sites for all to authenticated
  using (public.is_company_internal(company_id)) with check (public.is_company_internal(company_id));
create policy farm_sites_partner_read on public.farm_sites for select to authenticated
  using (supplier_id in (select public.my_supplier_ids()));

create policy partnership_agreements_internal_all on public.partnership_agreements for all to authenticated
  using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));
create policy partnership_agreements_partner_read on public.partnership_agreements for select to authenticated
  using (supplier_id in (select public.my_supplier_ids()));

create policy flock_cycles_internal_all on public.flock_cycles for all to authenticated
  using (public.is_company_internal(company_id)) with check (public.is_company_internal(company_id));
create policy flock_cycles_partner_read on public.flock_cycles for select to authenticated
  using (exists(select 1 from public.farm_sites fs where fs.company_id=flock_cycles.company_id and fs.id=flock_cycles.farm_site_id and fs.supplier_id in (select public.my_supplier_ids())));

create policy production_batches_internal_all on public.production_batches for all to authenticated
  using (public.is_company_internal(company_id)) with check (public.is_company_internal(company_id));
create policy production_batches_partner_read on public.production_batches for select to authenticated
  using (supplier_id in (select public.my_supplier_ids()));

create policy daily_production_internal_all on public.daily_production_records for all to authenticated
  using (public.is_company_internal(company_id)) with check (public.is_company_internal(company_id));
create policy daily_production_partner_read on public.daily_production_records for select to authenticated
  using (exists(select 1 from public.production_batches b where b.company_id=daily_production_records.company_id and b.id=daily_production_records.batch_id and b.supplier_id in (select public.my_supplier_ids())));
create policy daily_production_partner_insert on public.daily_production_records for insert to authenticated
  with check (recorded_by=auth.uid() and exists(select 1 from public.production_batches b where b.company_id=daily_production_records.company_id and b.id=daily_production_records.batch_id and b.supplier_id in (select public.my_supplier_ids())));

create policy task_templates_internal_all on public.task_templates for all to authenticated
  using (public.is_company_internal(company_id)) with check (public.is_company_internal(company_id));

create policy operational_tasks_internal_all on public.operational_tasks for all to authenticated
  using (public.is_company_internal(company_id)) with check (public.is_company_internal(company_id));
create policy operational_tasks_assigned_read on public.operational_tasks for select to authenticated
  using (assignee_user_id=auth.uid() or assignee_supplier_id in (select public.my_supplier_ids()));

create policy task_evidence_internal_all on public.task_evidence for all to authenticated
  using (public.is_company_internal(company_id)) with check (public.is_company_internal(company_id));
create policy task_evidence_assignee_read on public.task_evidence for select to authenticated
  using (exists(select 1 from public.operational_tasks t where t.company_id=task_evidence.company_id and t.id=task_evidence.task_id and (t.assignee_user_id=auth.uid() or t.assignee_supplier_id in (select public.my_supplier_ids()))));
create policy task_evidence_assignee_insert on public.task_evidence for insert to authenticated
  with check (uploaded_by=auth.uid() and exists(select 1 from public.operational_tasks t where t.company_id=task_evidence.company_id and t.id=task_evidence.task_id and (t.assignee_user_id=auth.uid() or t.assignee_supplier_id in (select public.my_supplier_ids()))));

create policy operational_incidents_internal_all on public.operational_incidents for all to authenticated
  using (public.is_company_internal(company_id)) with check (public.is_company_internal(company_id));
create policy operational_incidents_partner_read on public.operational_incidents for select to authenticated
  using (reported_supplier_id in (select public.my_supplier_ids()) or exists(select 1 from public.farm_sites fs where fs.company_id=operational_incidents.company_id and fs.id=operational_incidents.farm_site_id and fs.supplier_id in (select public.my_supplier_ids())));
create policy operational_incidents_partner_insert on public.operational_incidents for insert to authenticated
  with check (reported_by=auth.uid() and (reported_supplier_id in (select public.my_supplier_ids()) or exists(select 1 from public.farm_sites fs where fs.company_id=operational_incidents.company_id and fs.id=operational_incidents.farm_site_id and fs.supplier_id in (select public.my_supplier_ids()))));

create policy partner_financial_internal_all on public.partner_financial_entries for all to authenticated
  using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));
create policy partner_financial_supplier_read on public.partner_financial_entries for select to authenticated
  using (supplier_id in (select public.my_supplier_ids()));

create policy partner_settlement_internal_all on public.partner_settlement_periods for all to authenticated
  using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));
create policy partner_settlement_supplier_read on public.partner_settlement_periods for select to authenticated
  using (supplier_id in (select public.my_supplier_ids()));


-- Signed/active agreement terms are versioned and cannot be edited in place.
create or replace function public.guard_partnership_agreement_version()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and old.status in ('active','suspended','expired','terminated') then
    raise exception 'قرارداد فعال یا تاریخی حذف نمی‌شود؛ الحاقیه با نسخه جدید بسازید';
  end if;
  if tg_op='UPDATE' and old.status in ('active','suspended','expired','terminated') then
    if (to_jsonb(new) - array['status','updated_at'])
       is distinct from
       (to_jsonb(old) - array['status','updated_at']) then
      raise exception 'شروط قرارداد فعال/تاریخی تغییر نمی‌کند؛ نسخه جدید یا الحاقیه بسازید';
    end if;
    if old.status in ('expired','terminated') and new.status is distinct from old.status then
      raise exception 'وضعیت قرارداد تاریخی قابل بازگشت نیست';
    end if;
    if old.status='active' and new.status not in ('active','suspended','expired','terminated') then
      raise exception 'گذار وضعیت قرارداد فعال مجاز نیست';
    end if;
  end if;
  return new;
end $$;
create trigger guard_partnership_agreement_update
  before update or delete on public.partnership_agreements for each row execute function public.guard_partnership_agreement_version();

-- Keep approved procedures versioned and completed task history unchanged.
create or replace function public.guard_approved_task_template()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and old.status='approved' then
    raise exception 'نسخه تأییدشده دستورالعمل حذف نمی‌شود؛ نسخه جدید بسازید';
  end if;
  if tg_op='UPDATE' and old.status='approved' then
    if new.company_id is distinct from old.company_id
      or new.template_code is distinct from old.template_code
      or new.version is distinct from old.version
      or new.title is distinct from old.title
      or new.instructions is distinct from old.instructions
      or new.category is distinct from old.category
      or new.priority is distinct from old.priority
      or new.evidence_required is distinct from old.evidence_required
      or new.expected_evidence_types is distinct from old.expected_evidence_types
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at then
      raise exception 'دستورالعمل تأییدشده immutable است؛ برای تغییر نسخه جدید بسازید';
    end if;
    if new.status not in ('approved','retired') then
      raise exception 'نسخه تأییدشده فقط می‌تواند بازنشسته شود';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger guard_approved_task_template_update
  before update or delete on public.task_templates for each row execute function public.guard_approved_task_template();

create or replace function public.guard_task_status_transition()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if old.status='approved' and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception 'وظیفه تأییدشده قابل بازنویسی نیست؛ یک وظیفه یا رخداد اصلاحی ایجاد کنید';
    end if;
    if new.status is distinct from old.status and not (
      (old.status='pending' and new.status in ('in_progress','submitted','blocked','cancelled')) or
      (old.status='in_progress' and new.status in ('submitted','blocked','cancelled')) or
      (old.status='submitted' and new.status in ('approved','rejected')) or
      (old.status='rejected' and new.status in ('in_progress','submitted','cancelled')) or
      (old.status='blocked' and new.status in ('pending','in_progress','cancelled'))
    ) then
      raise exception 'انتقال وضعیت وظیفه مجاز نیست';
    end if;
    if new.status='submitted' and old.status<>'submitted' and new.submitted_at is null then new.submitted_at:=now(); end if;
    if new.status='approved' and old.status<>'approved' then
      new.reviewed_at:=coalesce(new.reviewed_at,now());
      new.reviewed_by:=coalesce(new.reviewed_by,auth.uid());
    end if;
  end if;
  return new;
end $$;
create trigger guard_operational_task_update
  before update on public.operational_tasks for each row execute function public.guard_task_status_transition();


-- Validate financial corrections against a posted source record in the same agreement.
create or replace function public.guard_partner_financial_relationship()
returns trigger language plpgsql security definer set search_path='' as $$
declare source public.partner_financial_entries%rowtype;
begin
  if new.entry_type='adjustment' then
    select * into source from public.partner_financial_entries
     where id=new.linked_entry_id and company_id=new.company_id
       and supplier_id=new.supplier_id and agreement_id=new.agreement_id;
    if not found or source.status<>'posted' or source.entry_type='adjustment' then
      raise exception 'سند تعدیلی باید به سند ثبت‌شده همان قرارداد متصل شود';
    end if;
    if new.is_shared_cost then raise exception 'تعدیل را از طریق سند مرتبط ثبت کنید؛ is_shared_cost روی تعدیل تنظیم نمی‌شود'; end if;
  elsif new.adjustment_effect is not null then
    raise exception 'adjustment_effect فقط برای سند تعدیلی مجاز است';
  end if;
  if new.entry_type='sale_collection' then
    select * into source from public.partner_financial_entries
     where id=new.linked_entry_id and company_id=new.company_id
       and supplier_id=new.supplier_id and agreement_id=new.agreement_id
       and entry_type='sale_invoice';
    if not found then raise exception 'دریافت فروش باید به فاکتور همین قرارداد متصل شود'; end if;
  end if;
  return new;
end $$;
create trigger guard_partner_financial_relationship
  before insert or update on public.partner_financial_entries for each row execute function public.guard_partner_financial_relationship();

create or replace function public.guard_posted_partner_financial_entry()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and old.status='posted' then
    raise exception 'سند مالی ثبت‌شده حذف نمی‌شود؛ سند اصلاحی ثبت کنید';
  end if;
  if tg_op='UPDATE' and old.status='posted' then
    raise exception 'سند مالی ثبت‌شده تغییر نمی‌کند؛ سند اصلاحی ثبت کنید';
  end if;
  if tg_op='UPDATE' and new.status is distinct from old.status and not (
    (old.status='draft' and new.status in ('submitted','rejected')) or
    (old.status='submitted' and new.status in ('approved','rejected')) or
    (old.status='approved' and new.status in ('posted','rejected'))
  ) then
    raise exception 'انتقال وضعیت سند مالی مجاز نیست';
  end if;
  if new.status='submitted' and new.submitted_at is null then
    new.submitted_at:=now(); new.submitted_by:=coalesce(new.submitted_by,auth.uid());
  end if;
  if new.status='approved' and new.approved_at is null then
    new.approved_at:=now(); new.approved_by:=coalesce(new.approved_by,auth.uid());
  end if;
  if new.status='posted' and new.posted_at is null then
    new.posted_at:=now(); new.posted_by:=coalesce(new.posted_by,auth.uid());
  end if;
  return new;
end $$;
create trigger guard_partner_financial_entry_update
  before update or delete on public.partner_financial_entries for each row execute function public.guard_posted_partner_financial_entry();

create or replace function public.guard_partner_settlement_period_update()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and old.status in ('approved','settled') then
    raise exception 'دوره تأییدشده یا تسویه‌شده حذف نمی‌شود';
  end if;
  if tg_op='UPDATE' and old.status='settled' then
    raise exception 'دوره تسویه‌شده تغییر نمی‌کند؛ سند تعدیلی بسازید';
  end if;
  if tg_op='UPDATE' and old.status='approved' then
    if (to_jsonb(new) - array['status','settled_amount','settled_by','settled_at','updated_at'])
       is distinct from
       (to_jsonb(old) - array['status','settled_amount','settled_by','settled_at','updated_at']) then
      raise exception 'مقادیر دوره تأییدشده immutable است؛ سند تعدیلی بسازید';
    end if;
    if new.status not in ('approved','settled') then
      raise exception 'دوره تأییدشده فقط پس از پرداخت واقعی قابل تسویه است';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger guard_partner_settlement_period_update
  before update or delete on public.partner_settlement_periods for each row execute function public.guard_partner_settlement_period_update();

-- Only assigned users/partners can submit a task. Reviews require company manager privilege.
create or replace function public.submit_operational_task(_task uuid, _completion_note text default null)
returns void language plpgsql security definer set search_path='' as $$
declare t public.operational_tasks%rowtype;
begin
  select * into t from public.operational_tasks where id=_task for update;
  if not found then raise exception 'وظیفه پیدا نشد'; end if;
  if not (public.is_company_manager(t.company_id) or t.assignee_user_id=auth.uid() or t.assignee_supplier_id in (select public.my_supplier_ids())) then
    raise exception 'این وظیفه به شما واگذار نشده است';
  end if;
  if t.status not in ('pending','in_progress','rejected') then raise exception 'وضعیت فعلی اجازه ارسال پایان کار نمی‌دهد'; end if;
  if t.evidence_required and not exists(select 1 from public.task_evidence e where e.company_id=t.company_id and e.task_id=t.id) then
    raise exception 'برای تکمیل این وظیفه مدرک لازم است';
  end if;
  update public.operational_tasks set status='submitted', submitted_at=now(), completion_note=nullif(trim(_completion_note),''), updated_at=now()
   where id=t.id;
end $$;

create or replace function public.review_operational_task(_task uuid, _decision text, _review_note text default null)
returns void language plpgsql security definer set search_path='' as $$
declare t public.operational_tasks%rowtype;
begin
  if _decision not in ('approved','rejected') then raise exception 'تصمیم بازبینی نامعتبر است'; end if;
  select * into t from public.operational_tasks where id=_task for update;
  if not found then raise exception 'وظیفه پیدا نشد'; end if;
  if not public.is_company_manager(t.company_id) then raise exception 'دسترسی مالک یا مدیر لازم است'; end if;
  if t.status<>'submitted' then raise exception 'فقط وظیفه ارسال‌شده قابل بازبینی است'; end if;
  update public.operational_tasks set status=_decision, reviewed_at=now(), reviewed_by=auth.uid(),
    review_note=nullif(trim(_review_note),''),
    completion_note=completion_note
  where id=t.id;
end $$;

-- Statement snapshot: deterministic records only; amounts stay separate from cash evidence.
create or replace function public.partner_statement_snapshot(_agreement uuid, _period_start date, _period_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  a public.partnership_agreements%rowtype;
  invoice_total numeric(16,0);
  collection_total numeric(16,0);
  revenue_used numeric(16,0);
  expense_total numeric(16,0);
  unpaid_expense_total numeric(16,0);
  company_paid_total numeric(16,0);
  partner_paid_total numeric(16,0);
  company_advance_total numeric(16,0);
  partner_advance_total numeric(16,0);
  paid_to_partner_total numeric(16,0);
  paid_to_company_total numeric(16,0);
  net_total numeric(16,0);
  company_share_total numeric(16,0);
  partner_share_total numeric(16,0);
  balance_partner numeric(16,0);
  balance_company numeric(16,0);
  cash_available numeric(16,0);
  lines jsonb;
begin
  if _period_start is null or _period_end is null or _period_end<_period_start then raise exception 'بازه زمانی دوره نامعتبر است'; end if;
  select * into a from public.partnership_agreements where id=_agreement;
  if not found then raise exception 'قرارداد مشارکت پیدا نشد'; end if;
  if not (public.is_company_manager(a.company_id) or a.supplier_id in (select public.my_supplier_ids())) then
    raise exception 'دسترسی به این قرارداد مجاز نیست';
  end if;
  if _period_start < a.effective_from or (a.effective_to is not null and _period_end > a.effective_to) then
    raise exception 'دوره باید در بازه اعتبار قرارداد باشد';
  end if;

  select
    coalesce(sum(e.amount) filter(where e.entry_type='sale_invoice' and e.status='posted'),0),
    coalesce(sum(e.amount) filter(where e.entry_type='sale_collection' and e.status='posted'),0),
    coalesce(sum(e.amount) filter(where e.entry_type='expense' and e.is_shared_cost and e.status in ('approved','posted')),0),
    coalesce(sum(e.amount-e.paid_amount) filter(where e.entry_type='expense' and e.is_shared_cost and e.status in ('approved','posted')),0),
    coalesce(sum(e.paid_amount) filter(where e.entry_type='expense' and e.is_shared_cost and e.status in ('approved','posted') and e.paid_by='company'),0),
    coalesce(sum(e.paid_amount) filter(where e.entry_type='expense' and e.is_shared_cost and e.status in ('approved','posted') and e.paid_by='partner'),0),
    coalesce(sum(e.amount) filter(where e.entry_type='partner_advance' and e.status='posted' and e.direction='company_to_partner'),0),
    coalesce(sum(e.amount) filter(where e.entry_type='partner_advance' and e.status='posted' and e.direction='partner_to_company'),0),
    coalesce(sum(e.amount) filter(where e.entry_type='settlement_payment' and e.status='posted' and e.direction='company_to_partner'),0),
    coalesce(sum(e.amount) filter(where e.entry_type='settlement_payment' and e.status='posted' and e.direction='partner_to_company'),0)
  into invoice_total,collection_total,expense_total,unpaid_expense_total,company_paid_total,partner_paid_total,
       company_advance_total,partner_advance_total,paid_to_partner_total,paid_to_company_total
  from public.partner_financial_entries e
  where e.company_id=a.company_id and e.supplier_id=a.supplier_id and e.agreement_id=a.id
    and e.recognized_on between _period_start and _period_end;

  revenue_used:=case when a.settlement_basis='accrual' then invoice_total else collection_total end;
  net_total:=revenue_used-expense_total;
  company_share_total:=round(net_total*a.company_profit_share_pct/100.0,0);
  partner_share_total:=round(net_total*a.partner_profit_share_pct/100.0,0);
  balance_partner:=partner_share_total+partner_paid_total+partner_advance_total-company_advance_total-paid_to_partner_total-paid_to_company_total;
  balance_company:=case when balance_partner < 0 then abs(balance_partner) else 0 end;
  balance_partner:=case when balance_partner > 0 then balance_partner else 0 end;
  cash_available:=collection_total-company_paid_total-company_advance_total-paid_to_partner_total+partner_advance_total+paid_to_company_total;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'type',e.entry_type,'status',e.status,'amount',e.amount,'paid_amount',e.paid_amount,
    'currency',e.currency,'category',e.expense_category,'shared_cost',e.is_shared_cost,'paid_by',e.paid_by,
    'date',e.recognized_on,'reference',e.external_reference,'source_table',e.source_table,'source_record_id',e.source_record_id,
    'linked_entry_id',e.linked_entry_id,'notes',e.notes
  ) order by e.recognized_on,e.created_at,e.id),'[]'::jsonb)
  into lines
  from public.partner_financial_entries e
  where e.company_id=a.company_id and e.supplier_id=a.supplier_id and e.agreement_id=a.id
    and e.recognized_on between _period_start and _period_end;

  return jsonb_build_object(
    'agreement_id',a.id,'agreement_code',a.agreement_code,'agreement_version',a.version,
    'supplier_id',a.supplier_id,'period_start',_period_start,'period_end',_period_end,
    'settlement_basis',a.settlement_basis,'currency','TOMAN',
    'company_profit_share_pct',a.company_profit_share_pct,'partner_profit_share_pct',a.partner_profit_share_pct,
    'invoiced_revenue',invoice_total,'collected_revenue',collection_total,'recognized_revenue',revenue_used,
    'approved_shared_expenses',expense_total,'unpaid_approved_expenses',unpaid_expense_total,
    'company_paid_shared_expenses',company_paid_total,'partner_paid_shared_expenses',partner_paid_total,
    'net_result',net_total,'company_share_amount',company_share_total,'partner_share_amount',partner_share_total,
    'balance_due_to_partner',balance_partner,'balance_due_to_company',balance_company,
    'recorded_cash_available',cash_available,
    'cash_note','این عدد فقط از اسناد ثبت‌شده محاسبه می‌شود و موجودی بانکی را تأیید نمی‌کند.',
    'entries',lines,'calculated_at',now()
  );
end $$;

create or replace function public.create_partner_settlement_period(_agreement uuid, _period_start date, _period_end date)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  a public.partnership_agreements%rowtype;
  snap jsonb;
  new_id uuid;
begin
  select * into a from public.partnership_agreements where id=_agreement;
  if not found then raise exception 'قرارداد مشارکت پیدا نشد'; end if;
  if not public.is_company_manager(a.company_id) then raise exception 'ایجاد دوره فقط برای مالک یا مدیر مجاز است'; end if;
  if a.status not in ('active','expired') then raise exception 'قرارداد باید تأیید و فعال شده باشد'; end if;
  if _period_start is null or _period_end is null or _period_end<_period_start then raise exception 'بازه زمانی دوره نامعتبر است'; end if;
  if _period_end>current_date then raise exception 'دوره تسویه آینده قابل ایجاد نیست'; end if;
  perform pg_advisory_xact_lock(hashtext(_agreement::text));
  if exists(select 1 from public.partner_settlement_periods p where p.agreement_id=_agreement and p.company_id=a.company_id and p.status<>'cancelled' and p.period_start<=_period_end and p.period_end>=_period_start) then
    raise exception 'این بازه با یک دوره تسویه موجود هم‌پوشانی دارد';
  end if;
  snap:=public.partner_statement_snapshot(_agreement,_period_start,_period_end);
  insert into public.partner_settlement_periods(
    company_id,supplier_id,agreement_id,period_start,period_end,status,currency,
    invoiced_revenue,collected_revenue,recognized_revenue,approved_shared_expenses,unpaid_approved_expenses,
    company_paid_shared_expenses,partner_paid_shared_expenses,net_result,company_share_amount,partner_share_amount,
    balance_due_to_partner,balance_due_to_company,recorded_cash_available,calculation_snapshot,calculated_at,created_by
  ) values(
    a.company_id,a.supplier_id,a.id,_period_start,_period_end,'draft','TOMAN',
    (snap->>'invoiced_revenue')::numeric,(snap->>'collected_revenue')::numeric,(snap->>'recognized_revenue')::numeric,
    (snap->>'approved_shared_expenses')::numeric,(snap->>'unpaid_approved_expenses')::numeric,
    (snap->>'company_paid_shared_expenses')::numeric,(snap->>'partner_paid_shared_expenses')::numeric,
    (snap->>'net_result')::numeric,(snap->>'company_share_amount')::numeric,(snap->>'partner_share_amount')::numeric,
    (snap->>'balance_due_to_partner')::numeric,(snap->>'balance_due_to_company')::numeric,
    (snap->>'recorded_cash_available')::numeric,snap,now(),auth.uid()
  ) returning id into new_id;
  return new_id;
end $$;

create or replace function public.refresh_partner_settlement_period(_period uuid)
returns void language plpgsql security definer set search_path='' as $$
declare p public.partner_settlement_periods%rowtype; snap jsonb;
begin
  select * into p from public.partner_settlement_periods where id=_period for update;
  if not found then raise exception 'دوره تسویه پیدا نشد'; end if;
  if not public.is_company_manager(p.company_id) then raise exception 'بازمحاسبه فقط برای مالک یا مدیر مجاز است'; end if;
  if p.status<>'draft' then raise exception 'فقط دوره پیش‌نویس قابل بازمحاسبه است'; end if;
  snap:=public.partner_statement_snapshot(p.agreement_id,p.period_start,p.period_end);
  update public.partner_settlement_periods set
    invoiced_revenue=(snap->>'invoiced_revenue')::numeric,
    collected_revenue=(snap->>'collected_revenue')::numeric,
    recognized_revenue=(snap->>'recognized_revenue')::numeric,
    approved_shared_expenses=(snap->>'approved_shared_expenses')::numeric,
    unpaid_approved_expenses=(snap->>'unpaid_approved_expenses')::numeric,
    company_paid_shared_expenses=(snap->>'company_paid_shared_expenses')::numeric,
    partner_paid_shared_expenses=(snap->>'partner_paid_shared_expenses')::numeric,
    net_result=(snap->>'net_result')::numeric,
    company_share_amount=(snap->>'company_share_amount')::numeric,
    partner_share_amount=(snap->>'partner_share_amount')::numeric,
    balance_due_to_partner=(snap->>'balance_due_to_partner')::numeric,
    balance_due_to_company=(snap->>'balance_due_to_company')::numeric,
    recorded_cash_available=(snap->>'recorded_cash_available')::numeric,
    calculation_snapshot=snap,calculated_at=now(),updated_at=now()
  where id=p.id;
end $$;

create or replace function public.approve_partner_settlement_period(_period uuid)
returns void language plpgsql security definer set search_path='' as $$
declare p public.partner_settlement_periods%rowtype;
begin
  select * into p from public.partner_settlement_periods where id=_period for update;
  if not found then raise exception 'دوره تسویه پیدا نشد'; end if;
  if not public.is_company_manager(p.company_id) then raise exception 'تأیید تسویه فقط برای مالک یا مدیر مجاز است'; end if;
  if p.status<>'draft' then raise exception 'فقط دوره پیش‌نویس قابل تأیید است'; end if;
  perform public.refresh_partner_settlement_period(p.id);
  update public.partner_settlement_periods set status='approved',approved_by=auth.uid(),approved_at=now(),updated_at=now() where id=p.id;
end $$;

create or replace function public.record_partner_settlement_payment(_period uuid, _amount numeric, _payment_reference text, _paid_at timestamptz default now())
returns void language plpgsql security definer set search_path='' as $$
declare p public.partner_settlement_periods%rowtype; remaining numeric(16,0);
begin
  select * into p from public.partner_settlement_periods where id=_period for update;
  if not found then raise exception 'دوره تسویه پیدا نشد'; end if;
  if not public.is_company_manager(p.company_id) then raise exception 'ثبت پرداخت فقط برای مالک یا مدیر مجاز است'; end if;
  if p.status not in ('approved','settled') then raise exception 'دوره باید قبل از ثبت پرداخت تأیید شده باشد'; end if;
  if _amount is null or _amount<=0 or nullif(trim(_payment_reference),'') is null then raise exception 'مبلغ و مرجع پرداخت واقعی لازم است'; end if;
  if p.balance_due_to_partner<=0 then raise exception 'این دوره مبلغی برای پرداخت به شریک ندارد'; end if;
  remaining:=p.balance_due_to_partner-p.settled_amount;
  if _amount>remaining then raise exception 'مبلغ پرداخت بیشتر از مانده دوره است'; end if;
  insert into public.partner_financial_entries(
    company_id,supplier_id,agreement_id,entry_type,status,direction,amount,paid_amount,currency,
    paid_by,payment_status,recognized_on,external_reference,source_table,source_record_id,notes,
    approved_by,approved_at,posted_by,posted_at,created_by
  ) values(
    p.company_id,p.supplier_id,p.agreement_id,'settlement_payment','posted','company_to_partner',_amount,_amount,p.currency,
    'company','paid',(_paid_at at time zone 'Asia/Tehran')::date,_payment_reference,'partner_settlement_periods',p.id,
    'پرداخت توسط مدیر ثبت و تأیید شده؛ انتقال بانکی توسط سامانه اجرا نمی‌شود.',
    auth.uid(),now(),auth.uid(),now(),auth.uid()
  );
  update public.partner_settlement_periods set settled_amount=settled_amount+_amount,
    status=case when settled_amount+_amount>=balance_due_to_partner then 'settled' else 'approved' end,
    settled_at=case when settled_amount+_amount>=balance_due_to_partner then coalesce(_paid_at,now()) else null end,
    settled_by=case when settled_amount+_amount>=balance_due_to_partner then auth.uid() else null end,
    updated_at=now()
  where id=p.id;
end $$;

-- Expose only role-checked RPC entry points; no anonymous access.
revoke all on function public.guard_approved_task_template() from public,anon,authenticated;
revoke all on function public.guard_partnership_agreement_version() from public,anon,authenticated;
revoke all on function public.guard_partner_financial_relationship() from public,anon,authenticated;
revoke all on function public.guard_task_status_transition() from public,anon,authenticated;
revoke all on function public.guard_posted_partner_financial_entry() from public,anon,authenticated;
revoke all on function public.guard_partner_settlement_period_update() from public,anon,authenticated;
revoke all on function public.submit_operational_task(uuid,text) from public,anon;
revoke all on function public.review_operational_task(uuid,text,text) from public,anon;
revoke all on function public.partner_statement_snapshot(uuid,date,date) from public,anon;
revoke all on function public.create_partner_settlement_period(uuid,date,date) from public,anon;
revoke all on function public.refresh_partner_settlement_period(uuid) from public,anon;
revoke all on function public.approve_partner_settlement_period(uuid) from public,anon;
revoke all on function public.record_partner_settlement_payment(uuid,numeric,text,timestamptz) from public,anon;
grant execute on function public.submit_operational_task(uuid,text) to authenticated;
grant execute on function public.review_operational_task(uuid,text,text) to authenticated;
grant execute on function public.partner_statement_snapshot(uuid,date,date) to authenticated;
grant execute on function public.create_partner_settlement_period(uuid,date,date) to authenticated;
grant execute on function public.refresh_partner_settlement_period(uuid) to authenticated;
grant execute on function public.approve_partner_settlement_period(uuid) to authenticated;
grant execute on function public.record_partner_settlement_payment(uuid,numeric,text,timestamptz) to authenticated;

-- Preserve append-only approved/posted records in the existing audit stream.
do $$
declare t text;
begin
  foreach t in array array[
    'farm_sites','partnership_agreements','flock_cycles','production_batches',
    'daily_production_records','task_templates','operational_tasks','task_evidence',
    'operational_incidents','partner_financial_entries','partner_settlement_periods'
  ] loop
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.audit_row_change()',t,t);
    execute format('create trigger touch_%I before update on public.%I for each row execute function public.touch_updated_at()',t,t);
  end loop;
end $$;

-- The operational evidence bucket is private. Object path: <company_uuid>/<task_uuid>/<filename>.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('operational-evidence','operational-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do nothing;

create policy operational_evidence_storage_read on storage.objects for select to authenticated
using (
  bucket_id='operational-evidence'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (
    public.is_company_internal(((storage.foldername(name))[1])::uuid)
    or exists (
      select 1 from public.operational_tasks t
      where t.company_id=((storage.foldername(name))[1])::uuid
        and t.id=((storage.foldername(name))[2])::uuid
        and (t.assignee_user_id=auth.uid() or t.assignee_supplier_id in (select public.my_supplier_ids()))
    )
  )
);
create policy operational_evidence_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id='operational-evidence'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (
    public.is_company_internal(((storage.foldername(name))[1])::uuid)
    or exists (
      select 1 from public.operational_tasks t
      where t.company_id=((storage.foldername(name))[1])::uuid
        and t.id=((storage.foldername(name))[2])::uuid
        and t.evidence_required
        and (t.assignee_user_id=auth.uid() or t.assignee_supplier_id in (select public.my_supplier_ids()))
    )
  )
);

-- Explicit grants for the newly-created tables. RLS remains the security boundary.
revoke all on public.farm_sites,public.partnership_agreements,public.flock_cycles,public.production_batches,
  public.daily_production_records,public.task_templates,public.operational_tasks,public.task_evidence,
  public.operational_incidents,public.partner_financial_entries,public.partner_settlement_periods from anon;
grant select,insert,update,delete on public.farm_sites,public.partnership_agreements,public.flock_cycles,
  public.production_batches,public.daily_production_records,public.task_templates,public.operational_tasks,
  public.task_evidence,public.operational_incidents,public.partner_financial_entries,public.partner_settlement_periods
to authenticated;
