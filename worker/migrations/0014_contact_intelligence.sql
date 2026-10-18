-- Preserve richer, user-approved contact metadata in the tenant's real customer/supplier records.
-- AI classification suggestions are reviewed in the importer before any record is written.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS organization_name text,
  ADD COLUMN IF NOT EXISTS contact_notes text,
  ADD COLUMN IF NOT EXISTS contact_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS contact_source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS organization_name text,
  ADD COLUMN IF NOT EXISTS contact_notes text,
  ADD COLUMN IF NOT EXISTS contact_tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS contact_source text NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS customers_company_phone_lookup_idx
  ON public.customers(company_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS suppliers_company_phone_lookup_idx
  ON public.suppliers(company_id, phone) WHERE phone IS NOT NULL;

COMMENT ON COLUMN public.customers.contact_source IS
  'Provenance of contact details such as manual, phone_import, or integration.';
COMMENT ON COLUMN public.suppliers.contact_source IS
  'Provenance of contact details such as manual, phone_import, or integration.';
