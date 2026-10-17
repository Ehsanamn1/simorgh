-- Username/password-only signup does not collect phone numbers.
-- Keep nullable phone columns for existing integrations and legacy accounts.
ALTER TABLE public.medar_users ALTER COLUMN phone_e164 DROP NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN phone DROP NOT NULL;
