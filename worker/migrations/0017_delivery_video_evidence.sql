-- Delivery proof may be an authenticated private video as well as a photo.
ALTER TYPE public.evidence_kind ADD VALUE IF NOT EXISTS 'video';
