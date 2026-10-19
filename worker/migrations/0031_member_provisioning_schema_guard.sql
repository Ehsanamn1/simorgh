-- Forward-only repair for installations whose migration ledger and physical schema drifted apart.
-- These fields must be nullable for username/password accounts without phone metadata.
ALTER TABLE public.medar_users
  ALTER COLUMN phone_e164 DROP NOT NULL;

ALTER TABLE public.profiles
  ALTER COLUMN phone DROP NOT NULL;

-- Keep role validation aligned with the actual account-provisioning API.
ALTER TABLE public.medar_users
  DROP CONSTRAINT IF EXISTS medar_users_requested_role_check;

ALTER TABLE public.medar_users
  ADD CONSTRAINT medar_users_requested_role_check
  CHECK (requested_role IN ('owner','admin','customer','supplier','driver','staff'));

-- username_normalized is written explicitly by the Worker for all newly created users.
