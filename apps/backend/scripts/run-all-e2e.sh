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

# One line per suite, "<suite><TAB><pass|fail>", for scripts/scorecard to read.
# The header ties the results to the code that produced them: the scorecard
# ignores results from any other commit or from a dirty tree. Written first,
# so a run that dies while seeding cannot leave the last run's results behind.
export E2E_RESULTS="${E2E_RESULTS:-$E2E_FIXTURE_DIR/results.tsv}"
tree_dirty=true
[ -z "$(git status --porcelain --untracked-files=no)" ] && tree_dirty=false
printf '# commit=%s dirty=%s started=%s\n' "$(git rev-parse HEAD)" "$tree_dirty" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$E2E_RESULTS"

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
  # Opens, uses and closes a superadmin break-glass grant on school A.
  breakGlass
  # Cookie sessions and CSRF; refresh-token rotation and reuse (waits out
  # the 30-second race window twice).
  csrf
  refreshReuse
  # The device list, remote sign-out and step-up. Ends every superadmin
  # session at the end, so it runs after every suite that uses one.
  sessionManagement
  # The audit hash chain and its verifier (tampers with A's trail and puts it
  # back); export, and streaming to a collector the suite runs.
  auditChain
  auditExport
)

record() { printf '%s\t%s\n' "$1" "$2" >> "$E2E_RESULTS"; }

# In GitHub Actions, a failing suite also becomes an annotation naming its
# first failures: annotations can be read without access to the job's log.
annotate() {
  [ -n "${GITHUB_ACTIONS:-}" ] || return 0
  local lines
  lines=$(grep -E "FAIL|Error|Traceback" "$2" | head -8 | sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')
  echo "::error title=e2e suite $1 failed::${lines:-no FAIL lines; see the log}"
}

fail=0
for suite in "${SUITES[@]}"; do
  echo "=== $suite ==="
  if python3 "src/tests/${suite}.e2e.py" 2>&1 | tee "$E2E_FIXTURE_DIR/${suite}.log"; then
    record "$suite" pass
  else
    record "$suite" fail
    annotate "$suite" "$E2E_FIXTURE_DIR/${suite}.log"
    fail=1
  fi
done

# Suites that drive the data layer directly rather than over HTTP.
# tenantIsolation: the tenant-scoped helpers. rlsNoContext and blindWrite:
# row-level security as the runtime role (APP_DATABASE_URL); they fail,
# rather than pass vacuously, when no runtime role is configured.
TS_SUITES=(
  tenantIsolation
  rlsNoContext
  blindWrite
  # Accounts and credentials under RLS (migrations 074 and 075).
  identityIsolation
  # Passkeys, with a software authenticator.
  webauthn
  # Single sign-on through an OpenID Connect provider the suite runs.
  sso
  # The manual fallback on both platforms: reasons, approval, abuse alerts.
  manualFallback
  # Face matching across tenants: HTTP, a copied template, the runtime role.
  biometricCrossTenant
  # The face worker killed and restarted: the API falls back to manual.
  faceWorkerDown
  # Inside one tenant: every role-guarded route in docs/api/permission-map.json
  # as every caller it leaves out, same-tenant IDOR cases, self-promotion.
  privilegeEscalation
  # Every route with a path parameter, as tenant A, with each of tenant B's
  # ids. Needs RATE_LIMIT_API_PER_MINUTE raised: it is ~20,000 requests.
  crossTenantFuzz
)

# Their exit status used to vanish into `| tail -1`.
for suite in "${TS_SUITES[@]}"; do
  echo "=== $suite ==="
  if npx tsx "src/tests/${suite}.manual.ts" > "$E2E_FIXTURE_DIR/${suite}.log" 2>&1; then
    record "$suite" pass
  else
    record "$suite" fail
    grep -E "FAIL|Error" "$E2E_FIXTURE_DIR/${suite}.log" | head -20
    annotate "$suite" "$E2E_FIXTURE_DIR/${suite}.log"
    fail=1
  fi
  tail -1 "$E2E_FIXTURE_DIR/${suite}.log"
done

exit $fail
