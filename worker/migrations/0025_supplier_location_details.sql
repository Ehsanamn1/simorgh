-- Keep supplier location entry simple for Iranian field teams.
-- City/province/address are enough for registration; precise coordinates are optional and are not required here.
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS province text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS address text;
