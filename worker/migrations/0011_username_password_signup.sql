-- Username/password-only signup does not collect phone numbers.
-- Keep nullable phone columns for existing integrations and legacy accounts.
ALTER TABLE public.medar_users ALTER COLUMN phone_e164 DROP NOT NULL;
-- Remove the legacy invariant that forced every active account to have a phone.
ALTER TABLE public.medar_users DROP CONSTRAINT IF EXISTS medar_users_active_phone_required;
ALTER TABLE public.profiles ALTER COLUMN phone DROP NOT NULL;
