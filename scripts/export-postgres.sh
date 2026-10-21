#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the source PostgreSQL/Neon connection URL.}"
output_dir="${1:-backups/medar}"
mkdir -p "$output_dir"
chmod 700 "$output_dir"
command -v pg_dump >/dev/null || { echo "pg_dump is required." >&2; exit 1; }
command -v pg_restore >/dev/null || { echo "pg_restore is required." >&2; exit 1; }

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$output_dir/medar-postgres-$stamp-$$.dump"
tmp_file="$(mktemp "$output_dir/.medar-export.XXXXXX")"
trap 'rm -f "$tmp_file"' EXIT

# Do not print the connection URL; it contains a database credential.
pg_dump --format=custom --no-owner --no-privileges --compress=6 --file="$tmp_file" "$SOURCE_DATABASE_URL"
pg_restore --list "$tmp_file" >/dev/null
mv "$tmp_file" "$backup_file"
chmod 600 "$backup_file"
(
  cd "$output_dir"
  sha256sum "$(basename "$backup_file")" > "$(basename "$backup_file").sha256"
)
chmod 600 "$backup_file.sha256"
trap - EXIT
printf 'Backup created: %s\n' "$backup_file"
printf 'Checksum created: %s.sha256\n' "$backup_file"
printf 'Keep both files private and test restoration into a separate empty database before changing production traffic.\n'
