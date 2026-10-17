

-- Source migration: 20261015195500_shipment_location_tracking.sql
-- Explicit, permissioned GPS points for assigned shipment drivers.
create table public.shipment_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  driver_user_id uuid not null references public.app_users(id) on delete cascade,
  latitude double precision not null check (latitude >= -90 and latitude <= 90),
  longitude double precision not null check (longitude >= -180 and longitude <= 180),
  accuracy_m double precision check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000)),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index shipment_locations_company_captured_idx
  on public.shipment_locations(company_id, captured_at desc);
create index shipment_locations_shipment_captured_idx
  on public.shipment_locations(shipment_id, captured_at desc);

alter table public.shipment_locations enable row level security;



create policy shipment_locations_internal_read
  on public.shipment_locations
  for select to public
  using (public.is_company_internal(company_id));

create policy shipment_locations_assigned_driver_read
  on public.shipment_locations
  for select to public
  using (
    driver_user_id = (select public.medar_user_id())
    and exists (
      select 1 from public.shipments s
      where s.id = shipment_locations.shipment_id
        and s.company_id = shipment_locations.company_id
        and s.driver_user_id = (select public.medar_user_id())
    )
  );

create policy shipment_locations_assigned_driver_insert
  on public.shipment_locations
  for insert to public
  with check (
    driver_user_id = (select public.medar_user_id())
    and exists (
      select 1
      from public.memberships m
      where m.company_id = shipment_locations.company_id
        and m.user_id = (select public.medar_user_id())
        and m.active = true
        and m.role = 'driver'::public.app_role
    )
    and exists (
      select 1
      from public.shipments s
      where s.id = shipment_locations.shipment_id
        and s.company_id = shipment_locations.company_id
        and s.driver_user_id = (select public.medar_user_id())
        and s.stage::text in ('planned','loading','in_transit','arrived')
    )
  );


-- Source migration: 20261015200000_inventory_movement_ledger.sql
-- Stock and purchase receipt ledger with transactional stock checks and internal-only visibility.
create table public.inventory_movements (
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
  recorded_by uuid references public.app_users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index inventory_movements_company_product_time_idx
  on public.inventory_movements(company_id, product_id, occurred_at desc);
create index inventory_movements_company_supplier_time_idx
  on public.inventory_movements(company_id, supplier_id, occurred_at desc);

alter table public.inventory_movements enable row level security;



create policy inventory_movements_internal_read
  on public.inventory_movements
  for select to public
  using (public.is_company_internal(company_id));

create view public.inventory_balances
with (security_invoker = true, security_barrier = true)
as
select
  p.company_id,
  p.id as product_id,
  p.sku,
  p.name as product_name,
  p.unit,
  p.active as product_active,
  coalesce(sum(
    case
      when m.movement_type in ('purchase_in','adjustment_in','return_in') then m.quantity
      when m.movement_type in ('sale_out','adjustment_out','waste_out') then -m.quantity
      else 0
    end
  ), 0)::numeric(16,3) as quantity_on_hand,
  max(m.occurred_at) as last_movement_at,
  (
    select im.unit_cost
    from public.inventory_movements im
    where im.company_id = p.company_id
      and im.product_id = p.id
      and im.unit_cost is not null
    order by im.occurred_at desc, im.created_at desc
    limit 1
  ) as latest_unit_cost
from public.products p
left join public.inventory_movements m
  on m.company_id = p.company_id and m.product_id = p.id
where public.is_company_internal(p.company_id)
group by p.company_id, p.id, p.sku, p.name, p.unit, p.active;




create or replace function public.record_inventory_movement(
  _company uuid,
  _product uuid,
  _movement_type text,
  _quantity numeric,
  _unit_cost numeric default null,
  _supplier uuid default null,
  _order uuid default null,
  _lot uuid default null,
  _reference_code text default null,
  _note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current numeric(16,3);
  v_id uuid;
begin
  if (select public.medar_user_id()) is null then
    raise exception 'Authentication required.';
  end if;
  if not public.is_company_internal(_company) then
    raise exception 'Company internal role required.';
  end if;
  if _quantity is null or _quantity <= 0 then
    raise exception 'Quantity must be greater than zero.';
  end if;
  if _movement_type not in ('purchase_in','sale_out','adjustment_in','adjustment_out','waste_out','return_in') then
    raise exception 'Invalid inventory movement type.';
  end if;
  if not exists (
    select 1 from public.products p
    where p.id = _product and p.company_id = _company
  ) then
    raise exception 'Product does not belong to this company.';
  end if;
  if _supplier is not null and not exists (
    select 1 from public.suppliers s
    where s.id = _supplier and s.company_id = _company
  ) then
    raise exception 'Supplier does not belong to this company.';
  end if;
  if _order is not null and not exists (
    select 1 from public.orders o
    where o.id = _order and o.company_id = _company
  ) then
    raise exception 'Order does not belong to this company.';
  end if;
  if _lot is not null and not exists (
    select 1 from public.lots l
    where l.id = _lot and l.company_id = _company and l.product_id = _product
  ) then
    raise exception 'Lot does not match the company and product.';
  end if;
  if _movement_type = 'purchase_in' and (_supplier is null or _unit_cost is null or _unit_cost < 0) then
    raise exception 'Purchase receipts require a valid supplier and unit cost.';
  end if;
  if _movement_type = 'sale_out' and _order is null then
    raise exception 'Sales issue requires a linked order.';
  end if;
  if _movement_type in ('adjustment_in','adjustment_out','waste_out')
     and length(trim(coalesce(_note,''))) < 4 then
    raise exception 'A reason of at least four characters is required for adjustments and waste.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_company::text || ':' || _product::text, 0)
  );

  if _movement_type in ('sale_out','adjustment_out','waste_out') then
    select coalesce(sum(
      case
        when movement_type in ('purchase_in','adjustment_in','return_in') then quantity
        else -quantity
      end
    ),0)
    into v_current
    from public.inventory_movements
    where company_id = _company and product_id = _product;
    if _quantity > v_current then
      raise exception 'Insufficient stock. Available: %, requested: %.', v_current, _quantity;
    end if;
  end if;

  insert into public.inventory_movements(
    company_id,product_id,movement_type,quantity,unit_cost,supplier_id,order_id,lot_id,
    reference_code,note,recorded_by
  ) values (
    _company,_product,_movement_type,_quantity,_unit_cost,_supplier,_order,_lot,
    nullif(trim(coalesce(_reference_code,'')),''),
    nullif(trim(coalesce(_note,'')),''),
    (select public.medar_user_id())
  ) returning id into v_id;

  insert into public.audit_events(company_id,actor_id,table_name,record_id,action,changes)
  values (
    _company,(select public.medar_user_id()),'inventory_movements',v_id,'insert',
    jsonb_build_object('product_id',_product,'movement_type',_movement_type,'quantity',_quantity,'reference_code',nullif(trim(coalesce(_reference_code,'')),''))
  );

  return v_id;
end;
$$;





-- Source migration: 20261016101000_company_goals.sql
create table public.company_goals (
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
  owner_user_id uuid references public.app_users(id) on delete set null,
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or period_start is null or due_date >= period_start),
  check (target_value >= 0)
);

create index company_goals_company_status_due_idx
  on public.company_goals(company_id, status, due_date);
create index company_goals_company_created_idx
  on public.company_goals(company_id, created_at desc);

alter table public.company_goals enable row level security;



create policy company_goals_internal_read
  on public.company_goals for select to public
  using (public.is_company_internal(company_id));

create policy company_goals_manager_insert
  on public.company_goals for insert to public
  with check (
    public.is_company_manager(company_id)
    and created_by = (select public.medar_user_id())
    and updated_by = (select public.medar_user_id())
  );

create policy company_goals_manager_update
  on public.company_goals for update to public
  using (public.is_company_manager(company_id))
  with check (
    public.is_company_manager(company_id)
    and updated_by = (select public.medar_user_id())
  );

create policy company_goals_manager_delete
  on public.company_goals for delete to public
  using (public.is_company_manager(company_id));

create or replace function public.audit_company_goal_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_id uuid;
  v_action text;
  v_changes jsonb;
begin
  if tg_op = 'DELETE' then
    v_company := old.company_id;
    v_id := old.id;
    v_action := 'delete';
    v_changes := jsonb_build_object(
      'title', old.title, 'status', old.status, 'target_value', old.target_value,
      'current_value', old.current_value, 'category', old.category
    );
    insert into public.audit_events(company_id, actor_id, table_name, record_id, action, changes)
    values (v_company, (select public.medar_user_id()), 'company_goals', v_id, v_action, v_changes);
    return old;
  end if;

  new.updated_at := now();
  new.updated_by := (select public.medar_user_id());

  if tg_op = 'INSERT' then
    v_action := 'insert';
    new.created_by := (select public.medar_user_id());
    v_changes := jsonb_build_object(
      'title', new.title, 'status', new.status, 'target_value', new.target_value,
      'current_value', new.current_value, 'category', new.category
    );
  else
    v_action := 'update';
    v_changes := jsonb_build_object(
      'before', jsonb_build_object(
        'title', old.title, 'status', old.status, 'target_value', old.target_value,
        'current_value', old.current_value, 'category', old.category
      ),
      'after', jsonb_build_object(
        'title', new.title, 'status', new.status, 'target_value', new.target_value,
        'current_value', new.current_value, 'category', new.category
      )
    );
  end if;

  insert into public.audit_events(company_id, actor_id, table_name, record_id, action, changes)
  values (new.company_id, (select public.medar_user_id()), 'company_goals', new.id, v_action, v_changes);

  return new;
end;
$$;


create trigger company_goals_audit
before insert or update or delete on public.company_goals
for each row execute function public.audit_company_goal_change();


-- Source migration: 20261016103000_enforce_goal_target_above_baseline.sql
alter table public.company_goals
  add constraint company_goals_target_above_baseline
  check (target_value > baseline_value);

-- Source migration: 20261016104000_validate_company_goal_values_and_owner.sql

alter table public.company_goals
  add constraint company_goals_baseline_nonnegative check (baseline_value >= 0),
  add constraint company_goals_current_nonnegative check (current_value >= 0);

create or replace function public.validate_company_goal_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.baseline_value < 0 or new.current_value < 0 then
    raise exception 'Goal baseline and current value must be zero or greater.';
  end if;
  if new.target_value <= new.baseline_value then
    raise exception 'Goal target must be greater than baseline.';
  end if;
  if new.owner_user_id is not null and not exists (
    select 1
    from public.memberships m
    where m.company_id = new.company_id
      and m.user_id = new.owner_user_id
      and m.active = true
  ) then
    raise exception 'Goal owner must be an active member of the same company.';
  end if;
  return new;
end;
$$;



create trigger company_goals_validate
before insert or update of company_id, baseline_value, target_value, current_value, owner_user_id
on public.company_goals
for each row execute function public.validate_company_goal_record();


-- Source migration: 20261016105000_restrict_goal_assignees_to_internal_members.sql
create or replace function public.validate_company_goal_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.baseline_value < 0 or new.current_value < 0 then
    raise exception 'Goal baseline and current value must be zero or greater.';
  end if;
  if new.target_value <= new.baseline_value then
    raise exception 'Goal target must be greater than baseline.';
  end if;
  if new.owner_user_id is not null and not exists (
    select 1 from public.memberships m
    where m.company_id = new.company_id
      and m.user_id = new.owner_user_id
      and m.active = true
      and m.role::text in ('owner','admin','staff')
  ) then
    raise exception 'Goal owner must be an active internal member of the same company.';
  end if;
  return new;
end;
$$;



-- Source migration: 20261016123004_general_farm_management.sql
-- General-purpose farm operations.
-- Additive and backward-compatible: keep legacy fields and values readable while new
-- records can describe crops, livestock, poultry, aquaculture, processing and logistics.

begin;

-- Product categories were too narrow for a general farm-management system. Convert the
-- column to text while preserving existing enum values, then enforce the expanded catalog.
alter table public.products alter column kind type text using kind::text;
alter table public.products drop constraint if exists products_kind_check;
alter table public.products add constraint products_kind_check
  check (kind in (
    'farm_product','crop','livestock','poultry','aquaculture','dairy',
    'eggs','meat','input','feed','equipment','processed','service','other'
  ));

-- A farm site may represent a field, orchard, greenhouse, livestock/poultry unit,
-- aquaculture site, processing unit, warehouse or distribution point.
alter table public.farm_sites
  add column if not exists site_type text not null default 'mixed',
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.farm_sites drop constraint if exists farm_sites_site_type_check;
alter table public.farm_sites add constraint farm_sites_site_type_check
  check (site_type in (
    'crop','livestock','poultry','aquaculture','greenhouse','orchard',
    'processing','warehouse','distribution','mixed','other'
  ));
alter table public.farm_sites alter column province set default 'نامشخص';
alter table public.farm_sites drop constraint if exists farm_sites_coordinates_pair_check;
alter table public.farm_sites add constraint farm_sites_coordinates_pair_check
  check (
    (latitude is null and longitude is null)
    or (
      latitude is not null and longitude is not null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  );

-- Generalize the former quail-only "flock cycles" model without renaming the table,
-- so existing foreign keys, audit triggers and policies remain valid.
alter table public.flock_cycles
  add column if not exists cycle_type text not null default 'poultry',
  add column if not exists initial_quantity numeric(14,3),
  add column if not exists quantity_unit text not null default 'عدد';

alter table public.flock_cycles drop constraint if exists flock_cycles_species_check;
alter table public.flock_cycles alter column species drop default;
alter table public.flock_cycles drop constraint if exists flock_cycles_species_nonempty_check;
alter table public.flock_cycles add constraint flock_cycles_species_nonempty_check
  check (length(trim(species)) between 1 and 80);
alter table public.flock_cycles drop constraint if exists flock_cycles_cycle_type_check;
alter table public.flock_cycles add constraint flock_cycles_cycle_type_check
  check (cycle_type in ('crop','livestock','poultry','aquaculture','greenhouse','orchard','mixed','other'));
alter table public.flock_cycles drop constraint if exists flock_cycles_initial_quantity_check;
alter table public.flock_cycles add constraint flock_cycles_initial_quantity_check
  check (initial_quantity is null or initial_quantity >= 0);
alter table public.flock_cycles drop constraint if exists flock_cycles_quantity_unit_check;
alter table public.flock_cycles add constraint flock_cycles_quantity_unit_check
  check (length(trim(quantity_unit)) between 1 and 24);

-- Carry forward historic counts into the new unit-aware quantity fields.
update public.flock_cycles
set initial_quantity = initial_bird_count
where initial_quantity is null and initial_bird_count is not null;

-- Production batches can now describe non-poultry outputs while retaining legacy rows.
alter table public.production_batches drop constraint if exists production_batches_production_kind_check;
alter table public.production_batches add constraint production_batches_production_kind_check
  check (production_kind in (
    'farm_product','crop','livestock','poultry','aquaculture','dairy',
    'eggs','meat','input','feed','equipment','processed','service','other'
  ));

-- Generic resource consumption, losses and production output coexist with the original
-- columns to preserve reports and integrations that still read feed/egg/mortality fields.
alter table public.daily_production_records
  add column if not exists resource_name text,
  add column if not exists input_quantity numeric(14,3) not null default 0,
  add column if not exists input_unit text not null default 'کیلوگرم',
  add column if not exists loss_quantity numeric(14,3) not null default 0,
  add column if not exists loss_unit text not null default 'عدد';

alter table public.daily_production_records drop constraint if exists daily_production_input_quantity_check;
alter table public.daily_production_records add constraint daily_production_input_quantity_check
  check (input_quantity >= 0);
alter table public.daily_production_records drop constraint if exists daily_production_loss_quantity_check;
alter table public.daily_production_records add constraint daily_production_loss_quantity_check
  check (loss_quantity >= 0);
alter table public.daily_production_records drop constraint if exists daily_production_input_unit_check;
alter table public.daily_production_records add constraint daily_production_input_unit_check
  check (length(trim(input_unit)) between 1 and 24);
alter table public.daily_production_records drop constraint if exists daily_production_loss_unit_check;
alter table public.daily_production_records add constraint daily_production_loss_unit_check
  check (length(trim(loss_unit)) between 1 and 24);

-- Preserve the meaning of previously recorded feed consumption and mortality in the
-- generalized ledger fields for a smooth transition.
update public.daily_production_records
set input_quantity = feed_consumed_kg,
    resource_name = coalesce(resource_name, 'خوراک'),
    input_unit = 'کیلوگرم'
where input_quantity = 0 and feed_consumed_kg > 0;

update public.daily_production_records
set loss_quantity = mortality_count,
    loss_unit = 'عدد'
where loss_quantity = 0 and mortality_count > 0;

commit;


-- Source migration: 20261016135620_generalize_farm_operations.sql
-- Generalize farm sites, production cycles and daily records across agricultural sectors.
-- Existing records are preserved; old poultry-specific columns remain for backward compatibility.
-- Apply this migration to Supabase before deploying the related form changes.
begin;

-- Farm sites can represent more than a poultry farm, and coordinates power real map pins.
alter table public.farm_sites
  add column if not exists site_type text not null default 'mixed';
alter table public.farm_sites
  drop constraint if exists farm_sites_site_type_check;
alter table public.farm_sites
  add constraint farm_sites_site_type_check
  check (site_type in ('crop','livestock','poultry','dairy','aquaculture','greenhouse','orchard','apiary','processing','warehouse','distribution','mixed','other'));
alter table public.farm_sites add column if not exists latitude double precision;
alter table public.farm_sites add column if not exists longitude double precision;
alter table public.farm_sites
  drop constraint if exists farm_sites_latitude_check;
alter table public.farm_sites
  add constraint farm_sites_latitude_check
  check (latitude is null or latitude between -90 and 90);
alter table public.farm_sites
  drop constraint if exists farm_sites_longitude_check;
alter table public.farm_sites
  add constraint farm_sites_longitude_check
  check (longitude is null or longitude between -180 and 180);
alter table public.farm_sites alter column province drop default;
alter table public.farm_sites alter column province drop not null;

-- Retain the legacy initial_bird_count column, while introducing a unit-aware quantity.
alter table public.flock_cycles
  drop constraint if exists flock_cycles_species_check;
alter table public.flock_cycles
  add constraint flock_cycles_species_check
  check (length(trim(species)) between 1 and 80);
alter table public.flock_cycles alter column species set default 'عمومی';

alter table public.flock_cycles
  add column if not exists cycle_type text not null default 'poultry';
alter table public.flock_cycles
  drop constraint if exists flock_cycles_cycle_type_check;
alter table public.flock_cycles
  add constraint flock_cycles_cycle_type_check
  check (cycle_type in ('crop','livestock','poultry','dairy','aquaculture','greenhouse','orchard','apiary','mixed','other'));

alter table public.flock_cycles
  add column if not exists initial_quantity numeric(14,3);
alter table public.flock_cycles
  add column if not exists quantity_unit text not null default 'عدد';
update public.flock_cycles
  set initial_quantity = initial_bird_count
  where initial_quantity is null and initial_bird_count is not null;
alter table public.flock_cycles
  drop constraint if exists flock_cycles_initial_quantity_check;
alter table public.flock_cycles
  add constraint flock_cycles_initial_quantity_check
  check (initial_quantity is null or initial_quantity >= 0);
alter table public.flock_cycles
  drop constraint if exists flock_cycles_quantity_unit_check;
alter table public.flock_cycles
  add constraint flock_cycles_quantity_unit_check
  check (length(trim(quantity_unit)) between 1 and 24);
alter table public.flock_cycles alter column cycle_type set default 'mixed';

-- Allow production categories beyond eggs and meat while preserving the project's current kinds.
alter table public.production_batches
  drop constraint if exists production_batches_production_kind_check;
alter table public.production_batches
  add constraint production_batches_production_kind_check
  check (production_kind in ('farm_product','crop','livestock','poultry','dairy','eggs','meat','aquaculture','honey','forestry','greenhouse','orchard','input','feed','equipment','processed','service','other'));

-- Universal inputs, outputs, losses and rejected quantity; old species-specific fields are kept.
alter table public.daily_production_records add column if not exists resource_name text;
alter table public.daily_production_records
  add column if not exists input_quantity numeric(14,3) not null default 0;
alter table public.daily_production_records
  add column if not exists input_unit text not null default 'کیلوگرم';
alter table public.daily_production_records
  add column if not exists loss_quantity numeric(14,3) not null default 0;
alter table public.daily_production_records
  add column if not exists loss_unit text not null default 'عدد';
alter table public.daily_production_records
  add column if not exists rejected_quantity numeric(14,3) not null default 0;

alter table public.daily_production_records
  drop constraint if exists daily_production_records_resource_name_check;
alter table public.daily_production_records
  add constraint daily_production_records_resource_name_check
  check (resource_name is null or length(trim(resource_name)) <= 120);
alter table public.daily_production_records
  drop constraint if exists daily_production_records_input_quantity_check;
alter table public.daily_production_records
  add constraint daily_production_records_input_quantity_check
  check (input_quantity >= 0);
alter table public.daily_production_records
  drop constraint if exists daily_production_records_input_unit_check;
alter table public.daily_production_records
  add constraint daily_production_records_input_unit_check
  check (length(trim(input_unit)) between 1 and 24);
alter table public.daily_production_records
  drop constraint if exists daily_production_records_loss_quantity_check;
alter table public.daily_production_records
  add constraint daily_production_records_loss_quantity_check
  check (loss_quantity >= 0);
alter table public.daily_production_records
  drop constraint if exists daily_production_records_loss_unit_check;
alter table public.daily_production_records
  add constraint daily_production_records_loss_unit_check
  check (length(trim(loss_unit)) between 1 and 24);
alter table public.daily_production_records
  drop constraint if exists daily_production_records_rejected_quantity_check;
alter table public.daily_production_records
  add constraint daily_production_records_rejected_quantity_check
  check (rejected_quantity >= 0 and (rejected_quantity = 0 or (produced_quantity is not null and rejected_quantity <= produced_quantity)));

commit;


-- Source migration: 20261016140640_enforce_farm_site_coordinate_pair.sql
-- Harden coordinate completeness for databases where the general-farm migration already ran.
begin;
alter table public.farm_sites alter column province set default 'نامشخص';
alter table public.farm_sites drop constraint if exists farm_sites_coordinates_pair_check;
alter table public.farm_sites add constraint farm_sites_coordinates_pair_check
  check (
    (latitude is null and longitude is null)
    or (
      latitude is not null and longitude is not null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  );
commit;


-- Source migration: 20261016143147_extend_product_catalog_kinds.sql
-- Extend product catalog categories to match the generalized farm and production workflows.
-- Additive: existing supported values and product records remain valid.
begin;

alter table public.products drop constraint if exists products_kind_check;
alter table public.products add constraint products_kind_check
  check (kind in (
    'farm_product','crop','livestock','poultry','aquaculture','dairy',
    'eggs','meat','honey','forestry','greenhouse','orchard',
    'input','feed','equipment','processed','service','other'
  ));

commit;


-- Enforce row-level tenant isolation for Worker requests.
do $$ declare table_name text; begin foreach table_name in array array[
'companies','profiles','memberships','customers','suppliers','products','price_agreements','orders','order_items','capacity_commitments','lots','quality_reviews','shipments','delivery_evidence','invoices','settlements','notifications','audit_events','access_requests','farm_sites','partnership_agreements','flock_cycles','production_batches','daily_production_records','task_templates','operational_tasks','task_evidence','operational_incidents','partner_financial_entries','partner_settlement_periods','shipment_locations','inventory_movements','company_goals','medar_files'
] loop
  if to_regclass('public.'||table_name) is not null then
    execute format('alter table public.%I enable row level security',table_name);
    execute format('alter table public.%I force row level security',table_name);
  end if;
end loop; end $$;
