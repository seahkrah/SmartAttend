# PHASE 3, STEP 3.1 — QUICK REFERENCE & TROUBLESHOOTING

**For**: Developers, DevOps, Operations teams

---

## Quick Start

### Development (Bootstrap)

```bash
# 1. Start server
npm run dev

# 2. Initialize superadmin system (one-time)
curl -X POST http://localhost:3000/api/superadmin/bootstrap

# 3. Save default credentials (email: superadmin@smartattend.local)
# 4. Login to get JWT token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "superadmin@smartattend.local",
    "password": "smartattend123"
  }'

# 5. Use JWT token for operational endpoints
export JWT="eyJhbGciOiJIUzI1NiIs..."
```

### Production (Operational)

```bash
# 1. Bootstrap is disabled
curl -X POST http://localhost:3000/api/superadmin/bootstrap
# Returns: 403 Forbidden

# 2. Use authenticated endpoints
curl -X POST http://localhost:3000/api/superadmin/accounts \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@company.local",
    "fullName": "Alice Admin"
  }'
```

---

## Common Tasks

### Create Superadmin Account

```bash
JWT="your-jwt-token"

curl -X POST http://localhost:3000/api/superadmin/accounts \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "bob@company.local",
    "fullName": "Bob Administrator"
  }'

# Response includes temporaryPassword - share securely
```

### Delete Superadmin Account

```bash
JWT="your-jwt-token"
USER_ID="bob-uuid"

curl -X DELETE http://localhost:3000/api/superadmin/accounts/$USER_ID \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Employee left company"
  }'
```

### Reset Superadmin Password

```bash
JWT="your-jwt-token"
USER_ID="bob-uuid"

curl -X POST http://localhost:3000/api/superadmin/accounts/$USER_ID/reset-password \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{}'

# Response includes temporaryPassword - share securely
```

### List All Superadmins

```bash
JWT="your-jwt-token"

curl http://localhost:3000/api/superadmin/accounts \
  -H "Authorization: Bearer $JWT"
```

### Check Bootstrap Status

```bash
# No authentication required
curl http://localhost:3000/api/superadmin/bootstrap/status

# development: { "bootstrapAvailable": true }
# production: { "bootstrapAvailable": false }
```

---

## Troubleshooting

### Bootstrap Not Available

**Problem**: `"error": "Bootstrap mode not available"`

**Cause**: Environment is not development

**Solution**:
```bash
# Check NODE_ENV
echo $NODE_ENV

# Set to development
export NODE_ENV=development

# Or in .env file
NODE_ENV=development

# Then restart server
npm run dev
```

### 401 Unauthorized on Operational Endpoints

**Problem**: `"error": "Not authenticated"`

**Cause**: Missing or invalid JWT token

**Solution**:
```bash
# Get new token
JWT=$(curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "superadmin@smartattend.local",
    "password": "your-password"
  }' | jq -r '.data.token')

# Use token
curl -H "Authorization: Bearer $JWT" \
  http://localhost:3000/api/superadmin/accounts
```

### 403 Forbidden (Superadmin Access Required)

**Problem**: `"error": "Superadmin access required"`

**Cause**: User doesn't have superadmin role

**Solution**:
```bash
# Check user's role in database
SELECT r.name FROM users u
JOIN roles r ON u.role_id = r.id
WHERE u.id = 'user-uuid';

# Must return: superadmin

# If not, grant role (run as DB admin)
UPDATE users SET role_id = (
  SELECT id FROM roles WHERE name = 'superadmin'
) WHERE id = 'user-uuid';
```

### Cannot Delete Your Own Account

**Problem**: `"error": "Cannot delete your own superadmin account"`

**Cause**: Trying to delete yourself (safety feature)

**Solution**: Use a different superadmin account to delete yourself:
```bash
# Have another superadmin delete your account
# Or ask a peer superadmin

# Alternative: Reset your own password instead
curl -X POST http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "old-password",
    "newPassword": "new-password"
  }'
```

### Database Connection Error

**Problem**: `"error": "Failed to create superadmin account"`

**Cause**: Database connectivity issue

**Solution**:
```bash
# Check DATABASE_URL
echo $DATABASE_URL

# Test connection
psql $DATABASE_URL -c "SELECT NOW();"

# Verify tables exist
psql $DATABASE_URL -c "SELECT * FROM users LIMIT 1;"

# If tables missing, run migrations
npm run migrate
```

### Audit Log Not Recorded

**Problem**: Operation succeeds but audit log empty

**Cause**: Audit logging is non-blocking (doesn't fail operation)

**Solution**: Check audit service logs:
```bash
# Look for audit context errors
grep "AUDIT" /var/log/app.log

# Verify audit_logs table exists
SELECT COUNT(*) FROM audit_logs;

# Query recent entries
SELECT * FROM audit_logs 
WHERE action_type LIKE '%SUPERADMIN%'
ORDER BY timestamp DESC LIMIT 10;
```

---

## Environment Variables

### Development

```bash
NODE_ENV=development
DATABASE_URL=postgresql://user:pass@localhost:5432/smartattend_dev
JWT_SECRET=dev-secret-key-change-in-production
BACKEND_PORT=3000

# Optional: Enable bootstrap in non-dev environments (not recommended)
FORCE_BOOTSTRAP=false
```

### Production

```bash
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@prod-db:5432/smartattend
JWT_SECRET=unique-very-long-random-string
BACKEND_PORT=3000

# These MUST be set
SUPERADMIN_MFA_ENABLED=true
SUPERADMIN_IP_ALLOWLIST_ENABLED=true

# Bootstrap always disabled in production
FORCE_BOOTSTRAP=false
```

---

## API Response Formats

### Success Response

```json
{
  "success": true,
  "message": "Operation completed",
  "data": {
    "userId": "uuid",
    "email": "user@example.com"
  }
}
```

### Error Response

```json
{
  "error": "Error description",
  "details": "Detailed error message"
}
```

### Error Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK — Success |
| 201 | Created — Resource created |
| 400 | Bad Request — Invalid input |
| 401 | Unauthorized — Need authentication |
| 403 | Forbidden — Need superadmin role |
| 404 | Not Found — Resource doesn't exist |
| 409 | Conflict — Operation would violate constraints |
| 500 | Server Error — Internal error |

---

## Audit Query Examples

### View All Superadmin Operations

```sql
SELECT 
  request_id,
  actor_id,
  action_type,
  status,
  timestamp
FROM audit_logs
WHERE action_type LIKE '%SUPERADMIN%'
ORDER BY timestamp DESC
LIMIT 50;
```

### View Operations by Specific User

```sql
SELECT 
  actor_id,
  COUNT(*) as operation_count,
  MAX(timestamp) as last_action
FROM audit_logs
WHERE action_type LIKE '%SUPERADMIN%'
GROUP BY actor_id
ORDER BY last_action DESC;
```

### View Failed Operations

```sql
SELECT 
  request_id,
  actor_id,
  action_type,
  timestamp,
  error_details
FROM audit_logs
WHERE action_type LIKE '%SUPERADMIN%'
AND status = 'FAILURE'
ORDER BY timestamp DESC;
```

### Timeline of Operations

```sql
SELECT 
  timestamp,
  actor_id,
  action_type,
  CASE WHEN status = 'SUCCESS' THEN '✓' ELSE '✗' END as result,
  after_state ->> 'email' as affected_email
FROM audit_logs
WHERE action_type LIKE '%SUPERADMIN%'
ORDER BY timestamp DESC;
```

---

## Performance Considerations

### Audit Log Query Performance

```sql
-- Good: Indexed columns
SELECT * FROM audit_logs 
WHERE action_type = 'CREATE_SUPERADMIN_ACCOUNT' 
AND timestamp > NOW() - INTERVAL '7 days';

-- Bad: Full table scan
SELECT * FROM audit_logs 
WHERE after_state::text LIKE '%alice%';
```

### Recommended Indexes

```sql
CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
```

### Batch Operations

```bash
# Create multiple accounts efficiently
for email in alice@company.local bob@company.local charlie@company.local; do
  curl -X POST http://localhost:3000/api/superadmin/accounts \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d "{
      \"email\": \"$email\",
      \"fullName\": \"$(echo $email | cut -d@ -f1 | tr '[:lower:]' '[:upper:]')\"
    }"
done
```

---

## Security Best Practices

### 1. Change Default Password Immediately

```bash
# After bootstrap
curl -X POST http://localhost:3000/api/auth/login \
  -d '{"email":"superadmin@smartattend.local","password":"smartattend123"}'

# Get new JWT and change password
curl -X POST http://localhost:3000/api/auth/change-password \
  -H "Authorization: Bearer $JWT" \
  -d '{"currentPassword":"smartattend123","newPassword":"NewSecurePassword123!"}'
```

### 2. Enable MFA

```bash
# In production
export SUPERADMIN_MFA_ENABLED=true
export SUPERADMIN_IP_ALLOWLIST_ENABLED=true
```

### 3. Share Passwords Securely

Never:
- ❌ Email passwords in plain text
- ❌ Share over unencrypted channels
- ❌ Log passwords

Instead:
- ✅ Use encrypted password manager (1Password, LastPass)
- ✅ Share via secure channel with expiration
- ✅ Use temporary passwords (must change on first login)

### 4. Audit Log Retention

```bash
# Archive old audit logs monthly
psql $DATABASE_URL << EOF
COPY (SELECT * FROM audit_logs WHERE timestamp < NOW() - INTERVAL '90 days')
TO '/backup/audit_logs_archive_feb2026.csv' CSV HEADER;

-- Keep in database for 1 year minimum
DELETE FROM audit_logs WHERE timestamp < NOW() - INTERVAL '365 days';
EOF
```

### 5. Regular Password Rotation

```bash
# Reset all superadmin passwords quarterly
SELECT id, email FROM users u
JOIN roles r ON u.role_id = r.id
WHERE r.name = 'superadmin';

# For each, run reset-password endpoint
```

---

## Support & Escalation

### Debug Mode

```bash
# Enable debug logging
export LOG_LEVEL=debug
npm run dev

# Look for [DEBUG] messages
```

### Contact Points

| Issue | Contact |
|-------|---------|
| API not responding | DevOps / Backend Lead |
| Database error | Database Administrator |
| Audit log issue | Database Administrator |
| Authentication issue | Security Lead |
| Permission issue | RBAC Administrator |

### Logs to Check

```bash
# Application logs
tail -f /var/log/smartattend/backend.log

# Database logs
tail -f /var/log/postgresql/postgresql.log

# Audit trail
SELECT * FROM audit_logs 
WHERE timestamp > NOW() - INTERVAL '1 hour'
ORDER BY timestamp DESC;
```

---

## Version & Support

| Item | Version |
|------|---------|
| PHASE | 3 |
| STEP | 3.1 |
| Status | Production Ready |
| Last Updated | February 4, 2026 |
| Node.js | 18+ |
| PostgreSQL | 12+ |

---

**Need help?** See [PHASE_3_STEP_3_1_ELIMINATE_SCRIPTS.md](PHASE_3_STEP_3_1_ELIMINATE_SCRIPTS.md) for detailed documentation.
