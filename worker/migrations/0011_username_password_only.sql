-- Username/password-only registration: phone is optional metadata, not an account requirement.
-- Deployment and CI apply this migration in a transaction.

ALTER TABLE public.medar_users
  ALTER COLUMN phone_e164 DROP NOT NULL;

ALTER TABLE public.profiles
  ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE public.medar_users
  DROP CONSTRAINT IF EXISTS medar_users_active_phone_required;
