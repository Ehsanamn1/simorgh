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
alter table public.farm_sites drop constraint if exists farm_sites_coordinates_pair_check;
alter table public.farm_sites add constraint farm_sites_coordinates_pair_check
  check (
    (latitude is null and longitude is null)
    or (
      latitude between -90 and 90
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
