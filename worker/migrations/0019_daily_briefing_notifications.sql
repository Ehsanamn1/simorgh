-- Idempotency for scheduled in-app briefing notifications.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_company_user_dedupe_key_uq
  ON public.notifications(company_id,user_id,dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_user_unread_created_idx
  ON public.notifications(company_id,user_id,created_at DESC)
  WHERE read_at IS NULL;

COMMENT ON COLUMN public.notifications.dedupe_key IS
  'Optional idempotency key for scheduled notifications; prevents duplicate daily briefings for the same role and business date.';
