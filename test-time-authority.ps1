# TIME AUTHORITY TESTING SCRIPT (PowerShell)
# Comprehensive testing of PHASE 2, STEP 2.2 implementation

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "PHASE 2, STEP 2.2 - TIME AUTHORITY TESTING" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

$BASE_URL = "http://localhost:3000"
$CURRENT_TIME = Get-Date -AsUTC -Format 'yyyy-MM-ddTHH:mm:ss.000Z'
$OLD_TIME = "2026-01-01T00:00:00Z"

Write-Host ""
Write-Host "1. Testing GET /api/time/sync (Public endpoint)" -ForegroundColor Green
Write-Host "   Expected: 200 OK with timestamp"
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/time/sync" -Method Get
    $response | ConvertTo-Json
    Write-Host "   ✓ Status: 200 OK" -ForegroundColor Green
} catch {
    Write-Host "   ✗ Error: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "2. Testing GET /api/time/sync/precise (Public endpoint)" -ForegroundColor Green
Write-Host "   Expected: 200 OK with request and response times"
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/time/sync/precise" -Method Get
    $response | ConvertTo-Json
    Write-Host "   ✓ Status: 200 OK" -ForegroundColor Green
} catch {
    Write-Host "   ✗ Error: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "3. Testing GET /api/time/validate with current time" -ForegroundColor Green
Write-Host "   Testing with current time: $CURRENT_TIME"
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/time/validate?clientTimestamp=$CURRENT_TIME" -Method Get
    $response | ConvertTo-Json
    if ($response.isValid) {
        Write-Host "   ✓ Validation: PASSED" -ForegroundColor Green
    } else {
        Write-Host "   ✗ Validation: FAILED - should be valid" -ForegroundColor Red
    }
} catch {
    Write-Host "   ✗ Error: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "4. Testing GET /api/time/validate with old time" -ForegroundColor Green
Write-Host "   Testing with old time: $OLD_TIME"
try {
    $response = Invoke-RestMethod -Uri "$BASE_URL/api/time/validate?clientTimestamp=$OLD_TIME" -Method Get
    $response | ConvertTo-Json
    if (-not $response.isValid) {
        Write-Host "   ✓ Validation: PASSED (correctly rejected)" -ForegroundColor Green
    } else {
        Write-Host "   ✗ Validation: FAILED - should be invalid" -ForegroundColor Red
    }
} catch {
    Write-Host "   ✗ Error: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "5. Testing drift detection headers" -ForegroundColor Green
Write-Host "   Sending request with X-Client-Timestamp header"
try {
    $headers = @{
        'X-Client-Timestamp' = $CURRENT_TIME
        'Content-Type' = 'application/json'
    }
    $response = Invoke-WebRequest -Uri "$BASE_URL/api/time/sync" -Method Get -Headers $headers
    Write-Host "   Response Headers:" -ForegroundColor Green
    $response.Headers.GetEnumerator() | Where-Object {$_.Key -like 'X-*'} | ForEach-Object {
        Write-Host "     $($_.Key): $($_.Value)"
    }
} catch {
    Write-Host "   Note: Some headers may not be visible with default request. Check server logs." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "TESTING COMPLETE" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan

Write-Host ""
Write-Host "Summary:" -ForegroundColor White
Write-Host "✓ Public endpoints should return 200" -ForegroundColor Green
Write-Host "✓ Current time should validate as isValid=true" -ForegroundColor Green
Write-Host "✓ Old time should validate as isValid=false" -ForegroundColor Green
Write-Host "✓ Drift events should be logged to clock_drift_log table" -ForegroundColor Green

Write-Host ""
Write-Host "Next: Check database for drift events"
Write-Host "  SELECT COUNT(*) as drift_events FROM clock_drift_log;" -ForegroundColor Yellow
