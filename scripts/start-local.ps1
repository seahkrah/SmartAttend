# Starts the API (http://localhost:5000) and the web app (http://localhost:5173)
# in two new windows. Close a window to stop that part. Run setup-local.ps1 first.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root 'apps\backend\.env'))) {
  Write-Host 'Run scripts\setup-local.ps1 first.' -ForegroundColor Red; exit 1
}
if (Get-Command docker -ErrorAction SilentlyContinue) {
  if ((docker ps -a --format '{{.Names}}' 2>$null) -contains 'jjelotech-dev-db') { docker start jjelotech-dev-db | Out-Null }
}
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$Root\apps\backend'; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$Root\apps\frontend'; npm run dev -- --port 5173 --strictPort"
Write-Host ''
Write-Host '  API:     http://localhost:5000/api/health'
Write-Host '  Web app: http://localhost:5173   (give it a few seconds to start)'
Write-Host ''
