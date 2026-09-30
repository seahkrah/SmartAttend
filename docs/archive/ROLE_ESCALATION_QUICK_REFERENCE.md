# PHASE 4, STEP 4.2: ROLE ESCALATION DETECTION - QUICK REFERENCE

## 🚀 Quick Start

### Import & Use the Service

```typescript
import { RoleAssignmentHistoryService } from '../services/roleEscalationDetectionService.js'
import {
  enforceRoleRevalidation,
  enforceRoleChangeLogging,
  blockSilentRoleChanges,
  forceRoleRevalidationOnSuspicion
} from '../auth/roleRevalidationMiddleware.js'
```

### Mount Middleware (Already Done)

```typescript
app.use(enforceRoleRevalidation)      // Check pending revalidations
app.use(enforceRoleChangeLogging)     // Attach logging function
app.use(blockSilentRoleChanges)       // Prevent silent changes
app.use(injectRoleValidationStatus)   // Add validation status
```

---

## 📋 Core Operations Cheat Sheet

### 1. LOG A ROLE CHANGE (Mandatory)

```typescript
// In route handler, req.roleChangeLogger is available
const result = await req.roleChangeLogger({
  userId: 'user-123',
  previousRoleId: 'role-user',
  newRoleId: 'role-admin',
  changedByUserId: 'admin-user-id',
  changeReason: 'Promotion to team lead',
  changeSource: 'api'
})

// Result contains:
// - historyId: Unique log entry
// - escalation.requiresRevalidation: true/false
// - escalation.severity: 'low' | 'medium' | 'high' | 'critical'
// - escalation.reasons: ['reason1', 'reason2']
// - timestamp: When logged
```

**Guarantee**: ✅ Every role change logged (cannot be bypassed)

---

### 2. DETECT ESCALATION (5-Point Algorithm)

```typescript
const escalation = await RoleAssignmentHistoryService.detectEscalation(
  tenant,
  userId,
  previousRoleId,
  newRoleId
)

// Check results:
if (escalation.severity === 'critical') {
  // Examples: superadmin jump, multiple violations
  // Action: Block requests until revalidated
  console.warn('CRITICAL escalation detected!')
}

if (escalation.isAnomalous) {
  console.log('Anomalies detected:', escalation.reasons)
  // Reasons might include:
  // - "Superadmin role assignment detected"
  // - "Privilege elevation: +8 permissions"
  // - "Timing anomaly: 3 role changes in 1 hour"
  // - "Rule violation: Admin cannot promote to superadmin"
  // - "Permission jump: 7 new permissions granted"
}
```

**Detection Points**:
| Check | Trigger | Severity |
|-------|---------|----------|
| Privilege Elevation | Jump > 5 permissions | HIGH |
| Superadmin Jump | To superadmin role | **CRITICAL** |
| Timing Anomaly | 3+ changes in 1 hour | MEDIUM |
| Rules Violation | Breaks assignment rule | HIGH |
| Permission Jump | 5+ new permissions | HIGH |

---

### 3. FORCE REVALIDATION (Immediate)

```typescript
// Manual revalidation
const result = await RoleAssignmentHistoryService.revalidateUserRole(
  tenant,
  userId,
  initiatedByUserId
)

if (!result.isValid) {
  console.log('Role invalid:', result.issues)
  // Issues might be: user inactive, role deleted, etc.
}

// Or force queue for revalidation
await forceRoleRevalidationOnSuspicion(
  tenant,
  userId,
  'Suspicious activity detected',
  'critical' // CRITICAL = blocks requests
)
```

**Priority Behavior**:
- **CRITICAL**: 🛑 Blocks requests (403) until revalidated
- **HIGH**: ⚠️ Flagged but requests allowed
- **NORMAL**: ⏳ Processed asynchronously
- **LOW**: 📅 Processed when idle

---

### 4. GET REVALIDATION QUEUE

```typescript
// Get all pending revalidations
const pending = await RoleAssignmentHistoryService.getPendingRevalidations(
  tenant
)

// Filter by priority
const critical = await RoleAssignmentHistoryService.getPendingRevalidations(
  tenant,
  'critical'
)

// Process batch (background job)
const stats = await processPendingRevalidations(tenant, 10)
console.log(`Processed: ${stats.processed}, Valid: ${stats.valid}, Invalid: ${stats.invalid}`)
```

---

### 5. GET AUDIT TRAIL

```typescript
// Get user's role change history
const history = await RoleAssignmentHistoryService.getUserRoleHistory(
  tenant,
  userId,
  50 // limit
)

// Filter
const escalations = history.filter(h => h.is_escalation)
const anomalies = history.filter(h => h.is_anomalous)

// Example entry:
// {
//   id: 'hist-123',
//   user_id: 'user-123',
//   previous_role_id: 'role-user',
//   new_role_id: 'role-admin',
//   changed_by_user_id: 'super-123',
//   change_reason: 'Promotion',
//   is_escalation: false,
//   is_anomalous: false,
//   created_at: '2026-02-06T10:00:00Z'
// }
```

---

### 6. ESCALATION EVENTS (Security Review)

```typescript
// Get unresolved escalations
const events = await RoleAssignmentHistoryService.getEscalationEvents(
  tenant,
  {
    unresolved: true,
    severity: 'critical',
    limit: 100
  }
)

// Group by severity
const critical = events.filter(e => e.severity === 'critical')
const high = events.filter(e => e.severity === 'high')
const medium = events.filter(e => e.severity === 'medium')

// Resolve an event
await RoleAssignmentHistoryService.resolveEscalationEvent(
  tenant,
  eventId,
  'authorized', // or 'confirmed', 'false_alarm'
  'Authorized promotion, user was due for raise',
  resolvedByUserId
)
```

---

### 7. APPROVAL WORKFLOW

```typescript
// Check if approval needed
const { requiresApproval } = await RoleAssignmentHistoryService.requiresApproval(
  tenant,
  fromRoleId,
  toRoleId
)

if (requiresApproval) {
  // Request approval
  const approval = await RoleAssignmentHistoryService.requestRoleApproval(
    tenant,
    userId,
    requestedRoleId,
    requestedByUserId,
    'This person was promoted'
  )

  // Gets approval status: pending → approved/rejected
}

// Get pending approvals
const pending = await RoleAssignmentHistoryService.getPendingApprovals(tenant)

// Approve
await RoleAssignmentHistoryService.approveRoleAssignment(
  tenant,
  approvalId,
  approvedByUserId
)

// Reject
await RoleAssignmentHistoryService.rejectRoleAssignment(
  tenant,
  approvalId,
  approvedByUserId,
  'Not authorized for this role'
)
```

---

## 🛡️ Security Guarantees

| Guarantee | How | Verified By |
|-----------|-----|-------------|
| ✅ No silent changes | enforceRoleChangeLogging middleware | Middleware + Service |
| ✅ No escalation hiding | 5-point detection algorithm | Service layer |
| ✅ No history tampering | Immutability triggers on DB | PostgreSQL |
| ✅ No unauthorized approval | Approval workflow | Service layer |
| ✅ No revalidation bypass | Priority-based request blocking | Middleware |

---

## 🔍 Troubleshooting

### Role change not being logged

```typescript
// Check if middleware is active
// ✅ Should have: app.use(enforceRoleChangeLogging)

// Check if req.roleChangeLogger exists
if (!req.roleChangeLogger) {
  console.error('Logger not attached!')
  return res.status(500).json({ error: 'Logger not available' })
}
```

### Escalation not detected

```typescript
// Make sure to call detectEscalation
const escalation = await RoleAssignmentHistoryService.detectEscalation(...)

// Or it's called automatically in logRoleChange
const result = await req.roleChangeLogger({...})
// result.escalation contains detection results
```

### User not being blocked for critical revalidation

```typescript
// Check middleware is active
// ✅ Should have: app.use(enforceRoleRevalidation)

// Verify priority is 'critical'
await forceRoleRevalidationOnSuspicion(tenant, userId, reason, 'critical')

// Check queue
const pending = await RoleAssignmentHistoryService.getPendingRevalidations(
  tenant,
  'critical'
)
```

### History table empty

```typescript
// Check migration ran
SELECT * FROM migrations WHERE name = '007_role_escalation_detection.sql'

// Verify tables exist
SELECT tablename FROM pg_tables 
WHERE tablename LIKE 'role_%'

// Check middleware logging
// Middleware should call req.roleChangeLogger on role changes
```

---

## 📊 Database Tables

| Table | Purpose | Rows | Immutable? |
|-------|---------|------|-----------|
| `role_assignment_history` | Every role change logged | ↑ grows | ✅ YES |
| `role_escalation_events` | Detected anomalies | ↑ varies | ✅ YES |
| `role_revalidation_queue` | Users needing revalidation | ↑ varies | ❌ NO |
| `role_change_audit_log` | Complete audit trail | ↑ grows | ❌ NO |
| `role_assignment_rules` | Assignment patterns | Fixed | ❌ NO |
| `role_assignment_approvals` | Approval requests | ↑ grows | ❌ NO |

---

## 🚨 Alert Scenarios

### Scenario 1: Superadmin Jump

```typescript
// Triggered when: user → superadmin
// Severity: CRITICAL
// Response: User requests blocked immediately
// Actions:
// 1. Create CRITICAL revalidation queue entry
// 2. Alert security team
// 3. Log as escalation_event
// 4. Require manual authorization
```

### Scenario 2: Timing Anomaly

```typescript
// Triggered when: 3+ role changes in 1 hour
// Severity: MEDIUM
// Response: Flagged but requests allowed
// Actions:
// 1. Create MEDIUM revalidation queue entry
// 2. Alert security team
// 3. Queue for background revalidation
```

### Scenario 3: Rules Violation

```typescript
// Triggered when: Assignment breaks configured rule
// Severity: HIGH
// Response: Blocked until approved
// Actions:
// 1. Create HIGH revalidation queue entry
// 2. Request approval from authorized users
// 3. Block change until approved
```

---

## 🔧 Configuration

### Default Thresholds

```typescript
// In detectEscalation():
const PRIVILEGE_ESCALATION_THRESHOLD = 5        // permissions
const TIMING_ANOMALY_WINDOW = 3600000            // 1 hour
const TIMING_ANOMALY_COUNT_THRESHOLD = 2         // 2+ changes
const PERMISSION_JUMP_THRESHOLD = 5              // permissions
```

### Customize Via Role Assignment Rules

```sql
-- Allow role A to promote to role B
INSERT INTO role_assignment_rules (
  platform_id, rule_name, from_role_id, to_role_id,
  is_allowed, requires_approval
) VALUES (
  'platform-id', 'user->admin promotion', 'role-user', 'role-admin',
  true, true -- requires approval
)

-- Forbid role A to promote to role C
INSERT INTO role_assignment_rules (
  platform_id, rule_name, from_role_id, to_role_id,
  is_allowed, requires_approval
) VALUES (
  'platform-id', 'user cannot jump to superadmin', 'role-user', 'role-superadmin',
  false, true -- not allowed, requires approval to override
)
```

---

## 📈 Monitoring

### Check System Health

```typescript
// Get escalation event counts
const events = await RoleAssignmentHistoryService.getEscalationEvents(tenant, {})
console.log('Total escalations:', events.length)
console.log('Unresolved:', events.filter(e => !e.is_resolved).length)

// Get pending revalidations
const pending = await RoleAssignmentHistoryService.getPendingRevalidations(tenant)
console.log('Pending revalidations:', pending.length)

// Get recent role changes
const recent = await RoleAssignmentHistoryService.getUserRoleHistory(
  tenant,
  userId,
  100
)
console.log('Recent changes:', recent.length)
```

### Generate Report

```typescript
async function generateSecurityReport(tenant) {
  const escalations = await RoleAssignmentHistoryService.getEscalationEvents(tenant, {})
  const pending = await RoleAssignmentHistoryService.getPendingRevalidations(tenant)
  const approvals = await RoleAssignmentHistoryService.getPendingApprovals(tenant)

  return {
    totalEscalations: escalations.length,
    unresolvedEscalations: escalations.filter(e => !e.is_resolved).length,
    escByGravity: {
      critical: escalations.filter(e => e.severity === 'critical').length,
      high: escalations.filter(e => e.severity === 'high').length,
      medium: escalations.filter(e => e.severity === 'medium').length,
      low: escalations.filter(e => e.severity === 'low').length
    },
    pendingRevalidations: pending.length,
    pendingApprovals: approvals.filter(a => a.approval_status === 'pending').length,
    generatedAt: new Date().toISOString()
  }
}
```

---

## 💡 Common Patterns

### Pattern: Require Approval for Executive Roles

```typescript
// In route handler
router.put('/users/:userId/role/executive', async (req, res) => {
  const { newRoleId } = req.body

  // Check if approval needed
  const { requiresApproval } = await RoleAssignmentHistoryService.requiresApproval(
    req.tenant,
    req.user.currentRoleId,
    newRoleId
  )

  if (requiresApproval) {
    // Create approval request (returns 202 Accepted)
    const approval = await RoleAssignmentHistoryService.requestRoleApproval(
      req.tenant,
      userId,
      newRoleId,
      req.user.userId
    )

    return res.status(202).json({
      status: 'approval_pending',
      approvalId: approval.id
    })
  }

  // Log and perform the change
  const result = await req.roleChangeLogger({...})
  await updateUserRole(userId, newRoleId)

  res.json({ success: true })
})
```

### Pattern: Background Revalidation

```typescript
// Background job (runs every 5 minutes)
setInterval(async () => {
  const tenants = await getAllTenants()

  for (const tenant of tenants) {
    const stats = await processPendingRevalidations(tenant, 50)

    if (stats.invalid > 0) {
      // Alert: Users with invalid roles
      await notifySecurityTeam({
        message: `${stats.invalid} users have invalid roles`,
        tenantId: tenant.id
      })
    }
  }
}, 300000) // 5 minutes
```

### Pattern: Suspicious Activity Response

```typescript
// When suspicious activity detected
async function handleSuspiciousActivity(tenant, userId, reason) {
  // 1. Force critical revalidation
  await forceRoleRevalidationOnSuspicion(
    tenant,
    userId,
    reason,
    'critical'
  )

  // 2. Get current role history
  const history = await RoleAssignmentHistoryService.getUserRoleHistory(
    tenant,
    userId,
    10
  )

  // 3. Check for recent escalations
  const recentEscalations = history.filter(h => h.is_escalation)

  // 4. Alert security team
  if (recentEscalations.length > 0) {
    await notifySecurityTeam({
      severity: 'high',
      userId,
      recentEscalations,
      reason
    })
  }

  // 5. User requests will be blocked until revalidated
}
```

---

## 📝 API Response Examples

### Log Role Change Response

```json
{
  "success": true,
  "userId": "user-123",
  "previousRoleId": "role-user",
  "newRoleId": "role-admin",
  "changeId": "hist-456",
  "escalationDetected": false,
  "escalationDetails": {
    "isEscalation": false,
    "severity": "low",
    "reasons": []
  }
}
```

### Escalation Detected Response

```json
{
  "success": true,
  "userId": "user-123",
  "changeId": "hist-789",
  "escalationDetected": true,
  "escalationDetails": {
    "isEscalation": true,
    "severity": "critical",
    "escalationType": "superadmin_jump",
    "requiresRevalidation": true,
    "reasons": [
      "Superadmin role assignment detected",
      "Direct jump from user to superadmin"
    ]
  }
}
```

### Revalidation Status in Response

```json
{
  "userId": "user-123",
  "name": "John Doe",
  "roleId": "role-admin",
  "_roleValidation": {
    "roleId": "role-admin",
    "roleName": "Administrator",
    "status": "valid",
    "requiresRevalidation": true,
    "recentEscalationDetected": false,
    "validatedAt": "2026-02-06T10:00:00Z"
  }
}
```

### Blocked by Critical Revalidation

```json
{
  "error": "User role requires revalidation",
  "statusCode": 403,
  "revalidationRequired": true,
  "revalidationDetails": {
    "priority": "critical",
    "reason": "Superadmin role assignment requires revalidation",
    "mustCompleteBy": "2026-02-06T11:00:00Z"
  }
}
```

---

**Reference Version**: 1.0  
**Last Updated**: February 6, 2026  
**Status**: ✅ COMPLETE
