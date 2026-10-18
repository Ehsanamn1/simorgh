-- Reliable queue for real browser push delivery. In-app notifications remain authoritative.
CREATE TABLE IF NOT EXISTS public.medar_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 20 AND 2048),
  endpoint_hash text NOT NULL CHECK (endpoint_hash ~ '^[a-f0-9]{64}$'),
  p256dh_key text NOT NULL CHECK (length(p256dh_key) BETWEEN 80 AND 160),
  auth_secret text NOT NULL CHECK (length(auth_secret) BETWEEN 16 AND 64),
  expiration_time timestamptz,
  user_agent text NOT NULL DEFAULT '' CHECK (length(user_agent) <= 500),
  active boolean NOT NULL DEFAULT true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(endpoint_hash),
  UNIQUE(company_id,id)
);
CREATE INDEX IF NOT EXISTS medar_push_subscriptions_user_active_idx
  ON public.medar_push_subscriptions(company_id,user_id,updated_at DESC)
  WHERE active=true;

CREATE TABLE IF NOT EXISTS public.medar_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'push' CHECK (channel IN ('push')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE(company_id,user_id,channel,idempotency_key)
);
CREATE INDEX IF NOT EXISTS medar_notification_outbox_ready_idx
  ON public.medar_notification_outbox(next_attempt_at,created_at)
  WHERE status='queued';

CREATE OR REPLACE FUNCTION public.medar_enqueue_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.medar_notification_outbox
    (company_id,user_id,notification_id,payload,idempotency_key)
  SELECT
    NEW.company_id,NEW.user_id,NEW.id,
    jsonb_build_object('title',NEW.title,'body',coalesce(NEW.body,''),'href',coalesce(NEW.href,'/app/home')),
    coalesce(NEW.dedupe_key,NEW.id::text)
  WHERE EXISTS (
    SELECT 1 FROM public.medar_push_subscriptions s
    WHERE s.company_id=NEW.company_id AND s.user_id=NEW.user_id AND s.active=true
      AND (s.expiration_time IS NULL OR s.expiration_time>now())
  )
  ON CONFLICT(company_id,user_id,channel,idempotency_key) DO NOTHING;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS medar_notification_enqueue_push ON public.notifications;
CREATE TRIGGER medar_notification_enqueue_push
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.medar_enqueue_notification_push();

COMMENT ON TABLE public.medar_notification_outbox IS
  'Retryable push delivery queue generated from authoritative in-app notifications; never reports delivery without provider confirmation.';
COMMENT ON TABLE public.medar_push_subscriptions IS
  'Explicitly opted-in browser push endpoints, scoped to the authenticated company and user.';
