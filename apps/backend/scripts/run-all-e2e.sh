#!/bin/bash
# Reseed both platforms, then run every API suite. Idempotent.
#
# The seeds used to run with stderr discarded, so a failing fixture looked
# like an empty suite list and `set -e` killed the script with no explanation.
# They are loud now.
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://jjelo@127.0.0.1:55432/jjelotech_dev}"
export API_BASE="${API_BASE:-http://127.0.0.1:5000}"

# Where the seed fixtures are written. Overridable so CI, a fresh clone and a
# local sandbox all work without editing the suites.
export E2E_FIXTURE_DIR="${E2E_FIXTURE_DIR:-$(pwd)/.e2e-fixtures}"
mkdir -p "$E2E_FIXTURE_DIR"

seed() {
  local script="$1" out="$2"
  local log="$E2E_FIXTURE_DIR/${2%.json}.log"
  if ! npx tsx "src/tests/${script}" > "$log" 2>&1; then
    echo "FIXTURE FAILED: ${script}" >&2
    tail -30 "$log" >&2
    exit 1
  fi
  grep -E '^\{' "$log" > "$E2E_FIXTURE_DIR/${out}"
}

seed seedTwoTenants.manual.ts seed.json
seed seedCorporate.manual.ts corp.json
seed seedSuperadmin.manual.ts superadmin.json

SUITES=(
  adminApi
  hrApi
  attendanceApi
  facultyApi
  legacyRoutesIsolation
  schoolAdminApi
  sessionAttendanceApi
  auditApi
  correctionsFaceApi
  opsRoutesIsolation
  authFlow
  academicsGradebook
  leaveApi
  payrollApi
  workforceApi
  checkinApi
  admissionsApi
  feesApi
  notificationsApi
  controlPlaneApi
  filesApi
)

fail=0
for suite in "${SUITES[@]}"; do
  echo "=== $suite ==="
  python3 "src/tests/${suite}.e2e.py" || fail=1
done

echo "=== tenantIsolation ==="
npx tsx src/tests/tenantIsolation.manual.ts | tail -1

exit $fail
