#!/bin/bash
# Reseed both platforms, then run every API suite. Idempotent.
set -e
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgresql://jjelo@127.0.0.1:55432/jjelotech_dev}"
SP=/tmp/claude-0/-home-user-SmartAttend/d93ac8ad-306e-535c-92c4-36bf785b1524/scratchpad
mkdir -p "$SP"
npx tsx src/tests/seedTwoTenants.manual.ts 2>/dev/null | grep -E '^\{' > "$SP/seed.json"
npx tsx src/tests/seedCorporate.manual.ts 2>/dev/null | grep -E '^\{' > "$SP/corp.json"
fail=0
for suite in adminApi hrApi attendanceApi facultyApi legacyRoutesIsolation schoolAdminApi sessionAttendanceApi auditApi correctionsFaceApi; do
  echo "=== $suite ==="
  python3 "src/tests/${suite}.e2e.py" || fail=1
done
npx tsx src/tests/tenantIsolation.manual.ts | tail -1
exit $fail
