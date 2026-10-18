-- Tenant-scoped conversations and messages for internal teams and authorized external partners.
CREATE TABLE IF NOT EXISTS public.medar_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 180),
  related_entity_type text CHECK (related_entity_type IS NULL OR related_entity_type IN ('order','purchase_order','task','shipment','invoice','exception','other')),
  related_entity_id uuid,
  created_by uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE RESTRICT,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,id)
);
CREATE INDEX IF NOT EXISTS medar_conversations_company_updated_idx
  ON public.medar_conversations(company_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS public.medar_conversation_participants (
  company_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE CASCADE,
  participant_role text NOT NULL DEFAULT 'member' CHECK (participant_role IN ('owner','member')),
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  muted_at timestamptz,
  PRIMARY KEY(company_id,conversation_id,user_id),
  FOREIGN KEY(company_id,conversation_id) REFERENCES public.medar_conversations(company_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS medar_conversation_participants_user_idx
  ON public.medar_conversation_participants(company_id,user_id,joined_at DESC);

CREATE TABLE IF NOT EXISTS public.medar_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  sender_user_id uuid NOT NULL REFERENCES public.medar_users(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 8000),
  client_message_id text CHECK (client_message_id IS NULL OR length(client_message_id) BETWEEN 8 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  UNIQUE(company_id,id),
  FOREIGN KEY(company_id,conversation_id) REFERENCES public.medar_conversations(company_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS medar_messages_idempotency_uq
  ON public.medar_messages(company_id,conversation_id,sender_user_id,client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS medar_messages_conversation_recent_idx
  ON public.medar_messages(company_id,conversation_id,created_at DESC);

COMMENT ON TABLE public.medar_conversations IS
  'Private tenant-scoped conversation threads optionally linked to an operational record.';
COMMENT ON TABLE public.medar_conversation_participants IS
  'Explicit participant allowlist; company membership alone does not grant access to every conversation.';
COMMENT ON TABLE public.medar_messages IS
  'Tenant-scoped messages with optional client-generated idempotency key for safe retries.';
