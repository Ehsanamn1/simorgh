-- Company objectives are real, manager-owned targets. No seed/demo objectives are inserted.
create table if not exists public.company_objectives (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  description text null check (description is null or char_length(description) <= 600),
  metric_key text not null check (metric_key in (
    'orders', 'customers', 'suppliers', 'shipments', 'capacity',
    'late_orders', 'overdue_tasks', 'review_tasks', 'incidents',
    'invoices', 'failed_shipments', 'expiring_licenses'
  )),
  target_value numeric(14,2) not null check (target_value > 0),
  target_direction text not null default 'at_least'
    check (target_direction in ('at_least', 'at_most')),
  starts_on date not null default current_date,
  ends_on date null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'archived')),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_objectives_period_check check (ends_on is null or ends_on >= starts_on)
);

create index if not exists company_objectives_company_status_idx
  on public.company_objectives(company_id, status, ends_on);

create or replace function public.set_company_objectives_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists company_objectives_updated_at on public.company_objectives;
create trigger company_objectives_updated_at
before update on public.company_objectives
for each row execute function public.set_company_objectives_updated_at();

alter table public.company_objectives enable row level security;

drop policy if exists company_objectives_manager_select on public.company_objectives;
create policy company_objectives_manager_select
  on public.company_objectives for select to authenticated
  using (public.is_company_manager(company_id));

drop policy if exists company_objectives_manager_insert on public.company_objectives;
create policy company_objectives_manager_insert
  on public.company_objectives for insert to authenticated
  with check (public.is_company_manager(company_id) and created_by = auth.uid());

drop policy if exists company_objectives_manager_update on public.company_objectives;
create policy company_objectives_manager_update
  on public.company_objectives for update to authenticated
  using (public.is_company_manager(company_id))
  with check (public.is_company_manager(company_id));

drop policy if exists company_objectives_manager_delete on public.company_objectives;
create policy company_objectives_manager_delete
  on public.company_objectives for delete to authenticated
  using (public.is_company_manager(company_id));

revoke all on public.company_objectives from anon;
grant select, insert, update, delete on public.company_objectives to authenticated;
