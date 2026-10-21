#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the source database URL.}"
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to the restored target database URL.}"
command -v psql >/dev/null || { echo "psql is required." >&2; exit 1; }

tables=(
  medar_users
  medar_sessions
  companies
  memberships
  suppliers
  customers
  products
  orders
  order_items
  inventory_movements
  shipments
  operational_tasks
  medar_audit_log
  medar_files
  medar_schema_migrations
)

failed=0
printf '%-36s %14s %14s\n' "table" "source rows" "target rows"
for table in "${tables[@]}"; do
  # Table names come only from the fixed allowlist above; identifiers are not user input.
  source_count="$(psql "$SOURCE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM public.\"$table\"")"
  target_count="$(psql "$TARGET_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM public.\"$table\"")"
  printf '%-36s %14s %14s\n' "$table" "$source_count" "$target_count"
  if [[ "$source_count" != "$target_count" ]]; then
    failed=1
  fi
done

if [[ "$failed" -ne 0 ]]; then
  echo "Row counts differ. Do not switch production traffic; investigate missing or concurrently changing data." >&2
  exit 1
fi
echo "All listed row counts match. This is a useful pre-cutover check, not a substitute for FK, checksum, file-blob, and application workflow validation."
