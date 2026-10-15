-- Explicit, permissioned GPS points for assigned shipment drivers.
create table public.shipment_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  driver_user_id uuid not null references auth.users(id) on delete cascade,
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
revoke all on public.shipment_locations from anon, authenticated;
grant select, insert on public.shipment_locations to authenticated;

create policy shipment_locations_internal_read
  on public.shipment_locations
  for select to authenticated
  using (public.is_company_internal(company_id));

create policy shipment_locations_assigned_driver_read
  on public.shipment_locations
  for select to authenticated
  using (
    driver_user_id = (select auth.uid())
    and exists (
      select 1 from public.shipments s
      where s.id = shipment_locations.shipment_id
        and s.company_id = shipment_locations.company_id
        and s.driver_user_id = (select auth.uid())
    )
  );

create policy shipment_locations_assigned_driver_insert
  on public.shipment_locations
  for insert to authenticated
  with check (
    driver_user_id = (select auth.uid())
    and exists (
      select 1
      from public.memberships m
      where m.company_id = shipment_locations.company_id
        and m.user_id = (select auth.uid())
        and m.active = true
        and m.role = 'driver'::public.app_role
    )
    and exists (
      select 1
      from public.shipments s
      where s.id = shipment_locations.shipment_id
        and s.company_id = shipment_locations.company_id
        and s.driver_user_id = (select auth.uid())
        and s.stage::text in ('planned','loading','in_transit','arrived')
    )
  );
