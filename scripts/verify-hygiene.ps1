# Hygiene Enforcement Verification Script
$PASS = 0
$FAIL = 0

Write-Host "Hygiene Enforcement Verification" -ForegroundColor Cyan
Write-Host ""

# Test 1: .gitignore exists
if (Test-Path ".gitignore") {
  Write-Host "[OK] .gitignore exists" -ForegroundColor Green
  $PASS++
} else {
  Write-Host "[FAIL] .gitignore not found" -ForegroundColor Red
  $FAIL++
}

# Test 2: Pre-commit hook exists
if (Test-Path ".git/hooks/pre-commit.ps1") {
  Write-Host "[OK] Pre-commit hook exists" -ForegroundColor Green
  $PASS++
} else {
  Write-Host "[FAIL] Pre-commit hook not found" -ForegroundColor Red
  $FAIL++
}

# Test 3: Git attributes
if (Test-Path ".gitattributes") {
  Write-Host "[OK] .gitattributes exists" -ForegroundColor Green
  $PASS++
} else {
  Write-Host "[FAIL] .gitattributes not found" -ForegroundColor Red
  $FAIL++
}

# Test 4: Commit message template
if (Test-Path ".gitmessage") {
  Write-Host "[OK] .gitmessage template exists" -ForegroundColor Green
  $PASS++
} else {
  Write-Host "[FAIL] .gitmessage template not found" -ForegroundColor Red
  $FAIL++
}

# Test 5: Hygiene rules documentation
if (Test-Path "HYGIENE_RULES.md") {
  Write-Host "[OK] HYGIENE_RULES.md exists" -ForegroundColor Green
  $PASS++
} else {
  Write-Host "[FAIL] HYGIENE_RULES.md not found" -ForegroundColor Red
  $FAIL++
}

# Test 6: No runtime artifacts tracked
$trackedArtifacts = @(git ls-files 2>&1) | Where-Object { $_ -match '(node_modules|\.venv|\.log|dist|build)' }
if ($trackedArtifacts.Count -eq 0) {
  Write-Host "[OK] No runtime artifacts tracked" -ForegroundColor Green
  $PASS++
} else {
  Write-Host "[FAIL] Found tracked artifacts:" -ForegroundColor Red
  $FAIL++
}

# Summary
Write-Host ""
Write-Host "Result: Passed $PASS / Failed $FAIL" -ForegroundColor Cyan
