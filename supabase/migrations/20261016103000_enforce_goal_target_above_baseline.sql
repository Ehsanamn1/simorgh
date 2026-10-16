alter table public.company_goals
  add constraint company_goals_target_above_baseline
  check (target_value > baseline_value);