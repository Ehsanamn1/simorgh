-- Keep supplier location entry simple for Iranian field teams.
-- City/province/address are enough for registration; precise coordinates are optional and are not required here.
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS province text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS longitude double precision;

DO $ BEGIN
  ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_location_coordinates_pair CHECK (
    (latitude IS NULL AND longitude IS NULL) OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $;
