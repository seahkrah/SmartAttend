#!/bin/bash
# Commit environment configuration files

cd "$(git rev-parse --show-toplevel)"

# Stage only the safe files (not .env, .env.local, etc)
git add .env.example .env.development .env.staging .env.production
git add apps/backend/src/config/environment.ts
git add apps/frontend/src/config/environment.ts
git add ENVIRONMENT_SEPARATION.md
git add apps/backend/src/index.ts
git add apps/frontend/src/services/api.ts
git add apps/frontend/vite.config.ts
git add apps/frontend/tsconfig.json
git add .git/hooks/pre-commit
git add .git/hooks/pre-commit.ps1

# Commit
git commit -m "feat: Implement environment separation (dev/staging/prod) with configuration modules

- Add environment.ts configuration modules for backend and frontend
- Create .env.example template with all configuration variables
- Add environment-specific .env files (development, staging, production)
- Update backend to use environment config instead of process.env
- Update frontend API client to use VITE_API_BASE_URL from config
- Add tsconfig types for Vite environment support
- Create ENVIRONMENT_SEPARATION.md with setup and best practices
- Ensure no shared secrets, databases, or hardcoded assumptions
- Configuration validation at startup for all environments
- Update pre-commit hook to allow .env.*.example reference files"
