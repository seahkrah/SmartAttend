# PHASE 3, STEP 3.1 — PRODUCTION SCRIPTS DISABLEMENT GUIDE

**Purpose**: Ensure no operational scripts exist in production deployments.

---

## Scripts to Disable

### 1. Development Bootstrap Scripts

These files are **for development reference only** and must not be deployed to production:

#### `apps/backend/setup-superadmin.ts`
- **Purpose**: Historical reference for bootstrap logic (now in `superadminService.ts`)
- **Action**: Remove from production builds
- **Replacement**: `POST /api/superadmin/bootstrap` API endpoint

#### `apps/backend/delete-superadmin.ts`
- **Purpose**: Historical reference for account deletion (now in `superadminService.ts`)
- **Action**: Remove from production builds
- **Replacement**: `DELETE /api/superadmin/accounts/:userId` API endpoint

#### `apps/backend/test-server.js`
- **Purpose**: Local testing only
- **Action**: Remove from production builds
- **Replacement**: Integration tests in `src/tests/`

#### `apps/backend/test-server-simple.ts`
- **Purpose**: Local testing only
- **Action**: Remove from production builds
- **Replacement**: Integration tests in `src/tests/`

---

## Deployment Checklist

### Before Building

```bash
# Verify scripts are NOT in TypeScript compilation
npm run build

# Check build output
ls -la dist/

# Should contain:
# ✓ dist/src/** (compiled source)
# ✓ dist/package.json (dependencies)
# ✗ dist/setup-superadmin.js (should NOT exist)
# ✗ dist/delete-superadmin.js (should NOT exist)
# ✗ dist/test-server.js (should NOT exist)
```

### Git Deployment

#### Option A: Keep in Git (Recommended)

**Rationale**: Maintain git history for auditing, but prevent deployment

**Steps**:

1. Create `.deployignore` file in backend root:
```
setup-superadmin.ts
delete-superadmin.ts
test-server.js
test-server-simple.ts
*.test.ts
*.spec.ts
```

2. Update deployment pipeline (GitHub Actions):
```yaml
# .github/workflows/deploy.yml
deploy:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v2
    
    # Build backend
    - run: cd apps/backend && npm run build
    
    # Verify scripts not in dist
    - run: |
        if [ -f dist/setup-superadmin.js ]; then
          echo "ERROR: setup-superadmin.js found in build"
          exit 1
        fi
        if [ -f dist/delete-superadmin.js ]; then
          echo "ERROR: delete-superadmin.js found in build"
          exit 1
        fi
    
    # Deploy dist/ folder only
    - run: npm run deploy -- dist/
```

#### Option B: Remove from Git (Alternative)

**Rationale**: Eliminate scripts entirely from source control

**Steps**:

1. Create git-archived branch (for reference):
```bash
git branch archive/v1-with-scripts
git push origin archive/v1-with-scripts
```

2. Remove scripts from main branch:
```bash
git rm apps/backend/setup-superadmin.ts
git rm apps/backend/delete-superadmin.ts
git rm apps/backend/test-server.js
git rm apps/backend/test-server-simple.ts

git commit -m "chore: Remove shell scripts in favor of API endpoints

- Replaced setup-superadmin.ts with POST /api/superadmin/bootstrap
- Replaced delete-superadmin.ts with DELETE /api/superadmin/accounts/:userId
- Removed test-server.js and test-server-simple.ts
- All operations now go through audit-logged API endpoints
- Bootstrap disabled in production environment

See branch archive/v1-with-scripts for historical reference"

git push origin main
```

---

## Build Verification

### TypeScript Build

```bash
# Compile TypeScript
npm run build

# Verify no scripts in dist
ls -la dist/ | grep -E '(setup|delete|test-server)'
# Should return empty (no matches)
```

### Production Build

```bash
# Create production image
docker build -t smartattend-backend:latest .

# Verify scripts not in container
docker run --rm smartattend-backend:latest ls -la /app/dist/

# Should NOT contain:
# setup-superadmin.js
# delete-superadmin.js
# test-server.js
```

### Runtime Verification

```bash
# Start server
npm start

# Check for script references in logs
grep -i "setup-superadmin\|delete-superadmin\|test-server" /var/log/app.log
# Should return empty

# Verify API endpoints available
curl http://localhost:3000/api/superadmin/bootstrap/status
# { "bootstrapAvailable": false, "environment": "production" }
```

---

## Environment Variables

Ensure these are set correctly in production:

```bash
# Production environment
NODE_ENV=production

# Disable bootstrap (fail-safe)
FORCE_BOOTSTRAP=false

# Disable any script execution mode
SCRIPT_MODE=disabled
```

---

## Script Reference Archive

If you need to reference the bootstrap logic, it's now in the service:

```typescript
// Instead of running: npx ts-node setup-superadmin.ts
// Use: Import from service

import { bootstrapSuperadmin } from './src/services/superadminService.js'

const result = await bootstrapSuperadmin()
console.log('Bootstrap complete:', result)

// Or call the API endpoint
const response = await fetch('http://localhost:3000/api/superadmin/bootstrap', {
  method: 'POST'
})
const data = await response.json()
console.log('Bootstrap complete:', data)
```

---

## Documentation References

- **Superadmin Service**: `src/services/superadminService.ts`
- **Superadmin Routes**: `src/routes/superadmin-operations.ts`
- **API Documentation**: `PHASE_3_STEP_3_1_ELIMINATE_SCRIPTS.md`
- **Bootstrap Guide**: See same document, "Bootstrap" section

---

## Verification Commands

### Production-Ready Check

```bash
#!/bin/bash
# Verify production readiness

echo "Checking for deployment-prohibited scripts..."

SCRIPTS=(
  "setup-superadmin.ts"
  "delete-superadmin.ts"
  "test-server.js"
  "test-server-simple.ts"
)

FOUND=0
for script in "${SCRIPTS[@]}"; do
  if find apps/backend -name "$script" -type f | grep -q .; then
    echo "❌ Found: $script (should be removed or in .deployignore)"
    FOUND=$((FOUND + 1))
  else
    echo "✓ Not found: $script"
  fi
done

if [ $FOUND -eq 0 ]; then
  echo "✅ All scripts verified for production deployment"
  exit 0
else
  echo "❌ Found $FOUND prohibited scripts"
  exit 1
fi
```

---

## Rollback Procedure

If a script somehow ends up in production:

### Immediate

1. Stop the server
2. Check if script was executed: `grep -i "setup\|delete" /var/log/app.log`
3. If executed, review audit logs for changes
4. Restore from previous deployment snapshot

### Investigation

```sql
-- Check audit logs for unauthorized operations
SELECT * FROM audit_logs
WHERE timestamp > '2026-02-04 10:00:00'
AND action_type LIKE '%SUPERADMIN%'
ORDER BY timestamp DESC;

-- Check superadmin action logs
SELECT * FROM superadmin_action_logs
WHERE created_at > '2026-02-04 10:00:00'
ORDER BY created_at DESC;
```

### Prevention

1. Implement pre-deployment scan:
```bash
# In CI/CD pipeline
npm run build
if [ -f dist/setup-superadmin.js ]; then
  echo "DEPLOYMENT BLOCKED: Script found in build"
  exit 1
fi
```

2. Lock down file permissions:
```bash
# In production container
chmod 000 setup-superadmin.ts 2>/dev/null || true
chmod 000 delete-superadmin.ts 2>/dev/null || true
```

---

## Success Criteria

- ✅ No script files in production build
- ✅ No script files in Docker image
- ✅ Bootstrap endpoint returns 403 in production
- ✅ All superadmin operations go through API endpoints
- ✅ All operations logged immutably
- ✅ Git history preserved for audit
- ✅ CI/CD blocks script deployments

---

**Status**: Ready for implementation

**Timeline**: Should be applied before first production deployment
