# Quick Reference: Environment Separation at a Glance

## Configuration Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                   SMARTATTEND ENVIRONMENTS                       │
└─────────────────────────────────────────────────────────────────┘

DEVELOPMENT
├─ NODE_ENV: development
├─ Database: localhost:5432/smartattend_dev
├─ Backend API: http://localhost:3000
├─ Frontend: http://localhost:5173
├─ Security: MFA OFF, IP Allowlist OFF
├─ Logging: DEBUG
└─ Use: Local development with hot reload

STAGING
├─ NODE_ENV: staging
├─ Database: staging-db.example.com:5432/smartattend_staging
├─ Backend API: https://staging-api.example.com
├─ Frontend: https://staging.example.com
├─ Security: MFA ON, IP Allowlist ON
├─ Logging: INFO
└─ Use: QA testing, integration tests, pre-production

PRODUCTION
├─ NODE_ENV: production
├─ Database: prod-db.example.com:5432/smartattend_prod
├─ Backend API: https://api.example.com
├─ Frontend: https://app.example.com
├─ Security: MFA ON, IP Allowlist ON
├─ Logging: WARN
└─ Use: Live user-facing system
```

## Secret Isolation Matrix

```
┌──────────────────────────────────────────────────────────────┐
│               ENVIRONMENT SECRET ISOLATION                   │
└──────────────────────────────────────────────────────────────┘

Secret              │ Development      │ Staging          │ Production
─────────────────────┼──────────────────┼──────────────────┼──────────────
JWT_SECRET          │ dev-secret-...   │ staging-unique   │ prod-unique
DATABASE_URL        │ localhost:5432   │ staging-db:5432  │ prod-db:5432
DATABASE_PASSWORD   │ local-default    │ staging-pwd      │ prod-pwd
MFA_AUTH_TOKEN      │ DISABLED         │ provider-staging │ provider-prod
API_KEY             │ dev-key          │ staging-key      │ prod-key

GUARANTEE: A secret that works in one environment
          CANNOT be used in another environment
```

## File Source of Truth

```
┌──────────────────────────────────────────────────────────────┐
│            WHERE EACH ENVIRONMENT GETS CONFIG                │
└──────────────────────────────────────────────────────────────┘

DEVELOPMENT (Local Machine)
├─ Source: .env.local (NOT in git)
├─ Override: .env.development (reference only)
├─ Template: .env.example
└─ Git: Do not commit

STAGING (AWS/Cloud Deployment)
├─ Source: Deployment platform environment variables
├─ Reference: .env.staging (in git, safe)
├─ Example: .env.example
└─ Git: Safe to commit, no secrets

PRODUCTION (AWS/Cloud Deployment)
├─ Source: Deployment platform secrets manager
├─ Reference: .env.production (in git, safe)
├─ Example: .env.example
└─ Git: Safe to commit, no secrets
```

## Setup Quick Start

### Local Development (5 minutes)

```bash
# 1. Copy template
cp .env.example .env.local

# 2. Edit for your machine
nano .env.local
  NODE_ENV=development
  BACKEND_PORT=3000
  DATABASE_URL=postgresql://localhost:5432/smartattend_dev
  JWT_SECRET=dev-secret-key-unsafe
  VITE_API_BASE_URL=http://localhost:3000/api

# 3. Start PostgreSQL locally
docker run -d --name smartattend-dev-db \
  -e POSTGRES_DB=smartattend_dev \
  -p 5432:5432 \
  postgres:latest

# 4. Run backend
cd apps/backend
npm run dev

# 5. Run frontend (new terminal)
cd apps/frontend
npm run dev

# ✅ Open http://localhost:5173
```

### Staging Deployment

```bash
# Set on deployment platform (AWS ECS, Heroku, Railway, etc.)
NODE_ENV=staging
DATABASE_URL=postgresql://user:pass@staging-db:5432/smartattend_staging
JWT_SECRET=<unique-staging-secret>
VITE_API_BASE_URL=https://staging-api.example.com
SUPERADMIN_MFA_ENABLED=true
SUPERADMIN_IP_ALLOWLIST_ENABLED=true

# Deploy
git push origin main
# CI/CD builds with VITE_API_BASE_URL automatically injected
```

### Production Deployment

```bash
# Set on deployment platform secrets manager
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@prod-db:5432/smartattend_prod
JWT_SECRET=<unique-production-secret>
VITE_API_BASE_URL=https://api.example.com
SUPERADMIN_MFA_ENABLED=true
SUPERADMIN_IP_ALLOWLIST_ENABLED=true

# Deploy
git push origin main
# CI/CD builds with VITE_API_BASE_URL automatically injected
```

## Configuration Validation

```
┌────────────────────────────────────────────────────────────┐
│       STARTUP CONFIGURATION VALIDATION CHECKLIST           │
└────────────────────────────────────────────────────────────┘

BACKEND (apps/backend/src/config/environment.ts)
✓ NODE_ENV is one of: development, staging, production
✓ BACKEND_PORT is valid number
✓ DATABASE_URL has postgresql:// format
✓ JWT_SECRET is set (required, no default in prod)
✓ SESSION_TIMEOUT_MS is valid number

PRODUCTION ONLY:
✓ JWT_SECRET is NOT default dev secret
✓ VITE_API_BASE_URL is NOT localhost URL

FRONTEND (apps/frontend/src/config/environment.ts)
✓ VITE_API_BASE_URL is set
✓ VITE_API_BASE_URL has http:// or https://

If any check fails → Application startup aborted with clear error
```

## Git Hygiene Quick Check

```bash
# Verify no secrets committed
git ls-files | grep -E "^\.env$|^\.env\.(local|secret|private)" 
# Should return: nothing

# Verify safe reference files are tracked
git ls-files | grep -E "^\.env\.(example|development|staging|production)$"
# Should return:
# .env.example
# .env.development
# .env.staging
# .env.production

# Verify no runtime artifacts
git ls-files | grep -E "node_modules/|\.venv/|\.log$|dist/|build/"
# Should return: nothing
```

## Environment Variable Reference

| Variable | Dev | Staging | Production | Required | Type |
|----------|-----|---------|------------|----------|------|
| NODE_ENV | development | staging | production | ✓ | enum |
| BACKEND_PORT | 3000 | 3000 | 3000 | ✓ | number |
| DATABASE_URL | localhost:5432 | staging-db | prod-db | ✓ | string |
| JWT_SECRET | dev-key | unique | unique | ✓ | string |
| VITE_API_BASE_URL | localhost:3000 | staging-api | api.prod | ✓ | URL |
| SUPERADMIN_MFA_ENABLED | false | true | true | ✗ | boolean |
| SUPERADMIN_IP_ALLOWLIST_ENABLED | false | true | true | ✗ | boolean |
| LOG_LEVEL | debug | info | warn | ✗ | enum |

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| "Missing required environment variable" | .env.local not created | `cp .env.example .env.local` and edit |
| "Invalid DATABASE_URL" | Wrong format | Use `postgresql://user:pass@host:port/db` |
| "Production detected but API points to localhost" | VITE_API_BASE_URL has localhost | Set to actual production domain |
| Frontend can't reach backend | API URL mismatch | Verify VITE_API_BASE_URL matches backend URL |
| Database connection fails | Wrong credentials | Verify DATABASE_URL in .env.local |

## Files to Know

```
.env.example                          ← Template (safe, tracked)
.env.development                      ← Dev reference (safe, tracked)
.env.staging                          ← Staging reference (safe, tracked)
.env.production                       ← Production reference (safe, tracked)
.env                                  ← Local secrets (NEVER commit)
.env.local                            ← Developer override (NEVER commit)

apps/backend/src/config/environment.ts    ← Backend config loader
apps/frontend/src/config/environment.ts   ← Frontend config loader
```

## Security Reminders

🔒 **NEVER commit .env files** — Pre-commit hook prevents this  
🔒 **NEVER hardcode secrets** — Use environment variables  
🔒 **NEVER share secrets** — Each environment has unique values  
🔒 **NEVER use dev secrets in prod** — Configuration validates this  
🔒 **NEVER assume localhost** — All URLs are injected via config

## One-Liner Status Check

```bash
# See all config at startup
npm run dev 2>&1 | grep -E "^\[.*\].*environment|^\[.*\].*config"
```

---

**For complete details:** See `ENVIRONMENT_SEPARATION.md`
