# TENANT BOUNDARY ENFORCEMENT — QUICK REFERENCE

**Status**: ✅ Ready for Integration | **Last Updated**: February 4, 2026

---

## 🎯 Core Principle

> Every request must resolve tenant context explicitly.
> Cross-tenant access is impossible by construction.

---

## 🚀 Quick Start: Add Tenant Isolation to a Route

### Before (Vulnerable)
```typescript
router.get('/students', async (req, res) => {
  const students = await query('SELECT * FROM students')
  res.json(students)
})
```

### After (Secure)
```typescript
router.get(
  '/students',
  authenticateToken,                  // ← Verify JWT
  enforceTenantBoundaries,           // ← Extract tenant
  async (req: TenantAwareRequest, res) => {
    const students = await TenantIsolationService.listRecordsByTenant(
      req.tenant!,                   // ← Use tenant context
      'students'
    )
    res.json({ data: students.records })
  }
)
```

---

## 📦 Import Checklist

```typescript
// 1. Types
import type { TenantAwareRequest, TenantContext } from '../types/tenantContext.js'

// 2. Service layer
import { TenantIsolationService } from '../services/tenantIsolationService.js'

// 3. Query builder (optional)
import { TenantQuery } from '../services/tenantQueryBuilder.js'

// 4. Middleware
import { authenticateToken } from '../auth/middleware.js'
import { enforceTenantBoundaries, withTenantErrorHandling } from '../auth/tenantEnforcementMiddleware.js'
```

---

## 🔧 Five Essential Operations

### 1. Get One Record
```typescript
const student = await TenantIsolationService.getRecordByIdAndTenant(
  tenant, 'students', studentId
)
// Throws if not found or wrong tenant
```

### 2. List Records
```typescript
const result = await TenantIsolationService.listRecordsByTenant(
  tenant, 'students', { limit: 20, offset: 0 }
)
// result.records, result.total, result.count
```

### 3. Create Record
```typescript
const student = await TenantIsolationService.insertRecordWithTenant(
  tenant, 'students', { student_id: 'S1', first_name: 'John' }
)
// platform_id automatically set to tenant
```

### 4. Update Record
```typescript
const updated = await TenantIsolationService.updateRecordWithTenant(
  tenant, 'students', studentId, { first_name: 'Jane' }
)
// Throws if student doesn't belong to tenant
```

### 5. Delete Record
```typescript
const deleted = await TenantIsolationService.deleteRecordWithTenant(
  tenant, 'students', studentId
)
// Throws if student doesn't belong to tenant
```

---

## 🏗️ Route Template

```typescript
import { Router, Request, Response } from 'express'
import { authenticateToken } from '../auth/middleware.js'
import { enforceTenantBoundaries, withTenantErrorHandling } from '../auth/tenantEnforcementMiddleware.js'
import { TenantIsolationService } from '../services/tenantIsolationService.js'
import type { TenantAwareRequest } from '../types/tenantContext.js'

const router = Router()

// Get all
router.get(
  '/students',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) return res.status(401).json({ error: 'Tenant required' })

    const result = await TenantIsolationService.listRecordsByTenant(
      req.tenant, 'students', { limit: 20 }
    )
    res.json({ data: result.records, total: result.total })
  })
)

// Get one
router.get(
  '/students/:id',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) return res.status(401).json({ error: 'Tenant required' })

    const student = await TenantIsolationService.getRecordByIdAndTenant(
      req.tenant, 'students', req.params.id
    )
    res.json({ data: student })
  })
)

// Create
router.post(
  '/students',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) return res.status(401).json({ error: 'Tenant required' })

    const student = await TenantIsolationService.insertRecordWithTenant(
      req.tenant, 'students', req.body
    )
    res.status(201).json({ data: student })
  })
)

// Update
router.put(
  '/students/:id',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) return res.status(401).json({ error: 'Tenant required' })

    const student = await TenantIsolationService.updateRecordWithTenant(
      req.tenant, 'students', req.params.id, req.body
    )
    res.json({ data: student })
  })
)

// Delete
router.delete(
  '/students/:id',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) return res.status(401).json({ error: 'Tenant required' })

    await TenantIsolationService.deleteRecordWithTenant(
      req.tenant, 'students', req.params.id
    )
    res.json({ message: 'Deleted' })
  })
)

export default router
```

---

## 🔍 TenantQuery Builder

### Simple Filters
```typescript
const users = await TenantQuery.from('users')
  .where('role_id', 'admin')
  .withTenant(tenant)
  .execute()
```

### Multiple Conditions
```typescript
const students = await TenantQuery.from('students')
  .where('department_id', deptId)
  .where('status', 'active')
  .orderBy('last_name ASC')
  .limit(50)
  .withTenant(tenant)
  .execute()
```

### IN Clause
```typescript
const students = await TenantQuery.from('students')
  .whereIn('id', ['id1', 'id2', 'id3'])
  .withTenant(tenant)
  .execute()
```

### Pagination
```typescript
const page = 1
const pageSize = 20

const result = await TenantQuery.from('students')
  .limit(pageSize)
  .offset((page - 1) * pageSize)
  .withTenant(tenant)
  .execute()

const total = await TenantQuery.from('students')
  .withTenant(tenant)
  .count()
```

---

## ⚡ Common Patterns

### Pattern: Get Resource or 404
```typescript
try {
  const student = await TenantIsolationService.getRecordByIdAndTenant(
    tenant, 'students', id
  )
  res.json({ data: student })
} catch (error: any) {
  res.status(404).json({ error: 'Not found' })
}
```

### Pattern: Create with Validation
```typescript
if (!body.student_id) {
  return res.status(400).json({ error: 'student_id required' })
}

const student = await TenantIsolationService.insertRecordWithTenant(
  tenant, 'students', {
    student_id: body.student_id,
    first_name: body.first_name,
    last_name: body.last_name
  }
)
res.status(201).json({ data: student })
```

### Pattern: Conditional Update
```typescript
let updates: any = {}
if (body.first_name) updates.first_name = body.first_name
if (body.last_name) updates.last_name = body.last_name
if (body.email) updates.email = body.email

if (Object.keys(updates).length === 0) {
  return res.status(400).json({ error: 'No fields to update' })
}

const student = await TenantIsolationService.updateRecordWithTenant(
  tenant, 'students', id, updates
)
res.json({ data: student })
```

### Pattern: Bulk Operations
```typescript
const { TenantBulkOperation } = await import(
  '../services/tenantQueryBuilder.js'
)

const bulkOp = new TenantBulkOperation(tenant)
const { inserted, records } = await bulkOp.insertMany(
  'students',
  body.students
)

res.status(201).json({
  imported: inserted,
  records
})
```

---

## ❌ Never Do This

| ❌ Wrong | ✅ Right |
|---------|---------|
| `query('SELECT * FROM students')` | `TenantIsolationService.listRecordsByTenant(tenant, 'students')` |
| `{ platform_id: req.body.platform_id }` | Automatically forced by service |
| Skip `enforceTenantBoundaries` | Always include middleware |
| Trust user's tenant ID | Always use authenticated tenant |
| Raw DELETE without verification | Use `deleteRecordWithTenant` |
| Skip error handling | Handle 'not found' and 'access denied' |

---

## 🧪 Testing

### Test File Template
```typescript
describe('Tenant Isolation', () => {
  let tenant1: TenantContext
  let tenant2: TenantContext
  let student1: any
  let student2: any

  beforeEach(async () => {
    // Setup two tenants
    tenant1 = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      roleId: 'role-1',
      ip: '127.0.0.1',
      userAgent: 'test'
    }
    tenant2 = {
      tenantId: 'tenant-2',
      userId: 'user-2',
      roleId: 'role-2',
      ip: '127.0.0.1',
      userAgent: 'test'
    }

    // Create students in each tenant
    student1 = await TenantIsolationService.insertRecordWithTenant(
      tenant1, 'students', { student_id: 's1' }
    )
    student2 = await TenantIsolationService.insertRecordWithTenant(
      tenant2, 'students', { student_id: 's2' }
    )
  })

  test('Tenant1 cannot see Tenant2 students', async () => {
    const students = await TenantIsolationService.listRecordsByTenant(
      tenant1, 'students'
    )
    expect(students.records).toContainEqual(student1)
    expect(students.records).not.toContainEqual(student2)
  })

  test('Tenant1 cannot update Tenant2 students', async () => {
    await expect(
      TenantIsolationService.updateRecordWithTenant(
        tenant1, 'students', student2.id, { first_name: 'Hacked' }
      )
    ).rejects.toThrow('not found or access denied')
  })

  test('Tenant1 cannot delete Tenant2 students', async () => {
    await expect(
      TenantIsolationService.deleteRecordWithTenant(
        tenant1, 'students', student2.id
      )
    ).rejects.toThrow('not found or access denied')
  })
})
```

---

## 🐛 Debugging

### Log Tenant Context
```typescript
console.log('Tenant:', req.tenant?.tenantId)
console.log('User:', req.tenant?.userId)
console.log('Role:', req.tenant?.roleId)
```

### Debug Query
```typescript
const query = TenantQuery.from('students')
  .where('status', 'active')
  .withTenant(tenant)

console.log('SQL:', query.toSQL())
console.log('Params:', query.debug())
```

### Verify Service Method
```typescript
try {
  const result = await TenantIsolationService.getRecordByIdAndTenant(
    tenant, 'students', studentId
  )
} catch (error) {
  console.error('Error message:', error.message)
  // "students record not found or access denied"
}
```

---

## 📊 Tenant-Enabled Tables

All these tables automatically support tenant isolation:

**School**: students, faculty, school_departments, semesters, courses, class_schedules, school_attendance, student_face_embeddings, student_profile_picture_embeddings

**Corporate**: employees, corporate_departments, employee_shifts, locations, corporate_checkins

**Core**: users, roles, audit_logs

**Security**: superadmin_sessions, mfa_challenges, ip_allowlist, rate_limits, confirmation_tokens, dry_run_logs, security_event_logs

---

## ⚙️ Configuration

Tenant context resolution is automatic from JWT token:
- Uses `platformId` from JWT payload
- Validates UUID format
- Sets on `req.tenant` via middleware

No additional configuration needed!

---

## 📞 Support

**Q: How to migrate existing route?**
A: Replace raw `query()` calls with `TenantIsolationService` methods. Add middleware.

**Q: How to test tenant isolation?**
A: Create two tenants, insert records, verify queries don't leak data.

**Q: Can I mix old and new code?**
A: Yes, but new code must use tenant service. Old code is vulnerable.

**Q: Performance impact?**
A: Minimal. One additional WHERE clause per query. Indices handle filtering.

---

**Status**: ✅ Ready for Production | **Support**: Full documentation available

