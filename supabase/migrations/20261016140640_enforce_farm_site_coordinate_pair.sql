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
