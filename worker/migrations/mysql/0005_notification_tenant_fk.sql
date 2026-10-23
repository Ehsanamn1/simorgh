-- Enforce tenant ownership on outbox-to-notification references.
-- The previous single-column FK allowed an outbox row for company B to point at a
-- notification owned by company A. Replace it with a composite company-scoped FK.
-- Dynamic DROP is restart-safe if a deployment was interrupted after dropping the
-- old constraint but before adding the composite constraint.
SET @medar_drop_outbox_notification_fk = COALESCE((
  SELECT CONCAT('ALTER TABLE `medar_notification_outbox` DROP FOREIGN KEY `', CONSTRAINT_NAME, '`')
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'medar_notification_outbox'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    AND CONSTRAINT_NAME = 'fk_medar_notification_outbox_notification_id'
  LIMIT 1
), 'SELECT 1');
PREPARE medar_drop_outbox_notification_stmt FROM @medar_drop_outbox_notification_fk;
EXECUTE medar_drop_outbox_notification_stmt;
DEALLOCATE PREPARE medar_drop_outbox_notification_stmt;

ALTER TABLE medar_notification_outbox
  ADD CONSTRAINT fk_medar_notification_outbox_company_notification
  FOREIGN KEY (company_id, notification_id)
  REFERENCES notifications(company_id, id)
  ON DELETE RESTRICT;
