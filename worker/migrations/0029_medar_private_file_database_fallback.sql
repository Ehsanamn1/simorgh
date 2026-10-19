-- Private evidence storage fallback for Cloudflare accounts where R2 has not been enabled.
-- Files remain protected by the same company, role, module and resource checks as R2-backed files.
ALTER TABLE public.medar_files
  ADD COLUMN IF NOT EXISTS content_base64 text;

ALTER TABLE public.medar_files
  DROP CONSTRAINT IF EXISTS medar_files_content_base64_size_check;

ALTER TABLE public.medar_files
  ADD CONSTRAINT medar_files_content_base64_size_check
  CHECK (content_base64 IS NULL OR length(content_base64) <= 15000000);

COMMENT ON COLUMN public.medar_files.content_base64 IS
  'Optional private-file bytes encoded as base64 when the Cloudflare FILE_STORE binding is unavailable; access is mediated by authenticated Worker routes.';
