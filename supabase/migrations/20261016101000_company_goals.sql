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
  owner_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
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
revoke all on public.company_goals from anon, authenticated;
grant select, insert, update, delete on public.company_goals to authenticated;

create policy company_goals_internal_read
  on public.company_goals for select to authenticated
  using (public.is_company_internal(company_id));

create policy company_goals_manager_insert
  on public.company_goals for insert to authenticated
  with check (
    public.is_company_manager(company_id)
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );

create policy company_goals_manager_update
  on public.company_goals for update to authenticated
  using (public.is_company_manager(company_id))
  with check (
    public.is_company_manager(company_id)
    and updated_by = (select auth.uid())
  );

create policy company_goals_manager_delete
  on public.company_goals for delete to authenticated
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
    values (v_company, (select auth.uid()), 'company_goals', v_id, v_action, v_changes);
    return old;
  end if;

  new.updated_at := now();
  new.updated_by := (select auth.uid());

  if tg_op = 'INSERT' then
    v_action := 'insert';
    new.created_by := (select auth.uid());
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
  values (new.company_id, (select auth.uid()), 'company_goals', new.id, v_action, v_changes);

  return new;
end;
$$;

revoke all on function public.audit_company_goal_change() from public, anon, authenticated;
create trigger company_goals_audit
before insert or update or delete on public.company_goals
for each row execute function public.audit_company_goal_change();
