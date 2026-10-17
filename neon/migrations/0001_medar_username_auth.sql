-- Medar username/password identity foundation (Neon PostgreSQL).
-- Apply only to the intended Neon branch after reviewing a backup. This migration is additive.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.medar_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  username_normalized text GENERATED ALWAYS AS (lower(btrim(username))) STORED,
  phone_e164 text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  requested_role text NOT NULL DEFAULT 'customer'
    CHECK (requested_role IN ('customer','supplier','driver','staff')),
  account_status text NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active','locked','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS medar_users_username_unique ON public.medar_users(username_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS medar_users_phone_unique ON public.medar_users(phone_e164);

CREATE TABLE IF NOT EXISTS public.medar_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  user_agent text,
  ip_hash text
);
CREATE INDEX IF NOT EXISTS medar_sessions_user_active ON public.medar_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.medar_login_attempts (
  id bigserial PRIMARY KEY,
  username_normalized text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  succeeded boolean NOT NULL DEFAULT false,
  ip_hash text
);
CREATE INDEX IF NOT EXISTS medar_login_attempts_recent ON public.medar_login_attempts(username_normalized, attempted_at DESC);

CREATE TABLE IF NOT EXISTS public.medar_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE CASCADE,
  requested_role text NOT NULL CHECK (requested_role IN ('customer','supplier','driver','staff')),
  organization_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES public.medar_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, requested_role, status)
);
CREATE INDEX IF NOT EXISTS medar_access_requests_pending ON public.medar_access_requests(created_at DESC) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.medar_audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES public.medar_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS medar_audit_log_created_at ON public.medar_audit_log(created_at DESC);

COMMENT ON TABLE public.medar_users IS 'Medar application identity; username/password auth without email or SMS OTP.';
COMMENT ON TABLE public.medar_sessions IS 'Opaque, hashed server-side sessions; browser receives only the HttpOnly session cookie.';
COMMENT ON TABLE public.medar_access_requests IS 'Role requests are not grants; privileged membership requires an approved server-side workflow.';
