-- Operational integrity constraints and indexes ported from the later Supabase migrations.
ALTER TABLE public.operational_tasks ADD COLUMN IF NOT EXISTS review_note text;
CREATE UNIQUE INDEX IF NOT EXISTS partnership_agreements_one_active_per_supplier_idx ON public.partnership_agreements(company_id,supplier_id) WHERE status='active';

-- RLS policies, triggers and auth.uid()-dependent functions are intentionally excluded; Worker APIs
-- must enforce tenant membership and actor permissions explicitly.
-- This migration is additive and idempotent where possible.

alter table public.production_batches alter column supplier_id drop not null;

alter table public.daily_production_records add column if not exists updated_at timestamptz not null default now();

alter table public.task_evidence add column if not exists updated_at timestamptz not null default now();

alter table public.partnership_agreements alter column shared_expense_categories set default '{}'::text[];

alter table public.access_requests drop constraint if exists access_requests_requested_role_check;

ALTER TABLE public.access_requests DROP CONSTRAINT IF EXISTS access_requests_requested_role_check;

alter table public.access_requests add constraint access_requests_requested_role_check check(requested_role in ('staff','customer','supplier','driver'));

alter table public.access_requests add column if not exists email text;

ALTER TABLE public.company_goals DROP CONSTRAINT IF EXISTS company_goals_target_above_baseline;

alter table public.company_goals
  add constraint company_goals_target_above_baseline
  check (target_value > baseline_value);
