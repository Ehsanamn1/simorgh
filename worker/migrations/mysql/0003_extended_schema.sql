-- Extended Medar MySQL schema converted from PostgreSQL migrations 0007, 0010, 0012, 0013 and 0015.
-- Database tables only: PostgreSQL RPCs, triggers and RLS policies still require application-layer ports.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS company_invites (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin primary key DEFAULT (UUID()),
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
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin primary key DEFAULT (UUID()),
  bucket_id VARCHAR(32) not null check (bucket_id in ('delivery-evidence','operational-evidence','contract-documents','capacity-evidence')),
  name VARCHAR(1000) NOT NULL,
  name_hash BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(name, 256))) STORED,
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin not null,
  content_type VARCHAR(255) not null,
  size_bytes bigint not null check (size_bytes between 0 and 20971520),
  uploaded_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,
  created_at DATETIME(3) not null DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY medar_files_bucket_name_hash_unique (bucket_id, name_hash),
  content_base64 TEXT NULL,
  constraint medar_files_company_path_check check (
    char_length(name) between 40 and 1000 and SUBSTRING_INDEX(name, '/', 1) = company_id
  ),
  CHECK (content_base64 IS NULL OR CHAR_LENGTH(content_base64) <= 15000000),
  CONSTRAINT fk_medar_files_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_files_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES medar_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY DEFAULT (UUID()),
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
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY DEFAULT (UUID()),
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
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY DEFAULT (UUID()),
  company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider VARCHAR(24) NOT NULL CHECK (provider IN ('openai','gemini','deepseek','anthropic')),
  model VARCHAR(120) NOT NULL CHECK (char_length(model) BETWEEN 1 AND 120),
  encrypted_api_key VARCHAR(4096) NOT NULL CHECK (char_length(encrypted_api_key) BETWEEN 32 AND 4096),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  default_company_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN is_default = TRUE THEN company_id ELSE NULL END) STORED,
  updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE (company_id, provider)
  ,UNIQUE KEY medar_ai_provider_one_default_per_company (default_company_id),
  CONSTRAINT fk_medar_ai_provider_configs_company_id FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_medar_ai_provider_configs_updated_by FOREIGN KEY (updated_by) REFERENCES medar_users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY DEFAULT (UUID()),
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
