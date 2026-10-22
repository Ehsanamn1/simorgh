-- Forward-only fix for PostgreSQL migration 0017: private delivery proof supports video.
-- Find and drop the legacy inline CHECK by its actual MySQL-generated name. This is
-- restart-safe if a previous attempt stopped after the DROP but before the ADD.
SET @medar_drop_delivery_kind_check = COALESCE((
  SELECT CONCAT('ALTER TABLE `delivery_evidence` DROP CHECK `', tc.CONSTRAINT_NAME, '`')
  FROM information_schema.TABLE_CONSTRAINTS tc
  JOIN information_schema.CHECK_CONSTRAINTS cc
    ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
   AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
  WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
    AND tc.TABLE_NAME = 'delivery_evidence'
    AND tc.CONSTRAINT_TYPE = 'CHECK'
    AND cc.CHECK_CLAUSE LIKE '%photo%'
    AND cc.CHECK_CLAUSE LIKE '%temperature_reading%'
  ORDER BY tc.CONSTRAINT_NAME
  LIMIT 1
), 'SELECT 1');
PREPARE medar_drop_delivery_kind_stmt FROM @medar_drop_delivery_kind_check;
EXECUTE medar_drop_delivery_kind_stmt;
DEALLOCATE PREPARE medar_drop_delivery_kind_stmt;

ALTER TABLE delivery_evidence
  ADD CONSTRAINT delivery_evidence_kind_check
  CHECK (kind IN ('photo','video','signature','note','temperature_reading'));
