-- Reassert the identity fields required by owner-provisioned accounts.
-- 0011 originally made phone metadata optional; this forward-only guard repairs
-- installations whose migration ledger and physical schema drifted apart.
ALTER TABLE public.medar_users
  ALTER COLUMN phone_e164 DROP NOT NULL;

ALTER TABLE public.profiles
  ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE public.medar_users
  DROP CONSTRAINT IF EXISTS medar_users_requested_role_check;

ALTER TABLE public.medar_users
  ADD CONSTRAINT medar_users_requested_role_check
  CHECK (requested_role IN ('owner','admin','customer','supplier','driver','staff'));

-- The normalized key is authoritative for login and uniqueness. Backfill only
-- missing values, without rewriting usernames that may already be in use.
UPDATE public.medar_users
SET username_normalized = lower(btrim(username))
WHERE username_normalized IS NULL OR btrim(username_normalized) = '';
