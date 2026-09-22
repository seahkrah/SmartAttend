#!/bin/bash
# Reseed then exercise the admin API. Idempotent.
set -e
cd /home/user/SmartAttend/apps/backend
export DATABASE_URL="postgresql://jjelo@127.0.0.1:55432/jjelotech_dev"
SP=/tmp/claude-0/-home-user-SmartAttend/d93ac8ad-306e-535c-92c4-36bf785b1524/scratchpad
npx tsx src/tests/seedTwoTenants.manual.ts 2>/dev/null | grep -E '^\{' > $SP/seed.json
python3 $SP/adminE2E.py
