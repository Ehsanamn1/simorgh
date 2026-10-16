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
