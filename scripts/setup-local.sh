#!/usr/bin/env bash
# Sets up JjeloTech on your own machine, from a fresh checkout, in one go:
#
#   scripts/setup-local.sh            # set up, load demo data, then start it
#   scripts/setup-local.sh --no-start # set up only; start later with scripts/start-local.sh
#   scripts/setup-local.sh --no-demo  # without the demo schools and companies
#
# It needs Node 20+ and a PostgreSQL 16 database. For the database it uses,
# in this order:
#   1. DATABASE_URL, if you set it;
#   2. the one already in apps/backend/.env, from an earlier run;
#   3. a PostgreSQL container it starts with Docker (named jjelotech-dev-db,
#      on port 5433), if Docker is installed;
#   4. otherwise it asks you for a connection string.
#
# Safe to run again: it keeps your existing .env files and applies only
# migrations that have not run yet. The demo data is re-created each time.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/apps/backend"
FRONTEND="$ROOT/apps/frontend"
START=1
DEMO=1
for arg in "$@"; do
  case "$arg" in
    --no-start) START=0 ;;
    --no-demo) DEMO=0 ;;
    *) echo "Unknown option: $arg"; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }
secret() { node -e "console.log(require('crypto').randomBytes($1).toString('base64'))"; }

step "Checking Node"
command -v node >/dev/null || fail "Node is not installed. Install Node 20 or later from https://nodejs.org and run this again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node $(node -v) is too old; install Node 20 or later."
echo "Node $(node -v)"

step "Finding a database"
existing_url=""
if [ -f "$BACKEND/.env" ]; then
  existing_url="$(grep -E '^DATABASE_URL=' "$BACKEND/.env" | head -1 | cut -d= -f2- || true)"
fi
DB_URL="${DATABASE_URL:-$existing_url}"

if [ -z "$DB_URL" ] && command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  if docker ps -a --format '{{.Names}}' | grep -qx jjelotech-dev-db; then
    echo "Reusing the jjelotech-dev-db container"
    docker start jjelotech-dev-db >/dev/null
    pw="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' jjelotech-dev-db | grep '^POSTGRES_PASSWORD=' | cut -d= -f2-)"
  else
    echo "Starting PostgreSQL 16 in Docker (container jjelotech-dev-db, port 5433)"
    pw="$(node -e "console.log(require('crypto').randomBytes(18).toString('hex'))")"
    docker run -d --name jjelotech-dev-db -e POSTGRES_USER=jjelotech -e POSTGRES_PASSWORD="$pw" \
      -e POSTGRES_DB=jjelotech -p 5433:5432 -v jjelotech-dev-db:/var/lib/postgresql/data postgres:16 >/dev/null
  fi
  for _ in $(seq 1 60); do
    docker exec jjelotech-dev-db pg_isready -U jjelotech -d jjelotech >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec jjelotech-dev-db pg_isready -U jjelotech -d jjelotech >/dev/null 2>&1 || fail "The database container did not become ready."
  DB_URL="postgresql://jjelotech:$pw@127.0.0.1:5433/jjelotech"
fi

if [ -z "$DB_URL" ]; then
  echo "No DATABASE_URL and no Docker. Create an empty PostgreSQL 16 database, then enter its connection string,"
  echo "for example postgresql://user:password@localhost:5432/jjelotech"
  read -r -p "DATABASE_URL: " DB_URL
  [ -n "$DB_URL" ] || fail "A database is required."
fi
echo "Database: $(echo "$DB_URL" | sed -E 's#(//[^:/@]+):[^@]*@#\1:***@#')"

step "Writing configuration"
if [ ! -f "$BACKEND/.env" ]; then
  cat > "$BACKEND/.env" <<EOF
NODE_ENV=development
PORT=5000
DATABASE_URL=$DB_URL
JWT_SECRET=$(secret 48)
PUBLIC_APP_URL=http://localhost:5173
BIOMETRIC_TEMPLATE_KEY=$(secret 32)
BIOMETRIC_TEMPLATE_KEY_VERSION=1
EOF
  echo "Created apps/backend/.env with freshly generated secrets"
else
  if ! grep -qE '^DATABASE_URL=' "$BACKEND/.env"; then echo "DATABASE_URL=$DB_URL" >> "$BACKEND/.env"; fi
  grep -qE '^JWT_SECRET=.+' "$BACKEND/.env" || echo "JWT_SECRET=$(secret 48)" >> "$BACKEND/.env"
  grep -qE '^BIOMETRIC_TEMPLATE_KEY=.+' "$BACKEND/.env" || echo "BIOMETRIC_TEMPLATE_KEY=$(secret 32)" >> "$BACKEND/.env"
  echo "Kept the existing apps/backend/.env"
fi
if [ ! -f "$FRONTEND/.env" ]; then
  echo "VITE_API_BASE_URL=http://localhost:5000/api" > "$FRONTEND/.env"
  echo "Created apps/frontend/.env"
fi

install() {
  if [ -f "$1/package-lock.json" ]; then (cd "$1" && npm ci --no-audit --no-fund); else (cd "$1" && npm install --no-audit --no-fund); fi
}
step "Installing the shared types"
install "$ROOT/packages/types"
(cd "$ROOT/packages/types" && npm run build)
step "Installing the API (this includes the face-matching engine and takes a while)"
install "$BACKEND"
step "Installing the web app"
install "$FRONTEND"

step "Applying database migrations"
(cd "$BACKEND" && npx tsx src/db/migrate.ts)

if [ "$DEMO" = 1 ]; then
  step "Loading demo data (two schools, two companies)"
  (cd "$BACKEND" && npx tsx src/tests/seedTwoTenants.manual.ts >/dev/null \
                && npx tsx src/tests/seedCorporate.manual.ts >/dev/null \
                && npx tsx src/tests/seedSuperadmin.manual.ts >/dev/null)
  echo "Done. Every demo account's password is Passw0rd!x"
fi

cat <<'EOF'

Set up. Sign in at http://localhost:5173 with, for example:
  School    (choose "School")     admin.a@e2e.test   fac.a@e2e.test   stu1.a@e2e.test
  Corporate (choose "Corporate")  admin.a@c2e.test   hr.a@c2e.test    emp1.a@c2e.test
  Password for all of them: Passw0rd!x

A superadmin of your own:
  cd apps/backend && SUPERADMIN_EMAIL=you@example.com SUPERADMIN_NAME="Your Name" npm run setup-superadmin
  then sign in at http://localhost:5173/login-superadmin
EOF

if [ "$START" = 1 ]; then
  exec "$ROOT/scripts/start-local.sh"
else
  echo; echo "Start it with: scripts/start-local.sh"
fi
