-- Generalize farm records beyond one animal species or a small product set.
-- Existing records are preserved; legacy columns remain available while the UI moves to generic fields.
begin;

alter table public.farm_sites
  add column if not exists farm_type text not null default 'mixed';
alter table public.farm_sites
  drop constraint if exists farm_sites_farm_type_check;
alter table public.farm_sites
  add constraint farm_sites_farm_type_check
  check (farm_type in ('mixed','crop','livestock','poultry','dairy','aquaculture','greenhouse','orchard','apiary','other'));
alter table public.farm_sites alter column province drop default;
alter table public.farm_sites alter column province drop not null;

alter table public.flock_cycles
  drop constraint if exists flock_cycles_species_check;
alter table public.flock_cycles
  add constraint flock_cycles_species_check
  check (length(trim(species)) between 2 and 80);
alter table public.flock_cycles alter column species set default 'عمومی';
alter table public.flock_cycles add column if not exists initial_count integer;
update public.flock_cycles
  set initial_count = initial_bird_count
  where initial_count is null and initial_bird_count is not null;
alter table public.flock_cycles
  drop constraint if exists flock_cycles_initial_count_check;
alter table public.flock_cycles
  add constraint flock_cycles_initial_count_check
  check (initial_count is null or initial_count >= 0);

alter table public.production_batches
  drop constraint if exists production_batches_production_kind_check;
alter table public.production_batches
  add constraint production_batches_production_kind_check
  check (production_kind in ('crop','livestock','poultry','dairy','eggs','meat','aquaculture','honey','forestry','greenhouse','orchard','other'));

alter table public.daily_production_records add column if not exists input_name text;
alter table public.daily_production_records add column if not exists input_quantity numeric(14,3);
alter table public.daily_production_records add column if not exists input_unit text;
alter table public.daily_production_records add column if not exists loss_count integer not null default 0;
alter table public.daily_production_records add column if not exists rejected_quantity numeric(14,3) not null default 0;
update public.daily_production_records
  set loss_count = mortality_count
  where loss_count = 0 and mortality_count > 0;
alter table public.daily_production_records
  drop constraint if exists daily_production_records_input_quantity_check;
alter table public.daily_production_records
  add constraint daily_production_records_input_quantity_check
  check (input_quantity is null or input_quantity >= 0);
alter table public.daily_production_records
  drop constraint if exists daily_production_records_input_name_check;
alter table public.daily_production_records
  add constraint daily_production_records_input_name_check
  check (input_name is null or length(trim(input_name)) <= 120);
alter table public.daily_production_records
  drop constraint if exists daily_production_records_input_unit_check;
alter table public.daily_production_records
  add constraint daily_production_records_input_unit_check
  check (input_unit is null or length(trim(input_unit)) <= 32);
alter table public.daily_production_records
  drop constraint if exists daily_production_records_loss_count_check;
alter table public.daily_production_records
  add constraint daily_production_records_loss_count_check
  check (loss_count >= 0);
alter table public.daily_production_records
  drop constraint if exists daily_production_records_rejected_quantity_check;
alter table public.daily_production_records
  add constraint daily_production_records_rejected_quantity_check
  check (rejected_quantity >= 0 and (rejected_quantity = 0 or (produced_quantity is not null and rejected_quantity <= produced_quantity)));

commit;
