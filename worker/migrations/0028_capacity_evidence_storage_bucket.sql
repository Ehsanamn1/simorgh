-- Allow private, evidence-backed supplier capacity files in the existing R2 metadata ledger.
-- The actual bytes are stored in the private FILE_STORE binding; metadata remains tenant-scoped in Postgres.
ALTER TABLE public.medar_files
  DROP CONSTRAINT IF EXISTS medar_files_bucket_id_check;

ALTER TABLE public.medar_files
  ADD CONSTRAINT medar_files_bucket_id_check
  CHECK (bucket_id IN ('delivery-evidence','operational-evidence','contract-documents','capacity-evidence'));

COMMENT ON COLUMN public.medar_files.bucket_id IS
  'Private file bucket. capacity-evidence stores supplier capacity proof for manager verification.';
