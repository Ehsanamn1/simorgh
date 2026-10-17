-- AI provider credentials are encrypted by the Worker before storage. Never store plaintext provider API keys.
CREATE TABLE IF NOT EXISTS public.medar_ai_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai','gemini','deepseek','anthropic')),
  model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 120),
  encrypted_api_key text NOT NULL CHECK (char_length(encrypted_api_key) BETWEEN 32 AND 4096),
  is_default boolean NOT NULL DEFAULT false,
  updated_by uuid NOT NULL REFERENCES public.medar_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider)
);
CREATE UNIQUE INDEX IF NOT EXISTS medar_ai_provider_one_default_per_company
  ON public.medar_ai_provider_configs(company_id) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS medar_ai_provider_configs_company_idx
  ON public.medar_ai_provider_configs(company_id, is_default);

CREATE TABLE IF NOT EXISTS public.medar_ai_usage_log (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai','gemini','deepseek','anthropic')),
  model text NOT NULL,
  input_chars integer NOT NULL DEFAULT 0 CHECK (input_chars BETWEEN 0 AND 50000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS medar_ai_usage_log_company_created_idx
  ON public.medar_ai_usage_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS medar_ai_usage_log_user_created_idx
  ON public.medar_ai_usage_log(user_id, created_at DESC);

COMMENT ON TABLE public.medar_ai_provider_configs IS
  'Company-scoped AI providers; API keys are AES-GCM encrypted by the Worker and never returned to clients.';
COMMENT ON TABLE public.medar_ai_usage_log IS
  'Minimal usage ledger for per-user AI rate limits; does not store prompts, responses, or API keys.';
