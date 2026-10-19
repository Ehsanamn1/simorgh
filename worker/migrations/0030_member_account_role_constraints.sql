-- Fix the requested-role allowlist so owner-created administrator accounts can be provisioned.
-- This is additive/forward-only; already-applied migrations remain unchanged.
ALTER TABLE public.medar_users
  DROP CONSTRAINT IF EXISTS medar_users_requested_role_check;

ALTER TABLE public.medar_users
  ADD CONSTRAINT medar_users_requested_role_check
  CHECK (requested_role IN ('owner','admin','customer','supplier','driver','staff'));
