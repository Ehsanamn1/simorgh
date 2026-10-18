-- Read-only bank statement ingestion and auditable manual reconciliation.
-- This does not store banking credentials and does not initiate payments.
CREATE TABLE IF NOT EXISTS public.medar_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 2 AND 120),
  bank_name text NOT NULL DEFAULT '' CHECK (length(bank_name) <= 120),
  masked_account text NOT NULL DEFAULT '' CHECK (length(masked_account) <= 40),
  currency char(3) NOT NULL DEFAULT 'IRR' CHECK (currency ~ '^[A-Z]{3}$'),
  provider text NOT NULL DEFAULT 'manual_csv' CHECK (provider IN ('manual_csv','open_finance')),
  connection_status text NOT NULL DEFAULT 'manual_import' CHECK (connection_status IN ('manual_import','pending_authorization','connected','disconnected','error')),
  external_account_id text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE RESTRICT,
  last_imported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id),
  UNIQUE(company_id,provider,external_account_id)
);
CREATE INDEX IF NOT EXISTS medar_bank_accounts_company_idx
  ON public.medar_bank_accounts(company_id,active,created_at DESC);

CREATE TABLE IF NOT EXISTS public.medar_bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL,
  external_transaction_id text NOT NULL CHECK (length(external_transaction_id) BETWEEN 8 AND 240),
  booked_at timestamptz NOT NULL,
  amount numeric(20,2) NOT NULL CHECK (amount <> 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1500),
  counterparty text NOT NULL DEFAULT '' CHECK (length(counterparty) <= 300),
  reference text NOT NULL DEFAULT '' CHECK (length(reference) <= 240),
  direction text NOT NULL CHECK (direction IN ('incoming','outgoing')),
  reconciliation_status text NOT NULL DEFAULT 'unmatched' CHECK (reconciliation_status IN ('unmatched','suggested','reconciled','ignored')),
  matched_entity_type text CHECK (matched_entity_type IS NULL OR matched_entity_type IN ('invoice','purchase_order','settlement','partner_financial_entry')),
  matched_entity_id uuid,
  matched_by uuid REFERENCES public.medar_users(id) ON DELETE SET NULL,
  matched_at timestamptz,
  imported_by uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE RESTRICT,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id),
  UNIQUE(company_id,bank_account_id,external_transaction_id),
  FOREIGN KEY(company_id,bank_account_id) REFERENCES public.medar_bank_accounts(company_id,id) ON DELETE CASCADE,
  CHECK ((direction='incoming' AND amount>0) OR (direction='outgoing' AND amount<0)),
  CHECK ((reconciliation_status='reconciled') = (matched_entity_type IS NOT NULL AND matched_entity_id IS NOT NULL AND matched_by IS NOT NULL AND matched_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS medar_bank_transactions_company_account_date_idx
  ON public.medar_bank_transactions(company_id,bank_account_id,booked_at DESC);
CREATE INDEX IF NOT EXISTS medar_bank_transactions_unmatched_idx
  ON public.medar_bank_transactions(company_id,reconciliation_status,booked_at DESC);

COMMENT ON TABLE public.medar_bank_accounts IS
  'Company-scoped bank account metadata. This ledger does not contain banking credentials; provider status must reflect a verified integration.';
COMMENT ON TABLE public.medar_bank_transactions IS
  'Duplicate-safe bank statement import ledger. Reconciliation links are audited and do not auto-post invoices or payments.';
