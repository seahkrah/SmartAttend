#!/usr/bin/env bash
# Backs up the compose stack: the database (pg_dump, custom format) and the
# uploaded files. Writes to BACKUP_DIR (default ./backups) as
#   jjelotech-<UTC timestamp>.dump and jjelotech-<UTC timestamp>.files.tar.gz
# and prints the dump's path.
#
#   deploy/backup.sh                      # uses deploy/.env
#   ENV_FILE=/path/to/.env deploy/backup.sh
#
# A backup is not a backup until a restore has been tested:
# run deploy/verify-restore.sh on it (it does not touch the live database).
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="${ENV_FILE:-.env}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
compose() { docker compose -f docker-compose.yml --env-file "$ENV_FILE" "$@"; }

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$BACKUP_DIR/jjelotech-$stamp.dump"
files="$BACKUP_DIR/jjelotech-$stamp.files.tar.gz"

# -Fc: compressed, restorable table by table. Written to a temporary name
# first so a failed dump never looks like a finished one.
compose exec -T db pg_dump -U jjelotech -d jjelotech -Fc --no-owner > "$dump.partial"
mv "$dump.partial" "$dump"

compose exec -T api tar -C /data/files -czf - . > "$files.partial"
mv "$files.partial" "$files"

# Keep the newest KEEP backups (default 14).
KEEP="${KEEP:-14}"
ls -1t "$BACKUP_DIR"/jjelotech-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old" "${old%.dump}.files.tar.gz"
done

echo "$dump"
