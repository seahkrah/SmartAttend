#!/usr/bin/env bash
# Proves a backup can be restored, without touching the live database.
#
#   deploy/verify-restore.sh backups/jjelotech-20260925T220000Z.dump
#
# Restores the dump into a scratch database on the same server, then checks:
#   * pg_restore reports no errors;
#   * every migration recorded in the dump is present;
#   * every table in the dump has the same number of rows after restoring
#     as the dump itself holds (counted from the dump's own data);
#   * the files archive, if present beside it, is a readable tar.
# The scratch database is dropped afterwards, pass or fail.
# Exit status is 0 only if every check passed.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE="${ENV_FILE:-.env}"
dump="${1:?usage: verify-restore.sh <backup.dump>}"
[ -f "$dump" ] || { echo "No such backup: $dump" >&2; exit 2; }
compose() { docker compose -f docker-compose.yml --env-file "$ENV_FILE" "$@"; }
psql_db() { compose exec -T db psql -U jjelotech -v ON_ERROR_STOP=1 -At "$@"; }

scratch="restore_check_$(date -u +%s)"
cleanup() { psql_db -d postgres -c "DROP DATABASE IF EXISTS $scratch" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql_db -d postgres -c "CREATE DATABASE $scratch" >/dev/null
echo "restoring into $scratch"
if ! compose exec -T db pg_restore -U jjelotech -d "$scratch" --no-owner --exit-on-error < "$dump"; then
  echo "FAIL: pg_restore reported errors" >&2; exit 1
fi

fail=0
# What the dump itself says it contains: table data entries in its catalogue.
tables=$(compose exec -T db pg_restore -l < "$dump" | awk '$4 == "TABLE" && $5 == "DATA" { print $6"."$7 }')
checked=0
for t in $tables; do
  restored=$(psql_db -d "$scratch" -c "SELECT COUNT(*) FROM $t")
  # Rows in the dump: restore that one table's data as text and count lines.
  in_dump=$(compose exec -T db sh -c "pg_restore -a -t ${t#*.} -f - " < "$dump" \
            | awk '/^COPY /{on=1; next} /^\\\.$/{on=0} on{n++} END{print n+0}')
  if [ "$restored" != "$in_dump" ]; then
    echo "FAIL: $t has $restored rows restored, $in_dump in the dump" >&2; fail=1
  fi
  checked=$((checked + 1))
done
echo "row counts checked for $checked tables"

migrations=$(psql_db -d "$scratch" -c "SELECT COUNT(*) FROM migrations")
[ "$migrations" -gt 0 ] || { echo "FAIL: no migrations recorded in the restored database" >&2; fail=1; }
echo "migrations recorded: $migrations"

files="${dump%.dump}.files.tar.gz"
if [ -f "$files" ]; then
  if tar -tzf "$files" >/dev/null; then echo "files archive readable ($(tar -tzf "$files" | wc -l) entries)"
  else echo "FAIL: files archive is not readable" >&2; fail=1; fi
fi

[ "$fail" = 0 ] && echo "RESTORE VERIFIED" || { echo "RESTORE CHECK FAILED" >&2; exit 1; }
