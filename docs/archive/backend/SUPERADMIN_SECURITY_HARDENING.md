# PHASE 3, STEP 3.2 — Superadmin Security Hardening

## Overview

This document describes the complete security hardening implementation for superadmin operations. All destructive operations now require:

1. **Mandatory MFA** - Time-based (TOTP) or delivery-based (SMS/EMAIL) codes
2. **Short Session TTL** - 15 minutes in production, 60 minutes in staging, 120 minutes in development
3. **IP Allowlisting** - Optional per-user IP whitelist
4. **Rate Limiting** - Maximum 5 destructive operations per hour
5. **Confirmation Tokens** - One-time tokens for irreversible operations
6. **Dry-Run Mode** - Simulate operations before execution

---

## Architecture

### Security Layers

```
Request
  ↓
[1] Authentication (JWT)
  ↓
[2] Role Check (superadmin only)
  ↓
[3] Session Validation (TTL check)
  ↓
[4] IP Allowlist Check
  ↓
[5] Session TTL Warning (75% threshold)
  ↓
[6] Rate Limiting (destructive only)
  ↓
Operation Execution
```

### Service Architecture

```
superadminSecurityService.ts
├── MFA System
│   ├── createMFAChallenge() - Generate challenge
│   ├── verifyMFACode() - Verify code
│   ├── isMFARequired() - Check if MFA required
│   └── isMFAEnabled() - Check user MFA status
├── Session Management
│   ├── createSuperadminSession() - Create authenticated session
│   ├── verifySuperadminSession() - Validate session
│   ├── endSuperadminSession() - Terminate session
│   └── getActiveSuperadminSessions() - List sessions
├── IP Allowlisting
│   ├── isIPAllowlisted() - Check IP
│   ├── addIPToAllowlist() - Whitelist IP
│   └── getAllowlistedIPs() - List allowlist
├── Rate Limiting
│   ├── checkRateLimit() - Check if limit exceeded
│   └── resetRateLimit() - Clear rate limit
├── Confirmation Tokens
│   ├── generateConfirmationToken() - Create token
│   ├── verifyConfirmationToken() - Validate token
│   └── consumeConfirmationToken() - Mark as used
├── Dry-Run Mode
│   └── executeDryRun() - Simulate operation
└── Logging
    └── logSecurityEvent() - Immutable audit log
```

---

## MFA (Multi-Factor Authentication)

### Supported Methods

1. **TOTP (Time-Based One-Time Password)**
   - User enters 6-digit code from authenticator app
   - No server code required
   - Recommended for production

2. **SMS**
   - 6-digit code sent via SMS
   - Code returned in response for testing
   - Requires SMS provider configuration

3. **EMAIL**
   - 6-digit code sent via email
   - Code returned in response for testing
   - Always available

### Configuration

```typescript
// Environment-based enforcement
config.security.mfaEnabled = true
config.nodeEnv === 'production' // MFA required

// User level (database field: users.mfa_enabled)
user.mfaEnabled = true
user.mfaMethod = 'TOTP' // or 'SMS', 'EMAIL'
```

### Thresholds

- **Challenge TTL**: 10 minutes
- **Max Attempts**: 5 per challenge
- **Code Length**: 6 digits
- **Code Format**: 0-9 only

### API Usage

```bash
# 1. Create MFA challenge
POST /api/superadmin/security/mfa/challenge
Content-Type: application/json
Authorization: Bearer {jwt_token}

{
  "method": "TOTP"  // or "SMS", "EMAIL"
}

Response:
{
  "success": true,
  "data": {
    "challengeId": "550e8400-e29b-41d4-a716-446655440000",
    "method": "TOTP",
    "expiresAt": "2026-01-15T10:10:00Z"
  }
}

# 2. Verify MFA code
POST /api/superadmin/security/mfa/verify
Content-Type: application/json
Authorization: Bearer {jwt_token}

{
  "challengeId": "550e8400-e29b-41d4-a716-446655440000",
  "code": "123456"
}

Response:
{
  "success": true,
  "message": "MFA verified",
  "data": {
    "sessionId": "660e8400-e29b-41d4-a716-446655440001",
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "expiresAt": "2026-01-15T10:25:00Z",
    "ttlMinutes": 15
  }
}
```

---

## Session Management

### Session Lifecycle

```
[1] MFA Verification
  ↓
[2] Create Session
  ├─ TTL: 15 min (prod), 60 min (staging), 120 min (dev)
  ├─ IP Address: Captured
  ├─ User Agent: Captured
  └─ MFA Verified At: Timestamp
  ↓
[3] Session Active (15 min)
  ├─ IP Allowlist Check
  ├─ TTL Expiration Check
  └─ Activity Update
  ↓
[4] Session Expiration (75% threshold warning)
  ├─ Warning: "Session expiring in 3 minutes"
  └─ User must re-authenticate with MFA
  ↓
[5] Session Terminated
  ├─ Graceful logout (POST .../logout)
  ├─ TTL expiration
  └─ Admin invalidation (POST .../invalidate)
```

### Configuration

```typescript
// app.backend/src/config/environment.ts
security: {
  sessionTTL: {
    production: 15 * 60 * 1000,  // 15 minutes
    staging: 60 * 60 * 1000,     // 60 minutes
    development: 120 * 60 * 1000 // 120 minutes
  }
}
```

### API Usage

```bash
# List active sessions
GET /api/superadmin/security/sessions
Authorization: Bearer {session_token}

Response:
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0...",
      "createdAt": "2026-01-15T10:00:00Z",
      "expiresAt": "2026-01-15T10:15:00Z",
      "lastActivityAt": "2026-01-15T10:10:00Z",
      "isActive": true
    }
  ],
  "count": 1
}

# Logout (end current session)
POST /api/superadmin/security/sessions/logout
Authorization: Bearer {session_token}

Response:
{
  "success": true,
  "message": "Session ended"
}

# Invalidate all sessions (requires confirmation)
POST /api/superadmin/security/sessions/invalidate
Authorization: Bearer {session_token}
Content-Type: application/json

{
  "confirmationToken": "eyJvcGVyYXRpb24iOiJTRVNTSU9OX0lOVkFMSURBVElPTi..."
}

Response:
{
  "success": true,
  "message": "All sessions invalidated. Please login again."
}
```

---

## IP Allowlisting

### Purpose

Restrict superadmin access to specific IP addresses or ranges. Useful for:

- Limiting access to office networks
- Preventing unauthorized access from unexpected locations
- Compliance with security policies

### Configuration

```typescript
// app/backend/src/config/environment.ts
security: {
  ipAllowlistEnabled: true,
  ipAllowlistDefaultExpirationDays: 30
}
```

### Thresholds

- **Default Expiration**: 30 days
- **Max Expiration**: Configurable
- **Automatic Cleanup**: Disabled IPs older than expiration

### API Usage

```bash
# Get allowlisted IPs
GET /api/superadmin/security/ip-allowlist
Authorization: Bearer {session_token}

Response:
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "ipAddress": "192.168.1.100",
      "description": "Office network",
      "addedBy": "admin@company.com",
      "createdAt": "2026-01-15T10:00:00Z",
      "expiresAt": "2026-02-14T10:00:00Z",
      "isActive": true,
      "lastUsedAt": "2026-01-15T10:05:00Z"
    }
  ]
}

# Add IP to allowlist (requires MFA)
POST /api/superadmin/security/ip-allowlist
Authorization: Bearer {session_token}
X-MFA-Verified: true
Content-Type: application/json

{
  "ipAddress": "203.0.113.45",
  "description": "Remote office",
  "expirationDays": 30
}

Response:
{
  "success": true,
  "message": "IP added to allowlist",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "ipAddress": "203.0.113.45",
    "expiresAt": "2026-02-14T10:00:00Z"
  }
}
```

---

## Rate Limiting

### Destructive Actions

Rate-limited operations (max 5 per hour):

1. `DELETE_SUPERADMIN` - Delete superadmin account
2. `RESET_PASSWORD` - Reset user password
3. `INVALIDATE_SESSIONS` - Invalidate all user sessions
4. `CREATE_INCIDENT` - Create security incident

### Configuration

```typescript
security: {
  rateLimits: {
    destructiveActionsPerHour: 5,
    windowSeconds: 3600
  }
}
```

### Behavior

- Limits are per-user, per-action
- Window resets hourly
- Graceful failure (doesn't block on DB error)
- Rate limit reset on operation failure (no penalty for failed attempts)

### API Response

```json
{
  "error": "Rate limit exceeded",
  "details": "5 destructive actions already performed in the last hour",
  "retryAfter": 1800
}
```

---

## Confirmation Tokens

### Purpose

Require explicit confirmation before irreversible operations:

1. **DELETE_ACCOUNT** - Deleting superadmin account
2. **SESSION_INVALIDATION** - Invalidating all sessions
3. **DECOMMISSION_TENANT** - Removing entire tenant

### Workflow

```
[1] User requests destructive operation
  ↓
[2] System generates confirmation token
  ├─ Valid for 15 minutes
  ├─ One-time use only
  └─ Token hashed for storage (SHA-256)
  ↓
[3] User reviews operation details
  ├─ What: Operation description
  ├─ Why: Context (e.g., account ID)
  └─ Confirm: Yes/No
  ↓
[4] User includes token in confirmation request
  ├─ Token verified
  ├─ Operation validated
  └─ Operation executed
  ↓
[5] Token marked as used
  ├─ Cannot be reused
  ├─ Audit logged
  └─ Operation completed
```

### API Usage

```bash
# 1. Generate confirmation token
POST /api/superadmin/security/confirmation-token
Authorization: Bearer {session_token}
Content-Type: application/json

{
  "operation": "DELETE_ACCOUNT",
  "context": {
    "targetUserId": "550e8400-e29b-41d4-a716-446655440000",
    "reason": "User no longer with company"
  }
}

Response:
{
  "success": true,
  "data": {
    "token": "eyJvcGVyYXRpb24iOiJERUxFVEVfQUNDT1VOVCIsImNyZWF0ZWRBdCI6IjIwMjYtMDEtMTVUMTA6MDA6MDBaIiwicHV0IjoiZGVsZXRlLWFjY291bnQifQ==",
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "expiresAt": "2026-01-15T10:15:00Z",
    "expiresIn": 900
  },
  "warning": "Token valid for 15 minutes. Share securely if needed."
}

# 2. Use token to execute destructive operation
POST /api/superadmin/accounts/{userId}
Authorization: Bearer {session_token}
Content-Type: application/json
X-Confirmation-Token: {token}

{
  "action": "delete"
}

Response:
{
  "success": true,
  "message": "Account deleted"
}
```

---

## Dry-Run Mode

### Purpose

Simulate high-impact operations to verify they will succeed before execution:

1. **Validation**: Check all preconditions
2. **Simulation**: Show what would happen
3. **Planning**: Estimate impact
4. **Prevention**: Catch errors before execution

### API Usage

```bash
# Simulate account deletion
POST /api/superadmin/security/delete-account-dryrun
Authorization: Bearer {session_token}
Content-Type: application/json

{
  "userId": "550e8400-e29b-41d4-a716-446655440000"
}

Response (Success):
{
  "success": true,
  "dryRun": true,
  "message": "Dry-run succeeded. Operation would succeed if executed.",
  "nextStep": "POST /api/superadmin/accounts/{userId} (with confirmation token)",
  "confirmationTokenNeeded": true
}

Response (Failure):
{
  "success": false,
  "dryRun": true,
  "issues": [
    "Target user is not a superadmin",
    "Cannot delete your own account"
  ]
}
```

### Implementation

```typescript
// In superadminSecurityService.ts
export async function executeDryRun(
  operation: string,
  context: Record<string, any>,
  validationFn: (context: Record<string, any>) => Promise<DryRunResult>
): Promise<DryRunResponse> {
  // 1. Run validation without state changes
  const validation = await validationFn(context)

  // 2. Log simulation
  await logDryRunAttempt(operation, context, validation)

  // 3. Return results
  return {
    success: validation.valid,
    issues: validation.issues || []
  }
}
```

---

## Security Event Logging

### Features

- **Immutable**: Cannot be modified after creation
- **Comprehensive**: Logs all security events
- **Correlated**: Tracks user, IP, user agent
- **Audit Trail**: Complete history for compliance

### Events Logged

1. **MFA Events**
   - `MFA_CHALLENGE_CREATED` - New challenge initiated
   - `MFA_VERIFICATION_FAILED` - Code verification failed
   - `MFA_VERIFIED` - Successful verification

2. **Session Events**
   - `SESSION_CREATED` - New session started
   - `SESSION_LOGGED_OUT` - User logout
   - `ALL_SESSIONS_INVALIDATED` - Mass session termination
   - `SESSION_EXPIRED` - TTL expiration

3. **IP Allowlist Events**
   - `IP_ADDED_TO_ALLOWLIST` - IP whitelisted
   - `IP_CHECK_FAILED` - Unauthorized IP access attempt
   - `IP_ALLOWLIST_REQUIRED` - IP allowlist enforced

4. **Rate Limit Events**
   - `RATE_LIMIT_CHECK_FAILED` - Rate limit exceeded
   - `RATE_LIMIT_RESET` - Limit counter cleared

5. **Confirmation Events**
   - `CONFIRMATION_TOKEN_GENERATED` - Token created
   - `CONFIRMATION_VERIFIED` - Token verified
   - `CONFIRMATION_TOKEN_EXPIRED` - Token timeout

6. **Operational Events**
   - `SUPERADMIN_OPERATION_EXECUTED` - Action completed
   - `DRY_RUN_EXECUTED` - Simulation performed

### Event Structure

```json
{
  "id": 12345,
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "eventType": "MFA_VERIFIED",
  "details": {
    "method": "TOTP",
    "sessionId": "660e8400-e29b-41d4-a716-446655440001"
  },
  "severity": "INFO",
  "ipAddress": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "loggedAt": "2026-01-15T10:00:00Z"
}
```

---

## Security Configuration Reference

### environment.ts Settings

```typescript
// MFA Configuration
security: {
  mfaEnabled: true,
  mfaRequired: NODE_ENV === 'production',
  mfaMethods: ['TOTP', 'SMS', 'EMAIL'],
  mfaChallengeExpirationSeconds: 600,    // 10 minutes
  mfaMaxAttempts: 5,
  mfaCodeLength: 6
}

// Session Configuration
security: {
  sessionTTL: {
    production: 15 * 60 * 1000,   // 15 minutes
    staging: 60 * 60 * 1000,      // 60 minutes
    development: 120 * 60 * 1000  // 120 minutes
  },
  sessionWarningThreshold: 0.75   // Warn at 75% TTL
}

// IP Allowlist Configuration
security: {
  ipAllowlistEnabled: true,
  ipAllowlistDefaultExpirationDays: 30,
  ipAllowlistMaxExpirationDays: 365
}

// Rate Limiting Configuration
security: {
  rateLimits: {
    destructiveActionsPerHour: 5,
    windowSeconds: 3600
  }
}

// Confirmation Token Configuration
security: {
  confirmationTokenTTLSeconds: 900,  // 15 minutes
  requireConfirmationFor: [
    'DELETE_ACCOUNT',
    'SESSION_INVALIDATION',
    'DECOMMISSION_TENANT'
  ]
}
```

---

## Testing Procedures

### 1. MFA Flow Testing

```bash
# Test TOTP challenge
curl -X POST http://localhost:3001/api/superadmin/security/mfa/challenge \
  -H "Authorization: Bearer {jwt_token}" \
  -H "Content-Type: application/json" \
  -d '{"method": "TOTP"}'

# Capture challengeId from response, then verify
curl -X POST http://localhost:3001/api/superadmin/security/mfa/verify \
  -H "Authorization: Bearer {jwt_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "challengeId": "550e8400-e29b-41d4-a716-446655440000",
    "code": "123456"
  }'
```

### 2. Session Management Testing

```bash
# After MFA verification, capture sessionId and token
# List active sessions
curl -X GET http://localhost:3001/api/superadmin/security/sessions \
  -H "Authorization: Bearer {session_token}"

# Test session expiration by waiting 15+ minutes in production
# Test session TTL warning by waiting 11+ minutes in production
```

### 3. IP Allowlist Testing

```bash
# Add IP to allowlist
curl -X POST http://localhost:3001/api/superadmin/security/ip-allowlist \
  -H "Authorization: Bearer {session_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "ipAddress": "203.0.113.45",
    "description": "Test IP",
    "expirationDays": 30
  }'

# Test access from different IP
# Should fail with "IP not allowlisted" if ipAllowlistEnabled = true
```

### 4. Rate Limiting Testing

```bash
# Perform 5 destructive operations rapidly
# 6th operation should fail with "Rate limit exceeded"
```

### 5. Confirmation Token Testing

```bash
# Generate confirmation token
curl -X POST http://localhost:3001/api/superadmin/security/confirmation-token \
  -H "Authorization: Bearer {session_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "DELETE_ACCOUNT",
    "context": {"targetUserId": "550e8400-e29b-41d4-a716-446655440000"}
  }'

# Use token in destructive operation
# Try to reuse token - should fail
```

### 6. Dry-Run Testing

```bash
# Test dry-run of account deletion
curl -X POST http://localhost:3001/api/superadmin/security/delete-account-dryrun \
  -H "Authorization: Bearer {session_token}" \
  -H "Content-Type: application/json" \
  -d '{"userId": "550e8400-e29b-41d4-a716-446655440000"}'

# Should return success without deleting account
# Verify logs show dry-run simulation
```

---

## Monitoring & Auditing

### Security Event Query Examples

```sql
-- List all MFA verification failures in last hour
SELECT * FROM security_event_logs
WHERE event_type = 'MFA_VERIFICATION_FAILED'
AND logged_at > NOW() - INTERVAL '1 hour'
ORDER BY logged_at DESC;

-- List all rate limit violations
SELECT * FROM security_event_logs
WHERE event_type = 'RATE_LIMIT_CHECK_FAILED'
ORDER BY logged_at DESC;

-- List unauthorized IP access attempts
SELECT * FROM security_event_logs
WHERE event_type = 'IP_CHECK_FAILED'
AND logged_at > NOW() - INTERVAL '24 hours'
ORDER BY logged_at DESC;

-- Audit trail for specific user
SELECT * FROM security_event_logs
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY logged_at DESC;

-- All destructive operations
SELECT * FROM security_event_logs
WHERE severity = 'WARNING'
AND logged_at > NOW() - INTERVAL '7 days'
ORDER BY logged_at DESC;
```

---

## Best Practices

### For Administrators

1. **Use TOTP for MFA**
   - More secure than SMS/EMAIL
   - Works offline
   - No dependency on SMS provider

2. **Rotate Session IPs**
   - Add office IPs to allowlist
   - Remove expired entries
   - Test with new IP before adding

3. **Monitor Security Events**
   - Review MFA failures weekly
   - Investigate rate limit violations
   - Check unauthorized IP attempts

4. **Test Before Production**
   - Use dry-run mode for new operations
   - Verify confirmation tokens work
   - Check IP allowlist rules

### For Operations

1. **Generate confirmation tokens securely**
   - Don't log tokens in clear text
   - Share via secure channels
   - Destroy after use

2. **Monitor session usage**
   - List active sessions regularly
   - Invalidate compromised sessions immediately
   - Track unusual patterns

3. **Audit immutable logs**
   - Logs cannot be modified
   - Enable external archival
   - Set up retention policies

### For Security

1. **MFA Enforcement**
   - Enabled by default in production
   - Disable for development only
   - Audit non-MFA access

2. **Session Timeouts**
   - 15 minutes in production (strict)
   - Warning at 75% TTL (11 min 15 sec)
   - User must re-authenticate

3. **Rate Limiting**
   - 5 destructive actions per hour
   - Covers DELETE, RESET, INVALIDATE, INCIDENT
   - Logged for audit trail

---

## Troubleshooting

### MFA Issues

**Problem**: "MFA verification failed"
- Check that 6-digit code is correct
- Verify challenge hasn't expired (10 min TTL)
- Check that no more than 5 attempts used
- Solution: Generate new challenge

**Problem**: "MFA not required"
- MFA is optional in development mode
- Check NODE_ENV setting
- MFA forced in production only
- Solution: Enable `config.security.mfaRequired = true`

### Session Issues

**Problem**: "Session expired"
- Sessions only valid for 15 min (prod), 60 min (staging), 120 min (dev)
- Check current time vs session expiration
- Solution: Re-authenticate with MFA to get new session

**Problem**: "IP not allowlisted"
- IP allowlist enabled but IP not whitelisted
- Check current IP address
- Add IP via /api/superadmin/security/ip-allowlist
- Solution: Add IP or disable allowlist

### Rate Limiting Issues

**Problem**: "Rate limit exceeded"
- 5 destructive operations already performed in last hour
- Check /api/superadmin/security/status for current limits
- Solution: Wait for window to reset or contact admin

---

## Files Created

1. **superadminSecurityService.ts** (700+ lines)
   - MFA, sessions, IP allowlist, rate limiting, confirmation tokens, dry-run, logging

2. **superadminSecurityMiddleware.ts** (400+ lines)
   - 7 middleware functions + error handler

3. **superadmin-security-hardening.ts** (850+ lines)
   - 15 API endpoints for all security features

4. **006_superadmin_security_tables.sql** (200+ lines)
   - 7 new database tables + triggers + indices

5. **SUPERADMIN_SECURITY_HARDENING.md** (this document)
   - Comprehensive reference guide

---

## Integration Checklist

- [x] Service layer (superadminSecurityService.ts)
- [x] Middleware layer (superadminSecurityMiddleware.ts)
- [x] Security hardening routes (superadmin-security-hardening.ts)
- [x] Database migrations (006_superadmin_security_tables.sql)
- [x] Documentation (this guide)
- [ ] Mount routes in index.ts
- [ ] Run database migrations
- [ ] Test in dev/staging/production
- [ ] Update frontend to use new endpoints
- [ ] Deploy to production

---

## Next Steps

1. **Mount Routes**: Update index.ts to include new routes
2. **Run Migrations**: Execute database migration script
3. **Test Thoroughly**: Follow testing procedures
4. **Update Frontend**: Use new MFA and security endpoints
5. **Deploy**: Roll out to staging/production
6. **Monitor**: Track security event logs

---

## References

- [PHASE 3, STEP 3.1 — Eliminate Production Scripts](../PHASE_3_STEP_3_1.md)
- [Time Authority Service (PHASE 2.2)](../PHASE_2_STEP_2_2.md)
- [API Documentation](../API_DOCUMENTATION.md)
- [Database Schema](../DATABASE_SCHEMA.md)

