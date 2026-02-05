# SUPERADMIN SECURITY HARDENING — QUICK REFERENCE

## 🚀 Quick Start

### Integration (5 minutes)

```typescript
// 1. Update apps/backend/src/index.ts
import superadminSecurityRoutes from './routes/superadmin-security-hardening.js'

// Add after other routes
app.use('/api/superadmin', superadminSecurityRoutes)

// 2. Run migrations
npm run migrate

// 3. Start server
npm run dev
```

### API Endpoints (Quick Reference)

```
MFA Management:
  POST   /api/superadmin/security/mfa/challenge       → Create MFA challenge
  POST   /api/superadmin/security/mfa/verify          → Verify MFA code

Session Management:
  GET    /api/superadmin/security/sessions            → List active sessions
  POST   /api/superadmin/security/sessions/logout     → End current session
  POST   /api/superadmin/security/sessions/invalidate → Invalidate all sessions

IP Allowlisting:
  GET    /api/superadmin/security/ip-allowlist        → List allowlisted IPs
  POST   /api/superadmin/security/ip-allowlist        → Add IP to allowlist

Confirmation Tokens:
  POST   /api/superadmin/security/confirmation-token  → Generate confirmation token

Dry-Run:
  POST   /api/superadmin/security/delete-account-dryrun → Simulate account delete

Status:
  GET    /api/superadmin/security/status              → Get security configuration
```

---

## 🔑 Security Thresholds

| Feature | Threshold | Environment |
|---------|-----------|-------------|
| **MFA TTL** | 10 minutes | All |
| **MFA Attempts** | 5 per challenge | All |
| **Session TTL** | 15 minutes | Production |
| **Session TTL** | 60 minutes | Staging |
| **Session TTL** | 120 minutes | Development |
| **Session Warning** | 75% TTL | All |
| **IP Allowlist Expiration** | 30 days | All |
| **Rate Limit** | 5 per hour | All |
| **Confirmation TTL** | 15 minutes | All |

---

## 🔐 MFA Workflow

```
1. Create Challenge
   POST /api/superadmin/security/mfa/challenge
   → Get challengeId

2. User enters 6-digit code
   From authenticator app (TOTP)

3. Verify Code
   POST /api/superadmin/security/mfa/verify
   Body: { challengeId, code }
   → Get sessionToken with 15-min TTL

4. Use sessionToken
   Authorization: Bearer {sessionToken}
   For all superadmin operations
```

---

## 🛡️ Configuration

### Enable/Disable Features

```typescript
// apps/backend/src/config/environment.ts

// MFA
security.mfaEnabled = true
security.mfaRequired = NODE_ENV === 'production'

// IP Allowlist
security.ipAllowlistEnabled = true
security.ipAllowlistDefaultExpirationDays = 30

// Session TTL
security.sessionTTL.production = 15 * 60 * 1000   // 15 min
security.sessionTTL.staging = 60 * 60 * 1000      // 60 min
security.sessionTTL.development = 120 * 60 * 1000 // 120 min

// Rate Limiting
security.rateLimits.destructiveActionsPerHour = 5
security.rateLimits.windowSeconds = 3600
```

---

## 📊 Database Tables

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `superadmin_sessions` | Session tracking | user_id, expires_at, ip_address, is_active |
| `mfa_challenges` | MFA codes | user_id, method, attempts, expires_at |
| `ip_allowlist` | IP whitelist | user_id, ip_address, expires_at |
| `rate_limits` | Rate limit counters | user_id, action, count, reset_at |
| `confirmation_tokens` | Confirmation verification | operation, is_used, expires_at |
| `dry_run_logs` | Simulation audit | operation, context, validation_result |
| `security_event_logs` | Immutable audit trail | user_id, event_type, severity, logged_at |

---

## ✅ Testing Checklist

```bash
# 1. Test MFA Challenge
curl -X POST http://localhost:3001/api/superadmin/security/mfa/challenge \
  -H "Authorization: Bearer {jwt_token}" \
  -H "Content-Type: application/json" \
  -d '{"method": "TOTP"}'

# 2. Verify MFA Code
curl -X POST http://localhost:3001/api/superadmin/security/mfa/verify \
  -H "Authorization: Bearer {jwt_token}" \
  -H "Content-Type: application/json" \
  -d '{"challengeId": "...", "code": "123456"}'

# 3. List Sessions
curl -X GET http://localhost:3001/api/superadmin/security/sessions \
  -H "Authorization: Bearer {session_token}"

# 4. Add IP to Allowlist
curl -X POST http://localhost:3001/api/superadmin/security/ip-allowlist \
  -H "Authorization: Bearer {session_token}" \
  -H "Content-Type: application/json" \
  -d '{"ipAddress": "203.0.113.45", "description": "Office", "expirationDays": 30}'

# 5. Generate Confirmation Token
curl -X POST http://localhost:3001/api/superadmin/security/confirmation-token \
  -H "Authorization: Bearer {session_token}" \
  -H "Content-Type: application/json" \
  -d '{"operation": "DELETE_ACCOUNT", "context": {"targetUserId": "..."}}'

# 6. Test Dry-Run
curl -X POST http://localhost:3001/api/superadmin/security/delete-account-dryrun \
  -H "Authorization: Bearer {session_token}" \
  -H "Content-Type: application/json" \
  -d '{"userId": "..."}'
```

---

## 🚨 Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| "MFA verification failed" | Wrong code or expired challenge | Generate new challenge |
| "Session expired" | TTL exceeded | Re-authenticate with MFA |
| "IP not allowlisted" | IP not in whitelist | Add IP via /api/superadmin/security/ip-allowlist |
| "Rate limit exceeded" | 5+ operations in last hour | Wait for window reset (1 hour) |
| "Invalid confirmation token" | Token expired or already used | Generate new token |
| "MFA not required" | Development environment | Enable in config for testing |

---

## 🔍 Monitoring Queries

```sql
-- List recent security events
SELECT * FROM security_event_logs
WHERE logged_at > NOW() - INTERVAL '1 hour'
ORDER BY logged_at DESC;

-- Count MFA failures
SELECT COUNT(*) FROM security_event_logs
WHERE event_type = 'MFA_VERIFICATION_FAILED'
AND logged_at > NOW() - INTERVAL '24 hours';

-- List active sessions
SELECT * FROM superadmin_sessions
WHERE is_active = true
AND expires_at > NOW();

-- Check rate limits
SELECT * FROM rate_limits
WHERE reset_at > NOW()
ORDER BY reset_at;

-- Find unauthorized IP attempts
SELECT * FROM security_event_logs
WHERE event_type = 'IP_CHECK_FAILED'
AND logged_at > NOW() - INTERVAL '24 hours';
```

---

## 🎯 Best Practices

### For Developers
- Use dry-run before destructive operations
- Always verify confirmation tokens
- Check MFA status before operations
- Monitor rate limit headers
- Log security events immutably

### For Operations
- Review security events daily
- Monitor rate limit violations
- Keep IP allowlist current
- Rotate session access patterns
- Audit immutable logs regularly

### For Security
- MFA required in production
- 15-min session TTL strict
- IP allowlist enabled
- Rate limiting enabled
- Audit logs preserved permanently

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| `SUPERADMIN_SECURITY_HARDENING.md` | Complete reference guide |
| `PHASE_3_STEP_3_2_DELIVERY.md` | Delivery summary & checklist |
| `superadminSecurityService.ts` | Service layer (in-code comments) |
| `superadminSecurityMiddleware.ts` | Middleware layer (in-code comments) |
| `superadmin-security-hardening.ts` | Routes layer (in-code comments) |

---

## ⏱️ Integration Timeline

| Task | Time | Status |
|------|------|--------|
| Mount routes in index.ts | 5 min | ⏳ Not started |
| Run database migrations | 2 min | ⏳ Not started |
| Test in development | 1-2 hrs | ⏳ Not started |
| Deploy to staging | 30 min | ⏳ Not started |
| Test in staging | 2-3 hrs | ⏳ Not started |
| Deploy to production | 30 min | ⏳ Not started |
| Monitor & verify | 24 hrs | ⏳ Not started |
| **TOTAL** | **~6-7 hours** | |

---

## 🚀 Next Steps

1. **Mount routes** in `apps/backend/src/index.ts` (5 min)
2. **Run migration** with `npm run migrate` (2 min)
3. **Test MFA flow** in development (30 min)
4. **Deploy to staging** (30 min)
5. **Full test cycle** in staging (2-3 hours)
6. **Deploy to production** (30 min)
7. **Enable monitoring** (24/7)

---

## 📞 Support

For detailed information:
- See `SUPERADMIN_SECURITY_HARDENING.md` for complete reference
- Check code comments in service/middleware/routes files
- Review test procedures in documentation
- Consult troubleshooting section for issues

---

**PHASE 3, STEP 3.2** — Ready for Integration
