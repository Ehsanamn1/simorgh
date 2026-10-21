#!/usr/bin/env bash
set -euo pipefail
umask 077

backup_file="${1:-}"
if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
  echo "Usage: TARGET_DATABASE_URL='postgresql://…' bash scripts/restore-postgres.sh /path/to/medar-backup.dump" >&2
  exit 2
fi
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to a separate, empty PostgreSQL database.}"
command -v pg_restore >/dev/null || { echo "pg_restore is required." >&2; exit 1; }
command -v psql >/dev/null || { echo "psql is required." >&2; exit 1; }
pg_restore --list "$backup_file" >/dev/null

checksum_file="$backup_file.sha256"
if [[ -f "$checksum_file" ]]; then
  (cd "$(dirname "$backup_file")" && sha256sum --check "$(basename "$checksum_file")")
fi

# Refuse to write into a non-empty public schema. This script never uses --clean
# and never drops objects; restore only into a fresh, isolated database.
existing_objects="$(psql "$TARGET_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "
  SELECT count(*)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')
")"
if [[ "$existing_objects" != "0" ]]; then
  echo "Refusing restore: target public schema already contains $existing_objects table/view/sequence objects." >&2
  echo "Create a new empty database and retry; production objects are never cleaned by this script." >&2
  exit 1
fi

pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$TARGET_DATABASE_URL" "$backup_file"
ready="$(psql "$TARGET_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "
  SELECT (
    to_regclass('public.medar_users') IS NOT NULL AND
    to_regclass('public.medar_sessions') IS NOT NULL AND
    to_regclass('public.companies') IS NOT NULL AND
    to_regclass('public.memberships') IS NOT NULL AND
    to_regclass('public.medar_schema_migrations') IS NOT NULL
  )
")"
if [[ "$ready" != "t" ]]; then
  echo "Restore finished, but Medar core tables or migration ledger are missing. Keep traffic on the source and investigate the target." >&2
  exit 1
fi
psql "$TARGET_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "
  SELECT 'medar_users=' || count(*) FROM public.medar_users
  UNION ALL SELECT 'companies=' || count(*) FROM public.companies
  UNION ALL SELECT 'memberships=' || count(*) FROM public.memberships
  UNION ALL SELECT 'migration_records=' || count(*) FROM public.medar_schema_migrations
"
printf 'Restore completed into the separate target. The source database was not modified.\n'
printf 'Run scripts/compare-postgres-databases.sh with both URLs and then application acceptance tests before cutover.\n'
