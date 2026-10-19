-- Evidence-backed supplier capacity declarations and explicit review state.
ALTER TABLE public.capacity_commitments ADD COLUMN IF NOT EXISTS evidence_path text;
ALTER TABLE public.capacity_commitments ADD COLUMN IF NOT EXISTS evidence_name text;
ALTER TABLE public.capacity_commitments ADD COLUMN IF NOT EXISTS evidence_mime_type text;
ALTER TABLE public.capacity_commitments ADD COLUMN IF NOT EXISTS evidence_uploaded_at timestamptz;
ALTER TABLE public.capacity_commitments ADD COLUMN IF NOT EXISTS evidence_review_status text NOT NULL DEFAULT 'missing';
ALTER TABLE public.capacity_commitments ADD COLUMN IF NOT EXISTS evidence_reviewed_by uuid;
ALTER TABLE public.capacity_commitments ADD COLUMN IF NOT EXISTS evidence_reviewed_at timestamptz;
ALTER TABLE public.capacity_commitments ADD COLUMN IF NOT EXISTS evidence_review_note text;

DO $$ BEGIN
  ALTER TABLE public.capacity_commitments ADD CONSTRAINT capacity_commitments_evidence_review_status_check
    CHECK (evidence_review_status IN ('missing','pending_review','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS capacity_commitments_evidence_review_idx
  ON public.capacity_commitments(company_id, evidence_review_status, period_end DESC);

COMMENT ON COLUMN public.capacity_commitments.evidence_path IS
  'Private object-storage path for supplier-provided proof of the declared capacity; approval is performed by an authorized manager.';
