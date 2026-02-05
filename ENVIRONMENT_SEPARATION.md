# Environment Separation & Configuration Guide

## Overview

SmartAttend implements strict environment separation across development, staging, and production. Each environment has:
- **Separate database instances** (no data sharing)
- **Unique secrets** (no secret sharing between environments)
- **No hardcoded environment assumptions** (configuration-driven)

## Environment Files

### Source-Controlled Files (Safe to Commit)
```
.env.example              # Template for all environment variables
apps/backend/src/config/environment.ts    # Backend config loader
apps/frontend/src/config/environment.ts   # Frontend config loader
```

### Local Files (NEVER Commit - Add to .gitignore)
```
.env                      # Local machine overrides
.env.local                # Local machine development
.env.development          # Development defaults (reference only)
.env.staging              # Staging defaults (reference only)
.env.production           # Production defaults (reference only)
.env.*.local              # Environment-specific local overrides
.env.*.private            # Local secrets (never committed)
.env.*.secret             # Local secrets (never committed)
```

## Configuration Variables by Environment

### Development (`NODE_ENV=development`)
- **Database**: Local PostgreSQL on `localhost:5432`
- **Backend Port**: `3000` (localhost)
- **API URL**: `http://localhost:3000/api`
- **JWT Secret**: Dev-only key (unsafe, for testing only)
- **Security**: MFA disabled, IP allowlist disabled, logging at DEBUG level
- **Use Case**: Local development, rapid iteration

### Staging (`NODE_ENV=staging`)
- **Database**: Staging PostgreSQL at `staging-db.example.com`
- **Backend Port**: `3000` (behind load balancer/proxy)
- **API URL**: `https://staging-api.example.com`
- **JWT Secret**: Unique staging secret (set via deployment platform)
- **Security**: MFA enabled, IP allowlist enabled, logging at INFO level
- **Use Case**: Pre-production testing, QA validation, integration tests

### Production (`NODE_ENV=production`)
- **Database**: Production PostgreSQL at `prod-db.example.com`
- **Backend Port**: `3000` (behind load balancer/reverse proxy)
- **API URL**: `https://api.example.com`
- **JWT Secret**: Unique production secret (set via deployment platform, min 32 chars)
- **Security**: MFA enforced, IP allowlist enforced, logging at WARN level
- **Use Case**: Live user-facing system, strict controls

## No Shared Secrets

Each environment has **completely independent secrets**:

| Secret | Dev | Staging | Production |
|--------|-----|---------|-----------|
| `JWT_SECRET` | `dev-secret-...` | Staging-specific | Production-specific |
| `DATABASE_URL` | Local DB | Staging DB | Production DB |
| `MFA_AUTH_TOKEN` | N/A | Staging provider | Production provider |

**Rule**: A secret valid in one environment **never works** in another.

## No Shared Databases

Databases are completely isolated:

- **Development**: Local instance on developer's machine or shared dev server
- **Staging**: Separate AWS RDS or managed database instance
- **Production**: Separate AWS RDS or managed database instance with backups, replicas, and monitoring

**Data flow guarantee**: Development data cannot accidentally corrupt staging or production.

## No Hardcoded Environment Assumptions

All configuration is loaded from environment variables via the configuration modules:

### Backend: `apps/backend/src/config/environment.ts`
```typescript
export const config: EnvironmentConfig = {
  nodeEnv,
  backend: {
    port: config.backend.port,      // From BACKEND_PORT env var
    databaseUrl: config.backend.databaseUrl,  // From DATABASE_URL env var
    jwtSecret: config.backend.jwtSecret,      // From JWT_SECRET env var
    sessionTimeoutMs: config.backend.sessionTimeoutMs,
  },
  frontend: { apiBaseUrl: config.frontend.apiBaseUrl },  // From VITE_API_BASE_URL
  security: { /* from env vars */ },
  logging: { /* from env vars */ },
};
```

### Frontend: `apps/frontend/src/config/environment.ts`
```typescript
export const frontendConfig: FrontendConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,  // From Vite environment
  isDevelopment: import.meta.env.MODE === 'development',
  isProduction: import.meta.env.MODE === 'production',
  isStaging: import.meta.env.MODE === 'staging',
};
```

No hardcoded localhost URLs, API endpoints, or secrets anywhere in source code.

## Setup Instructions

### Local Development
1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

2. Update variables for your machine:
   ```bash
   NODE_ENV=development
   BACKEND_PORT=3000
   DATABASE_URL=postgresql://localhost:5432/smartattend_dev
   VITE_API_BASE_URL=http://localhost:3000/api
   ```

3. Start database (PostgreSQL on localhost:5432)

4. Backend: `npm run dev` (reads `.env.local`)

5. Frontend: `npm run dev` (reads `.env.local`)

### Staging Deployment
1. Set environment variables on staging deployment platform (e.g., AWS ECS, Heroku, Railway):
   ```
   NODE_ENV=staging
   DATABASE_URL=postgresql://user:pass@staging-db:5432/smartattend_staging
   JWT_SECRET=<unique-staging-secret>
   VITE_API_BASE_URL=https://staging-api.example.com
   SUPERADMIN_MFA_ENABLED=true
   SUPERADMIN_IP_ALLOWLIST_ENABLED=true
   ```

2. Deploy containers

3. Frontend builds will automatically use `VITE_API_BASE_URL`

### Production Deployment
1. Set environment variables on production deployment platform:
   ```
   NODE_ENV=production
   DATABASE_URL=postgresql://user:pass@prod-db:5432/smartattend_prod
   JWT_SECRET=<unique-production-secret-min-32-chars>
   VITE_API_BASE_URL=https://api.example.com
   SUPERADMIN_MFA_ENABLED=true
   SUPERADMIN_IP_ALLOWLIST_ENABLED=true
   ```

2. Validate configuration is loaded correctly (check logs at startup)

3. Deploy containers

4. Frontend builds will automatically use `VITE_API_BASE_URL`

## Configuration Validation

Both backend and frontend validate configuration at startup:

**Backend Validation** (`environment.ts`):
- ✅ All required environment variables are set
- ✅ Database URL has valid PostgreSQL format
- ✅ API URL is valid HTTP/HTTPS
- ✅ Production environment has unique JWT secret (not dev default)
- ✅ Production environment API URL doesn't point to localhost

**Frontend Validation** (`environment.ts`):
- ✅ `VITE_API_BASE_URL` is set
- ✅ API URL is valid HTTP/HTTPS format

If validation fails, startup is aborted with clear error messages indicating what needs to be fixed.

## Environment Variable Reference

See `.env.example` for complete list with descriptions.

Key variables:
- `NODE_ENV` - Development, staging, or production mode
- `BACKEND_PORT` - Express server port
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - JWT signing secret (unique per environment)
- `VITE_API_BASE_URL` - Frontend API base URL
- `SUPERADMIN_MFA_ENABLED` - Enable MFA for superadmin (true/false)
- `SUPERADMIN_IP_ALLOWLIST_ENABLED` - Enable IP allowlist (true/false)
- `LOG_LEVEL` - Logging verbosity (debug/info/warn/error)

## Security Best Practices

1. **Never commit .env files** - gitignore enforces this with pre-commit hooks
2. **Use deployment platform secrets** - Don't manage secrets locally
3. **Rotate secrets regularly** - Especially JWT_SECRET in production
4. **Use HTTPS URLs** - Always use HTTPS for production API URLs
5. **Validate configuration early** - Configuration validation happens at app startup
6. **Log configuration info at startup** - Verify correct environment loaded (without exposing secrets)

## Troubleshooting

**"Missing required environment variable"**
- Check `.env` or `.env.local` file exists
- Verify all variables from `.env.example` are set
- Ensure `NODE_ENV` is set to one of: development, staging, production

**"Invalid DATABASE_URL format"**
- Must be PostgreSQL: `postgresql://user:pass@host:port/database`
- Check connection string doesn't have typos

**"Production detected but API URL points to localhost"**
- Production builds detect localhost URLs and reject
- Set `VITE_API_BASE_URL` to actual production domain

**Frontend not connecting to backend**
- Verify `VITE_API_BASE_URL` matches actual backend URL
- Check CORS is enabled on backend
- Verify backend is running on correct port

## Next Steps

- Configure deployment platform to inject environment variables
- Set up secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
- Implement automatic secret rotation
- Monitor configuration validation logs in production
