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
  faceMatchingApi
  # These last two create employee and student records that earlier suites'
  # exact headcounts do not expect. The next run's fixtures remove them.
  accountSecurity
  crossTenantAudit
  # Also creates a student (another family's child), so it runs last too.
  guardiansApi
  accessRequestsApi
  # Turns two-factor on and off for one account, and trips its lockout.
  mfaApi
  # Creates grade schools with a principal each, and briefly adds a level
  # to school A.
  schoolTypesApi
  # Creates two grade schools with classes, subjects and children.
  gradeSchoolApi
)

# One line per suite, "<suite> <pass|fail>", for scripts/scorecard to read.
export E2E_RESULTS="${E2E_RESULTS:-$E2E_FIXTURE_DIR/results.tsv}"
: > "$E2E_RESULTS"
record() { printf '%s\t%s\n' "$1" "$2" >> "$E2E_RESULTS"; }

fail=0
for suite in "${SUITES[@]}"; do
  echo "=== $suite ==="
  if python3 "src/tests/${suite}.e2e.py"; then
    record "$suite" pass
  else
    record "$suite" fail
    fail=1
  fi
done

# Its exit status used to vanish into `| tail -1`.
echo "=== tenantIsolation ==="
if npx tsx src/tests/tenantIsolation.manual.ts > "$E2E_FIXTURE_DIR/tenantIsolation.log" 2>&1; then
  record tenantIsolation pass
else
  record tenantIsolation fail
  fail=1
fi
tail -1 "$E2E_FIXTURE_DIR/tenantIsolation.log"

exit $fail
