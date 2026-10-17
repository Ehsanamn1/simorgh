-- Central device/app presence across browser and native clients.
-- A row is telemetry for last-seen visibility only; it never grants authorization.
CREATE TABLE IF NOT EXISTS public.medar_client_presence (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('web', 'android', 'ios')),
  app_version text NOT NULL DEFAULT '0.1.0' CHECK (char_length(app_version) BETWEEN 1 AND 40),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id, client_id)
);

CREATE INDEX IF NOT EXISTS medar_client_presence_company_seen_idx
  ON public.medar_client_presence(company_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS medar_client_presence_user_seen_idx
  ON public.medar_client_presence(user_id, last_seen_at DESC);

COMMENT ON TABLE public.medar_client_presence IS
  'Last-seen presence of authenticated Medar browser and native clients; not an authorization source.';
