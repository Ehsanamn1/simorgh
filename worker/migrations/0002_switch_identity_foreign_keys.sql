-- Switch tenant/profile foreign keys to the new Medar identity table.
-- This deliberately fails if legacy rows cannot be mapped; it does not delete or rewrite them.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES public.medar_users(id) ON DELETE CASCADE;

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_user_id_fkey;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.medar_users(id) ON DELETE CASCADE;

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_created_by_fkey;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.medar_users(id) ON DELETE SET NULL;
