-- Extended Medar MySQL schema converted from PostgreSQL migrations 0007, 0010, 0012, 0013 and 0015.
-- Database tables only: PostgreSQL RPCs, triggers and RLS policies still require application-layer ports.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS company_invites (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  role VARCHAR(16) NOT NULL check (role in ('admin','staff','customer','supplier','driver')),
  token_hash CHAR(64) not null unique check (char_length(token_hash) = 64),
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  expires_at DATETIME(3) not null,
  max_uses integer not null default 1 check (max_uses between 1 and 500),
  uses integer not null default 0 check (uses >= 0),
  revoked_at DATETIME(3),
  customer_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  constraint company_invites_customer_scope_check check (
    (role = 'customer' and customer_id is not null and supplier_id is null)
    or (role = 'supplier' and supplier_id is not null and customer_id is null)
    or (role not in ('customer','supplier') and customer_id is null and supplier_id is null)
  ),
  constraint company_invites_company_customer_fk
    foreign key (company_id, customer_id) references customers(company_id, id) on delete cascade,
  constraint company_invites_company_supplier_fk
    foreign key (company_id, supplier_id) references suppliers(company_id, id) on delete cascade,
  CONSTRAINT fk_company_invites_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_company_invites_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_files (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  bucket_id VARCHAR(32) not null check (bucket_id in ('delivery-evidence','operational-evidence','contract-documents','capacity-evidence')),
  name VARCHAR(1000) NOT NULL,
  name_hash BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(name, 256))) STORED,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  content_type VARCHAR(255) not null,
  size_bytes bigint not null check (size_bytes between 0 and 20971520),
  uploaded_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  content_base64 MEDIUMTEXT NULL,
  UNIQUE KEY medar_files_bucket_name_hash_unique (bucket_id, name_hash),
  constraint medar_files_company_path_check check (
    char_length(name) between 40 and 1000 and SUBSTRING_INDEX(name, '/', 1) = company_id
  ),
  CHECK (content_base64 IS NULL OR CHAR_LENGTH(content_base64) <= 15000000),
  CONSTRAINT fk_medar_files_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_files_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  supplier_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reference VARCHAR(80) NOT NULL CHECK (length(trim(reference)) BETWEEN 3 AND 80),
  status VARCHAR(32) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','partially_received','received','cancelled')),
  expected_delivery date,
  notes VARCHAR(2000) NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  approved_at DATETIME(3),
  received_at DATETIME(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE(company_id,id),
  UNIQUE(company_id,reference),
  FOREIGN KEY(company_id,supplier_id) REFERENCES suppliers(company_id,id) ON DELETE RESTRICT,
  CHECK ((status NOT IN ('approved','partially_received','received')) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK ((status <> 'received') OR received_at IS NOT NULL),
  CONSTRAINT fk_purchase_orders_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_purchase_orders_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_orders_approved_by FOREIGN KEY (approved_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purchase_order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ordered_quantity numeric(14,3) NOT NULL CHECK (ordered_quantity > 0),
  received_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  unit_cost numeric(16,2) NOT NULL CHECK (unit_cost >= 0),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE(company_id,id),
  UNIQUE(company_id,purchase_order_id,product_id),
  FOREIGN KEY(company_id,purchase_order_id) REFERENCES purchase_orders(company_id,id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id) ON DELETE RESTRICT
  ,CHECK (received_quantity <= ordered_quantity),
  CONSTRAINT fk_purchase_order_items_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_client_presence (
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  client_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform VARCHAR(16) NOT NULL CHECK (platform IN ('web', 'android', 'ios')),
  app_version VARCHAR(40) NOT NULL DEFAULT '0.1.0' CHECK (char_length(app_version) BETWEEN 1 AND 40),
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (company_id, user_id, client_id),
  CONSTRAINT fk_medar_client_presence_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_client_presence_user_id FOREIGN KEY (user_id) REFERENCES medar_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_ai_provider_configs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider VARCHAR(24) NOT NULL CHECK (provider IN ('openai','gemini','deepseek','anthropic')),
  model VARCHAR(120) NOT NULL CHECK (char_length(model) BETWEEN 1 AND 120),
  encrypted_api_key VARCHAR(4096) NOT NULL CHECK (char_length(encrypted_api_key) BETWEEN 32 AND 4096),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  default_flag TINYINT GENERATED ALWAYS AS (CASE WHEN is_default = TRUE THEN 1 ELSE NULL END) STORED,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (company_id, provider),
  UNIQUE KEY medar_ai_provider_one_default_per_company (company_id, default_flag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE medar_ai_provider_configs
  ADD CONSTRAINT fk_medar_ai_provider_configs_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE medar_ai_provider_configs
  ADD CONSTRAINT fk_medar_ai_provider_configs_updated_by FOREIGN KEY (updated_by) REFERENCES medar_users(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS medar_ai_usage_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider VARCHAR(24) NOT NULL CHECK (provider IN ('openai','gemini','deepseek','anthropic')),
  model VARCHAR(120) NOT NULL,
  input_chars integer NOT NULL DEFAULT 0 CHECK (input_chars BETWEEN 0 AND 50000),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_medar_ai_usage_log_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_ai_usage_log_user_id FOREIGN KEY (user_id) REFERENCES medar_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_ai_action_runs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tool_key VARCHAR(80) NOT NULL CHECK (tool_key IN ('create_operational_task')),
  status VARCHAR(24) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','executed','cancelled','failed')),
  arguments JSON NOT NULL CHECK (JSON_TYPE(arguments) = 'OBJECT'),
  result JSON,
  executed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  executed_at DATETIME(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CHECK (status <> 'executed' OR (result IS NOT NULL AND executed_by IS NOT NULL AND executed_at IS NOT NULL)),
  CONSTRAINT fk_medar_ai_action_runs_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_ai_action_runs_requested_by FOREIGN KEY (requested_by) REFERENCES medar_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_ai_action_runs_executed_by FOREIGN KEY (executed_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_membership_module_permissions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  module_key VARCHAR(80) NOT NULL CHECK (module_key IN (
    'home','command','agents','bank-reconciliation','orders','purchase-orders','customers','suppliers','contacts',
    'products','inventory','capacity','quality','shipments','finance','members','audit','catalog',
    'my-orders','my-account','supplier-work','supplier-capacity','supplier-settlement','driver-work',
    'farm-sites','flock-cycles','production-batches','daily-production','task-templates',
    'operational-tasks','incidents','partnership-agreements','partner-finance','partner-settlements',
    'contacts-import','goals'
  )),
  inherit_role_defaults boolean NOT NULL DEFAULT true,
  can_read boolean NOT NULL DEFAULT true,
  can_create boolean NOT NULL DEFAULT true,
  can_update boolean NOT NULL DEFAULT true,
  can_delete boolean NOT NULL DEFAULT false,
  can_approve boolean NOT NULL DEFAULT false,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (company_id, membership_id, module_key)
  ,FOREIGN KEY (company_id,membership_id) REFERENCES memberships(company_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_membership_module_permissions_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_membership_module_permissions_updated_by FOREIGN KEY (updated_by) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_bank_accounts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  label VARCHAR(120) NOT NULL CHECK (length(trim(label)) BETWEEN 2 AND 120),
  bank_name VARCHAR(120) NOT NULL DEFAULT '' CHECK (length(bank_name) <= 120),
  masked_account VARCHAR(40) NOT NULL DEFAULT '' CHECK (length(masked_account) <= 40),
  currency char(3) NOT NULL DEFAULT 'IRR' CHECK (currency REGEXP '^[A-Z]{3}$'),
  provider VARCHAR(32) NOT NULL DEFAULT 'manual_csv' CHECK (provider IN ('manual_csv','open_finance')),
  connection_status VARCHAR(32) NOT NULL DEFAULT 'manual_import' CHECK (connection_status IN ('manual_import','pending_authorization','connected','disconnected','error')),
  external_account_id VARCHAR(190),
  active boolean NOT NULL DEFAULT true,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  last_imported_at DATETIME(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE(company_id,id),
  UNIQUE(company_id,provider,external_account_id),
  CONSTRAINT fk_medar_bank_accounts_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_bank_accounts_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_bank_transactions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bank_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  external_transaction_id VARCHAR(240) NOT NULL CHECK (length(external_transaction_id) BETWEEN 8 AND 240),
  booked_at DATETIME(3) NOT NULL,
  amount numeric(20,2) NOT NULL CHECK (amount <> 0),
  currency char(3) NOT NULL CHECK (currency REGEXP '^[A-Z]{3}$'),
  description VARCHAR(1500) NOT NULL DEFAULT '' CHECK (length(description) <= 1500),
  counterparty VARCHAR(300) NOT NULL DEFAULT '' CHECK (length(counterparty) <= 300),
  reference VARCHAR(240) NOT NULL DEFAULT '' CHECK (length(reference) <= 240),
  direction VARCHAR(16) NOT NULL CHECK (direction IN ('incoming','outgoing')),
  reconciliation_status VARCHAR(24) NOT NULL DEFAULT 'unmatched' CHECK (reconciliation_status IN ('unmatched','suggested','reconciled','ignored')),
  matched_entity_type VARCHAR(32) CHECK (matched_entity_type IS NULL OR matched_entity_type IN ('invoice','purchase_order','settlement','partner_financial_entry')),
  matched_entity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  matched_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  matched_at DATETIME(3),
  imported_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  imported_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE(company_id,id),
  UNIQUE(company_id,bank_account_id,external_transaction_id),
  FOREIGN KEY(company_id,bank_account_id) REFERENCES medar_bank_accounts(company_id,id) ON DELETE CASCADE,
  CHECK ((direction='incoming' AND amount>0) OR (direction='outgoing' AND amount<0)),
  CHECK ((reconciliation_status='reconciled') = (matched_entity_type IS NOT NULL AND matched_entity_id IS NOT NULL AND matched_by IS NOT NULL AND matched_at IS NOT NULL)),
  CONSTRAINT fk_medar_bank_transactions_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_bank_transactions_matched_by FOREIGN KEY (matched_by) REFERENCES medar_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_medar_bank_transactions_imported_by FOREIGN KEY (imported_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_operational_events (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  event_type VARCHAR(80) NOT NULL CHECK (event_type REGEXP '^[a-z][a-z0-9_.-]{1,79}$'),
  severity VARCHAR(16) NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  source_type VARCHAR(32) NOT NULL CHECK (source_type IN ('order','purchase_order','task','shipment','invoice','inventory','production','quality','supplier','system','other')),
  source_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  title VARCHAR(180) NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  body VARCHAR(4000) NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  payload JSON NOT NULL DEFAULT (JSON_OBJECT()) CHECK (JSON_TYPE(payload) = 'OBJECT'),
  idempotency_key VARCHAR(240) CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 8 AND 240),
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (company_id,id),
  UNIQUE KEY medar_operational_events_idempotency_uq (company_id,idempotency_key),
  CONSTRAINT fk_medar_operational_events_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_operational_events_actor_user_id FOREIGN KEY (actor_user_id) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_exception_cases (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  title VARCHAR(180) NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  details VARCHAR(4000) NOT NULL DEFAULT '' CHECK (length(details) <= 4000),
  severity VARCHAR(16) NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning','critical')),
  status VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','in_progress','resolved','closed')),
  assigned_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  due_at DATETIME(3),
  acknowledged_at DATETIME(3),
  resolved_at DATETIME(3),
  resolved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  resolution_note VARCHAR(2000) CHECK (resolution_note IS NULL OR length(resolution_note) <= 2000),
  dedupe_key VARCHAR(240) CHECK (dedupe_key IS NULL OR length(dedupe_key) BETWEEN 8 AND 240),
  active_dedupe_key VARCHAR(240) GENERATED ALWAYS AS (CASE WHEN dedupe_key IS NOT NULL AND status NOT IN ('resolved','closed') THEN dedupe_key ELSE NULL END) STORED,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (company_id,id),
  UNIQUE KEY medar_exception_cases_dedupe_uq (company_id,active_dedupe_key),
  FOREIGN KEY (company_id,event_id) REFERENCES medar_operational_events(company_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_medar_exception_cases_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_exception_cases_assigned_user_id FOREIGN KEY (assigned_user_id) REFERENCES medar_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_medar_exception_cases_resolved_by FOREIGN KEY (resolved_by) REFERENCES medar_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_medar_exception_cases_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_conversations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(180) NOT NULL DEFAULT '' CHECK (length(title) <= 180),
  related_entity_type VARCHAR(32) CHECK (related_entity_type IS NULL OR related_entity_type IN ('order','purchase_order','task','shipment','invoice','exception','other')),
  related_entity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  archived_at DATETIME(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE(company_id,id),
  CONSTRAINT fk_medar_conversations_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_conversations_created_by FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_conversation_participants (
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_role VARCHAR(16) NOT NULL DEFAULT 'member' CHECK (participant_role IN ('owner','member')),
  last_read_at DATETIME(3),
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  muted_at DATETIME(3),
  PRIMARY KEY(company_id,conversation_id,user_id),
  FOREIGN KEY(company_id,conversation_id) REFERENCES medar_conversations(company_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_conversation_participants_user_id FOREIGN KEY (user_id) REFERENCES medar_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_messages (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  body VARCHAR(8000) NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 8000),
  client_message_id VARCHAR(120) CHECK (client_message_id IS NULL OR length(client_message_id) BETWEEN 8 AND 120),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  edited_at DATETIME(3),
  deleted_at DATETIME(3),
  UNIQUE (company_id,id),
  UNIQUE KEY medar_messages_idempotency_uq (company_id,conversation_id,sender_user_id,client_message_id),
  FOREIGN KEY(company_id,conversation_id) REFERENCES medar_conversations(company_id,id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_messages_sender_user_id FOREIGN KEY (sender_user_id) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_push_subscriptions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  endpoint VARCHAR(2048) NOT NULL CHECK (length(endpoint) BETWEEN 20 AND 2048),
  endpoint_hash CHAR(64) NOT NULL CHECK (endpoint_hash REGEXP '^[a-f0-9]{64}$'),
  p256dh_key VARCHAR(160) NOT NULL CHECK (length(p256dh_key) BETWEEN 80 AND 160),
  auth_secret VARCHAR(64) NOT NULL CHECK (length(auth_secret) BETWEEN 16 AND 64),
  expiration_time DATETIME(3),
  user_agent VARCHAR(500) NOT NULL DEFAULT '' CHECK (length(user_agent) <= 500),
  active boolean NOT NULL DEFAULT true,
  last_success_at DATETIME(3),
  last_failure_at DATETIME(3),
  last_error VARCHAR(500) CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE(endpoint_hash),
  UNIQUE(company_id,id),
  CONSTRAINT fk_medar_push_subscriptions_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_push_subscriptions_user_id FOREIGN KEY (user_id) REFERENCES medar_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_notification_outbox (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notification_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  channel VARCHAR(16) NOT NULL DEFAULT 'push' CHECK (channel IN ('push')),
  payload JSON NOT NULL CHECK (JSON_TYPE(payload) = 'OBJECT'),
  idempotency_key VARCHAR(240) NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 240),
  status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','sent','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_error VARCHAR(500) CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at DATETIME(3),
  UNIQUE(company_id,user_id,channel,idempotency_key),
  CONSTRAINT fk_medar_notification_outbox_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_notification_outbox_user_id FOREIGN KEY (user_id) REFERENCES medar_users(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id,notification_id) REFERENCES notifications(company_id,id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
