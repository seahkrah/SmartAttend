#!/usr/bin/env bash

# TIME AUTHORITY TESTING SCRIPT
# Comprehensive testing of PHASE 2, STEP 2.2 implementation

echo "==============================================="
echo "PHASE 2, STEP 2.2 - TIME AUTHORITY TESTING"
echo "==============================================="

BASE_URL="http://localhost:3000"
CURRENT_TIME=$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')
OLD_TIME="2026-01-01T00:00:00Z"

echo ""
echo "1. Testing GET /api/time/sync (Public endpoint)"
echo "   Expected: 200 OK with timestamp"
curl -s -X GET "$BASE_URL/api/time/sync" | jq '.'
echo ""

echo "2. Testing GET /api/time/sync/precise (Public endpoint)"
echo "   Expected: 200 OK with request and response times"
curl -s -X GET "$BASE_URL/api/time/sync/precise" | jq '.'
echo ""

echo "3. Testing GET /api/time/validate (Public endpoint)"
echo "   Testing with current time: $CURRENT_TIME"
curl -s -X GET "$BASE_URL/api/time/validate?clientTimestamp=$CURRENT_TIME" | jq '.'
echo ""

echo "4. Testing GET /api/time/validate with old time"
echo "   Testing with old time: $OLD_TIME"
curl -s -X GET "$BASE_URL/api/time/validate?clientTimestamp=$OLD_TIME" | jq '.'
echo ""

echo "5. Testing middleware: Checking drift detection"
echo "   Sending request with X-Client-Timestamp header"
curl -s -X POST "$BASE_URL/api/time/sync" \
  -H "X-Client-Timestamp: $CURRENT_TIME" \
  -H "Content-Type: application/json" | jq '.'
echo ""

echo "6. Database verification: Check clock_drift_log table"
echo "   Expected: Records should exist if drift detection is working"
echo "   Run this query:"
echo "   SELECT COUNT(*) as drift_events FROM clock_drift_log;"
echo ""

echo "==============================================="
echo "TESTING COMPLETE"
echo "==============================================="
echo ""
echo "Summary:"
echo "- Public endpoints should return 200"
echo "- Current time should validate as 'isValid: true'"
echo "- Old time should validate as 'isValid: false'"
echo "- Drift events should be logged to clock_drift_log table"
echo ""
