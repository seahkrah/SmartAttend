#!/usr/bin/env pwsh
# Database cleanup and migration reset script for SmartAttend

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Blue
Write-Host "  SmartAttend Database Cleanup Tool" -ForegroundColor Blue
Write-Host "========================================" -ForegroundColor Blue
Write-Host ""

# Find .env file
$BackendDir = Get-Location
$EnvFile = $null

if (Test-Path "$BackendDir\.env") {
  $EnvFile = "$BackendDir\.env"
} elseif (Test-Path "$BackendDir\..\.env") {
  $EnvFile = "$BackendDir\..\.env"
} elseif (Test-Path "$BackendDir\..\..\.env") {
  $EnvFile = "$BackendDir\..\..\.env"
}

if (-not $EnvFile) {
  Write-Host "Error: Could not find .env file" -ForegroundColor Red
  exit 1
}

Write-Host "Loading environment from: $EnvFile" -ForegroundColor Yellow

# Parse .env for DATABASE_URL
$EnvContent = Get-Content $EnvFile -Raw
$DatabaseUrlMatch = [regex]::Match($EnvContent, 'DATABASE_URL=([^\r\n]+)')

if (-not $DatabaseUrlMatch.Success) {
  Write-Host "Error: DATABASE_URL not found in .env" -ForegroundColor Red
  exit 1
}

$DatabaseUrl = $DatabaseUrlMatch.Groups[1].Value.Trim()
Write-Host "Database URL found" -ForegroundColor Green
Write-Host ""

# Confirmation
Write-Host "This will DELETE the following migrations:" -ForegroundColor Yellow
Write-Host "  - 001_init_schema.sql"
Write-Host "  - 004_superadmin_system.sql"
Write-Host ""
Write-Host "These will be re-executed when the backend starts." -ForegroundColor Yellow
Write-Host ""

$Response = Read-Host "Continue with cleanup? (yes/no)"
if ($Response -ne "yes") {
  Write-Host "Cleanup cancelled" -ForegroundColor Red
  exit 0
}

Write-Host ""
Write-Host "Executing migration cleanup..." -ForegroundColor Blue
Write-Host ""

# Create Node.js cleanup script
$CleanupScript = @'
const pg = require('pg');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function cleanup() {
  try {
    await client.connect();
    console.log('[OK] Connected to database');
    
    // Remove failed migrations
    await client.query('DELETE FROM migrations WHERE name = $1', ['001_init_schema.sql']);
    console.log('[REMOVED] 001_init_schema.sql');
    
    await client.query('DELETE FROM migrations WHERE name = $1', ['004_superadmin_system.sql']);
    console.log('[REMOVED] 004_superadmin_system.sql');
    
    // Display remaining migrations
    const result = await client.query('SELECT name, executed_at FROM migrations ORDER BY executed_at');
    console.log('');
    console.log('Remaining migrations:');
    if (result.rows.length === 0) {
      console.log('  (none)');
    } else {
      result.rows.forEach(row => {
        console.log('  - ' + row.name + ' (' + row.executed_at + ')');
      });
    }
    
    console.log('');
    console.log('[SUCCESS] Database cleanup completed');
    process.exit(0);
  } catch (error) {
    console.error('[ERROR] Cleanup failed: ' + error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

cleanup();
'@

# Write temp script
$TempScript = [System.IO.Path]::Combine($env:TEMP, "cleanup-$([guid]::NewGuid()).js")
Set-Content -Path $TempScript -Value $CleanupScript

# Execute cleanup
try {
  $env:DATABASE_URL = $DatabaseUrl
  $env:NODE_ENV = "development"
  
  if (-not (Test-Path "$BackendDir\node_modules")) {
    Write-Host "Error: node_modules not found" -ForegroundColor Red
    Write-Host "Please run 'npm install' first" -ForegroundColor Yellow
    Remove-Item $TempScript -ErrorAction SilentlyContinue
    exit 1
  }
  
  node $TempScript
  $ExitCode = $LASTEXITCODE
} finally {
  Remove-Item $TempScript -ErrorAction SilentlyContinue
}

Write-Host ""

if ($ExitCode -eq 0) {
  Write-Host "========================================" -ForegroundColor Green
  Write-Host "  Cleanup completed successfully!" -ForegroundColor Green
  Write-Host "========================================" -ForegroundColor Green
  Write-Host ""
  Write-Host "Next steps:" -ForegroundColor Yellow
  Write-Host "  1. cd apps/backend"
  Write-Host "  2. npm run dev"
  Write-Host "  3. Migrations will re-execute automatically"
  Write-Host ""
  exit 0
} else {
  Write-Host "Cleanup failed" -ForegroundColor Red
  exit 1
}
