-- Durable, tenant-scoped operational event and exception ledger.
-- Business events are append-only by application contract; exceptions track ownership and resolution.
CREATE TABLE IF NOT EXISTS public.medar_operational_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.medar_users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  source_type text NOT NULL CHECK (source_type IN ('order','purchase_order','task','shipment','invoice','inventory','production','quality','supplier','system','other')),
  source_id uuid,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  idempotency_key text CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 8 AND 240),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS medar_operational_events_idempotency_uq
  ON public.medar_operational_events(company_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS medar_operational_events_company_recent_idx
  ON public.medar_operational_events(company_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS medar_operational_events_source_idx
  ON public.medar_operational_events(company_id,source_type,source_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.medar_exception_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_id uuid,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  details text NOT NULL DEFAULT '' CHECK (length(details) <= 4000),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','in_progress','resolved','closed')),
  assigned_user_id uuid REFERENCES public.medar_users(id) ON DELETE SET NULL,
  due_at timestamptz,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.medar_users(id) ON DELETE SET NULL,
  resolution_note text CHECK (resolution_note IS NULL OR length(resolution_note) <= 2000),
  dedupe_key text CHECK (dedupe_key IS NULL OR length(dedupe_key) BETWEEN 8 AND 240),
  created_by uuid REFERENCES public.medar_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id,id),
  FOREIGN KEY (company_id,event_id) REFERENCES public.medar_operational_events(company_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS medar_exception_cases_dedupe_uq
  ON public.medar_exception_cases(company_id,dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status NOT IN ('resolved','closed');
CREATE INDEX IF NOT EXISTS medar_exception_cases_work_queue_idx
  ON public.medar_exception_cases(company_id,status,severity,due_at ASC,created_at DESC);
CREATE INDEX IF NOT EXISTS medar_exception_cases_assignee_idx
  ON public.medar_exception_cases(company_id,assigned_user_id,status,due_at ASC);

COMMENT ON TABLE public.medar_operational_events IS
  'Tenant-scoped operational event ledger. Events are append-only by application contract and support idempotent ingestion.';
COMMENT ON TABLE public.medar_exception_cases IS
  'Actionable operational issues with ownership, acknowledgement, due date, deduplication, and resolution history.';
