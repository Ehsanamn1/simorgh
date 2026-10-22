-- Medar foundation schema for MySQL 8.0.13+.
-- Converted from PostgreSQL migration 0001_foundation.sql.
-- This is an additive staging migration. It is NOT the complete 31-migration MySQL port.
-- Apply only to a dedicated staging database until all remaining migrations and API queries are ported.
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS medar_users (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  username VARCHAR(32) NOT NULL,
  username_normalized VARCHAR(32) NOT NULL,
  phone_e164 VARCHAR(40) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  password_hash TEXT NOT NULL,
  requested_role VARCHAR(16) NOT NULL DEFAULT 'customer',
  account_status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3) NULL,
  CONSTRAINT medar_users_username_chk CHECK (CHAR_LENGTH(TRIM(username)) BETWEEN 3 AND 32),
  CONSTRAINT medar_users_username_normalized_chk CHECK (CHAR_LENGTH(username_normalized) BETWEEN 3 AND 32),
  CONSTRAINT medar_users_display_name_chk CHECK (CHAR_LENGTH(TRIM(display_name)) BETWEEN 2 AND 160),
  CONSTRAINT medar_users_requested_role_chk CHECK (requested_role IN ('owner','customer','supplier','driver','staff')),
  CONSTRAINT medar_users_account_status_chk CHECK (account_status IN ('active','locked','disabled')),
  UNIQUE KEY medar_users_username_unique (username_normalized),
  UNIQUE KEY medar_users_phone_unique (phone_e164)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_sessions (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  user_agent VARCHAR(512) NULL,
  ip_hash VARCHAR(128) NULL,
  CONSTRAINT medar_sessions_token_hash_chk CHECK (CHAR_LENGTH(token_hash) = 64),
  CONSTRAINT medar_sessions_user_fk FOREIGN KEY (user_id) REFERENCES medar_users(id) ON DELETE CASCADE,
  UNIQUE KEY medar_sessions_token_unique (token_hash),
  KEY medar_sessions_user_active (user_id, revoked_at, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_login_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username_normalized VARCHAR(32) NOT NULL,
  attempted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  succeeded BOOLEAN NOT NULL DEFAULT FALSE,
  ip_hash VARCHAR(128) NULL,
  KEY medar_login_attempts_recent (username_normalized, attempted_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_rate_limits (
  key_hash CHAR(64) NOT NULL PRIMARY KEY,
  window_started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  attempts INT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT medar_rate_limits_key_hash_chk CHECK (CHAR_LENGTH(key_hash) = 64),
  CONSTRAINT medar_rate_limits_attempts_chk CHECK (attempts >= 0),
  KEY medar_rate_limits_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medar_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id CHAR(36) NULL,
  action VARCHAR(160) NOT NULL,
  entity_type VARCHAR(120) NOT NULL,
  entity_id VARCHAR(160) NULL,
  metadata JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT medar_audit_log_actor_fk FOREIGN KEY (actor_user_id) REFERENCES medar_users(id) ON DELETE SET NULL,
  KEY medar_audit_log_created_at (created_at DESC),
  KEY medar_audit_log_entity (entity_type, entity_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS companies (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  legal_name VARCHAR(240) NULL,
  province VARCHAR(120) NOT NULL DEFAULT 'نامشخص',
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Tehran',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT companies_name_chk CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 2 AND 160),
  UNIQUE KEY companies_id_name_unique (id, name),
  KEY medar_companies_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS profiles (
  id CHAR(36) NOT NULL PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(60) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT profiles_user_fk FOREIGN KEY (id) REFERENCES medar_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS memberships (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role VARCHAR(16) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_by CHAR(36) NULL,
  active_owner_company_id CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN active = TRUE AND role = 'owner' THEN company_id ELSE NULL END
  ) STORED,
  CONSTRAINT memberships_role_chk CHECK (role IN ('owner','admin','staff','customer','supplier','driver')),
  UNIQUE KEY memberships_company_user_role_unique (company_id, user_id, role),
  UNIQUE KEY memberships_one_active_owner_per_company_idx (active_owner_company_id),
  KEY medar_memberships_user_active (user_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_company_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE memberships
  ADD CONSTRAINT memberships_user_fk FOREIGN KEY (user_id) REFERENCES medar_users(id) ON DELETE CASCADE;
ALTER TABLE memberships
  ADD CONSTRAINT memberships_created_by_fk FOREIGN KEY (created_by) REFERENCES medar_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS access_requests (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  company_id CHAR(36) NULL,
  user_id CHAR(36) NOT NULL,
  requested_role VARCHAR(16) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  organization_name VARCHAR(240) NULL,
  phone VARCHAR(60) NULL,
  notes TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  pending_company_id CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN status = 'pending' THEN company_id ELSE NULL END
  ) STORED,
  CONSTRAINT access_requests_role_chk CHECK (requested_role IN ('customer','supplier','driver','staff')),
  CONSTRAINT access_requests_name_chk CHECK (CHAR_LENGTH(TRIM(full_name)) BETWEEN 2 AND 160),
  CONSTRAINT access_requests_status_chk CHECK (status IN ('pending','approved','rejected')),
  CONSTRAINT access_requests_company_fk FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT access_requests_user_fk FOREIGN KEY (user_id) REFERENCES medar_users(id) ON DELETE CASCADE,
  CONSTRAINT access_requests_reviewer_fk FOREIGN KEY (reviewed_by) REFERENCES medar_users(id) ON DELETE SET NULL,
  UNIQUE KEY access_requests_one_pending_per_user_company_idx (pending_company_id, user_id),
  KEY access_requests_company_status_created_idx (company_id, status, created_at DESC),
  KEY access_requests_user_status_idx (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
