#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the source database URL.}"
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to the restored target database URL.}"
command -v psql >/dev/null || { echo "psql is required." >&2; exit 1; }

source_tables="$(psql "$SOURCE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")"
target_tables="$(psql "$TARGET_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")"
if [[ "$source_tables" != "$target_tables" ]]; then
  echo "The source and target public table lists differ; do not cut over." >&2
  diff -u <(printf '%s\n' "$source_tables") <(printf '%s\n' "$target_tables") || true
  exit 1
fi
[[ -n "$source_tables" ]] || { echo "The source public schema contains no tables." >&2; exit 1; }

failed=0
checked=0
printf '%-48s %14s %14s\n' "table" "source rows" "target rows"
while IFS= read -r table; do
  [[ -n "$table" ]] || continue
  # Table names come from pg_tables, and are quoted as SQL identifiers before use.
  safe_table="${table//\"/\"\"}"
  source_count="$(psql "$SOURCE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM public.\"$safe_table\"")"
  target_count="$(psql "$TARGET_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM public.\"$safe_table\"")"
  printf '%-48s %14s %14s\n' "$table" "$source_count" "$target_count"
  checked=$((checked + 1))
  if [[ "$source_count" != "$target_count" ]]; then
    failed=1
  fi
done <<< "$source_tables"

if [[ "$failed" -ne 0 ]]; then
  echo "Row counts differ in one or more public tables. Do not switch production traffic." >&2
  exit 1
fi
echo "All $checked public table row counts match. This is a pre-cutover integrity gate, not a substitute for schema/FK validation, per-table data checksums, file-blob verification, or application workflow acceptance."
