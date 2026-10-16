
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

revoke all on function public.validate_company_goal_record() from public, anon, authenticated;

create trigger company_goals_validate
before insert or update of company_id, baseline_value, target_value, current_value, owner_user_id
on public.company_goals
for each row execute function public.validate_company_goal_record();
