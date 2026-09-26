# Sets up JjeloTech on Windows, from a fresh checkout, in one go.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1            # set up, demo data, start
#   powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1 -NoStart   # set up only
#   powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1 -NoDemo    # without demo data
#
# Needs Node 20+ and PostgreSQL 16. For the database it uses $env:DATABASE_URL,
# else the one in apps\backend\.env, else a Docker container it starts
# (jjelotech-dev-db, port 5433), else it asks for a connection string.
# Safe to run again.
param([switch]$NoStart, [switch]$NoDemo)
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root 'apps\backend'
$Frontend = Join-Path $Root 'apps\frontend'
$Types = Join-Path $Root 'packages\types'

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "`n$m" -ForegroundColor Red; exit 1 }
function Secret($n) { node -e "console.log(require('crypto').randomBytes($n).toString('base64'))" }
function Run($dir, $cmd) {
  Push-Location $dir
  try { cmd /c $cmd; if ($LASTEXITCODE -ne 0) { Fail "Failed in ${dir}: $cmd" } } finally { Pop-Location }
}

Step 'Checking Node'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node is not installed. Install Node 20 or later from https://nodejs.org and run this again.' }
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) { Fail "Node $(node -v) is too old; install Node 20 or later." }
Write-Host "Node $(node -v)"

Step 'Finding a database'
$envFile = Join-Path $Backend '.env'
$dbUrl = $env:DATABASE_URL
if (-not $dbUrl -and (Test-Path $envFile)) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
  if ($line) { $dbUrl = $line.Substring('DATABASE_URL='.Length) }
}
$dockerOk = $false
if (-not $dbUrl -and (Get-Command docker -ErrorAction SilentlyContinue)) {
  docker info *> $null; $dockerOk = ($LASTEXITCODE -eq 0)
}
if (-not $dbUrl -and $dockerOk) {
  $exists = (docker ps -a --format '{{.Names}}') -contains 'jjelotech-dev-db'
  if ($exists) {
    Write-Host 'Reusing the jjelotech-dev-db container'
    docker start jjelotech-dev-db | Out-Null
    $pw = (docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' jjelotech-dev-db | Where-Object { $_ -match '^POSTGRES_PASSWORD=' }).Substring('POSTGRES_PASSWORD='.Length)
  } else {
    Write-Host 'Starting PostgreSQL 16 in Docker (container jjelotech-dev-db, port 5433)'
    $pw = node -e "console.log(require('crypto').randomBytes(18).toString('hex'))"
    docker run -d --name jjelotech-dev-db -e POSTGRES_USER=jjelotech -e "POSTGRES_PASSWORD=$pw" -e POSTGRES_DB=jjelotech -p 5433:5432 -v jjelotech-dev-db:/var/lib/postgresql/data postgres:16 | Out-Null
  }
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    docker exec jjelotech-dev-db pg_isready -U jjelotech -d jjelotech *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { Fail 'The database container did not become ready.' }
  $dbUrl = "postgresql://jjelotech:$pw@127.0.0.1:5433/jjelotech"
}
if (-not $dbUrl) {
  Write-Host 'No DATABASE_URL and no Docker. Create an empty PostgreSQL 16 database, then enter its connection string,'
  Write-Host 'for example postgresql://user:password@localhost:5432/jjelotech'
  $dbUrl = Read-Host 'DATABASE_URL'
  if (-not $dbUrl) { Fail 'A database is required.' }
}
Write-Host ('Database: ' + ($dbUrl -replace '(//[^:/@]+):[^@]*@', '$1:***@'))

Step 'Writing configuration'
if (-not (Test-Path $envFile)) {
  @(
    'NODE_ENV=development'
    'PORT=5000'
    "DATABASE_URL=$dbUrl"
    "JWT_SECRET=$(Secret 48)"
    'PUBLIC_APP_URL=http://localhost:5173'
    "BIOMETRIC_TEMPLATE_KEY=$(Secret 32)"
    'BIOMETRIC_TEMPLATE_KEY_VERSION=1'
    "MFA_ENCRYPTION_KEY=$(Secret 32)"
  ) | Set-Content -Encoding ascii $envFile
  Write-Host 'Created apps\backend\.env with freshly generated secrets'
} else {
  $content = Get-Content $envFile
  if (-not ($content -match '^DATABASE_URL=')) { Add-Content $envFile "DATABASE_URL=$dbUrl" }
  if (-not ($content -match '^JWT_SECRET=.+')) { Add-Content $envFile "JWT_SECRET=$(Secret 48)" }
  if (-not ($content -match '^BIOMETRIC_TEMPLATE_KEY=.+')) { Add-Content $envFile "BIOMETRIC_TEMPLATE_KEY=$(Secret 32)" }
  if (-not ($content -match '^MFA_ENCRYPTION_KEY=.+')) { Add-Content $envFile "MFA_ENCRYPTION_KEY=$(Secret 32)" }
  Write-Host 'Kept the existing apps\backend\.env'
}
$feEnv = Join-Path $Frontend '.env'
if (-not (Test-Path $feEnv)) {
  'VITE_API_BASE_URL=http://localhost:5000/api' | Set-Content -Encoding ascii $feEnv
  Write-Host 'Created apps\frontend\.env'
}

function Install($dir) {
  if (Test-Path (Join-Path $dir 'package-lock.json')) { Run $dir 'npm ci --no-audit --no-fund' } else { Run $dir 'npm install --no-audit --no-fund' }
}
Step 'Installing the shared types'
Install $Types
Run $Types 'npm run build'
Step 'Installing the API (this includes the face-matching engine and takes a while)'
# A plain `npm ci` fails on Windows: there is no prebuilt TensorFlow binding
# for Windows, and the node-gyp bundled with npm cannot always find the
# installed Visual Studio (see apps\backend\scripts\tfjs-native.mjs). So the
# packages are installed without their install scripts, those scripts are run
# for everything except the TensorFlow binding, and the binding is built by
# tfjs-native.mjs, which also proves it loads. Face matching is optional: if
# the binding cannot be built, setup carries on and says so.
Run $Backend 'npm ci --no-audit --no-fund --ignore-scripts'
Push-Location $Backend
try {
  $withScripts = npm query ":attr(scripts, [preinstall]), :attr(scripts, [install]), :attr(scripts, [postinstall])" | ConvertFrom-Json
} finally { Pop-Location }
$rebuild = $withScripts | Where-Object { $_.location -and $_.name -ne '@tensorflow/tfjs-node' } | ForEach-Object { $_.name } | Sort-Object -Unique
if ($rebuild) { Run $Backend ('npm rebuild ' + ($rebuild -join ' ')) }
Run $Backend 'node scripts\tfjs-native.mjs'
Step 'Installing the web app'
Install $Frontend

Step 'Applying database migrations'
Run $Backend 'npx tsx src/db/migrate.ts'

if (-not $NoDemo) {
  Step 'Loading demo data (two schools, two companies)'
  Run $Backend 'npx tsx src/tests/seedTwoTenants.manual.ts > NUL'
  Run $Backend 'npx tsx src/tests/seedCorporate.manual.ts > NUL'
  Run $Backend 'npx tsx src/tests/seedSuperadmin.manual.ts > NUL'
  Write-Host 'Done. Every demo account''s password is Passw0rd!x'
}

Write-Host @'

Set up. Sign in at http://localhost:5173 with, for example:
  School    (choose "School")     admin.a@e2e.test   fac.a@e2e.test   stu1.a@e2e.test
  Corporate (choose "Corporate")  admin.a@c2e.test   hr.a@c2e.test    emp1.a@c2e.test
  Password for all of them: Passw0rd!x

A superadmin of your own (in apps\backend):
  $env:SUPERADMIN_EMAIL="you@example.com"; $env:SUPERADMIN_NAME="Your Name"; npm run setup-superadmin
  then sign in at http://localhost:5173/login-superadmin
'@

if (-not $NoStart) {
  & (Join-Path $PSScriptRoot 'start-local.ps1')
} else {
  Write-Host "`nStart it with: powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1"
}
