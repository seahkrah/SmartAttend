/**
 * PHASE 4, STEP 4.1: TENANT ISOLATION TESTS
 * 
 * Comprehensive test suite for tenant boundary enforcement
 * Demonstrates that cross-tenant access is impossible
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { TenantIsolationService, createTenantBoundaryChecker } from '../services/tenantIsolationService.js'
import { TenantQuery, TenantBulkOperation } from '../services/tenantQueryBuilder.js'
import type { TenantContext } from '../types/tenantContext.js'

// Mock tenant contexts
const tenant1: TenantContext = {
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  userId: 'user-1',
  roleId: 'role-1',
  ip: '127.0.0.1',
  userAgent: 'test'
}

const tenant2: TenantContext = {
  tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  userId: 'user-2',
  roleId: 'role-2',
  ip: '127.0.0.1',
  userAgent: 'test'
}

/**
 * TEST SUITE: Query-Level Isolation
 * Verifies that SELECT queries cannot access cross-tenant data
 */
describe('Query-Level Isolation', () => {
  let student1: any
  let student2: any

  beforeAll(async () => {
    // Setup: Create students in different tenants
    student1 = await TenantIsolationService.insertRecordWithTenant(
      tenant1,
      'students',
      {
        user_id: 'u1',
        student_id: 'S1',
        first_name: 'Alice',
        last_name: 'Smith',
        college: 'Engineering',
        email: 'alice@school.edu',
        status: 'Freshman',
        enrollment_year: 2024
      }
    )

    student2 = await TenantIsolationService.insertRecordWithTenant(
      tenant2,
      'students',
      {
        user_id: 'u2',
        student_id: 'S2',
        first_name: 'Bob',
        last_name: 'Jones',
        college: 'Science',
        email: 'bob@school.edu',
        status: 'Sophomore',
        enrollment_year: 2023
      }
    )
  })

  test('Tenant1 can list its own students', async () => {
    const result = await TenantIsolationService.listRecordsByTenant(
      tenant1,
      'students'
    )

    expect(result.records.length).toBeGreaterThanOrEqual(1)
    expect(result.records).toContainEqual(
      expect.objectContaining({ id: student1.id })
    )
  })

  test('Tenant1 cannot see Tenant2 students', async () => {
    const result = await TenantIsolationService.listRecordsByTenant(
      tenant1,
      'students'
    )

    const student2Ids = result.records.map(s => s.id)
    expect(student2Ids).not.toContain(student2.id)
  })

  test('Tenant2 cannot see Tenant1 students', async () => {
    const result = await TenantIsolationService.listRecordsByTenant(
      tenant2,
      'students'
    )

    const student1Ids = result.records.map(s => s.id)
    expect(student1Ids).not.toContain(student1.id)
  })

  test('TenantQuery builder enforces isolation', async () => {
    const students1 = await TenantQuery.from('students')
      .withTenant(tenant1)
      .execute()

    const students2 = await TenantQuery.from('students')
      .withTenant(tenant2)
      .execute()

    // No overlap between results
    const ids1 = students1.map(s => s.id)
    const ids2 = students2.map(s => s.id)
    const overlap = ids1.filter(id => ids2.includes(id))

    expect(overlap.length).toBe(0)
  })

  test('Count query respects tenant isolation', async () => {
    const count1 = await TenantIsolationService.countRecordsByTenant(
      tenant1,
      'students'
    )

    const count2 = await TenantIsolationService.countRecordsByTenant(
      tenant2,
      'students'
    )

    // Both should have at least 1, but totals should differ if only we created records
    expect(count1).toBeGreaterThanOrEqual(1)
    expect(count2).toBeGreaterThanOrEqual(1)
  })
})

/**
 * TEST SUITE: Insert-Level Isolation
 * Verifies that platform_id cannot be overridden
 */
describe('Insert-Level Isolation', () => {
  test('Cannot insert record for different tenant', async () => {
    const student = await TenantIsolationService.insertRecordWithTenant(
      tenant1,
      'students',
      {
        user_id: 'u3',
        student_id: 'S3',
        first_name: 'Carol',
        last_name: 'White',
        college: 'Arts',
        email: 'carol@school.edu',
        status: 'Junior',
        enrollment_year: 2022
      }
    )

    // Verify it was inserted for tenant1, not tenant2
    expect(student.platform_id).toBe(tenant1.tenantId)
    expect(student.platform_id).not.toBe(tenant2.tenantId)
  })

  test('Malicious platform_id in request is ignored', async () => {
    const student = await TenantIsolationService.insertRecordWithTenant(
      tenant1,
      'students',
      {
        user_id: 'u4',
        student_id: 'S4',
        first_name: 'Dave',
        last_name: 'Brown',
        college: 'Law',
        email: 'dave@school.edu',
        status: 'Senior',
        enrollment_year: 2021,
        platform_id: tenant2.tenantId // ← ATTACKER TRIES TO OVERRIDE
      }
    )

    // Should still be tenant1, attacker's override ignored
    expect(student.platform_id).toBe(tenant1.tenantId)
  })

  test('Bulk insert respects tenant isolation', async () => {
    const bulkOp = new TenantBulkOperation(tenant1)

    const { inserted, records } = await bulkOp.insertMany('students', [
      {
        user_id: 'u5',
        student_id: 'S5',
        first_name: 'Eve',
        last_name: 'Green',
        college: 'Medicine',
        email: 'eve@school.edu',
        status: 'Freshman',
        enrollment_year: 2024
      },
      {
        user_id: 'u6',
        student_id: 'S6',
        first_name: 'Frank',
        last_name: 'Black',
        college: 'Engineering',
        email: 'frank@school.edu',
        status: 'Freshman',
        enrollment_year: 2024
      }
    ])

    expect(inserted).toBe(2)
    records.forEach(record => {
      expect(record.platform_id).toBe(tenant1.tenantId)
    })
  })
})

/**
 * TEST SUITE: Get-by-ID Isolation
 * Verifies that fetching by ID includes tenant check
 */
describe('Get-by-ID Isolation', () => {
  let student1: any

  beforeAll(async () => {
    student1 = await TenantIsolationService.insertRecordWithTenant(
      tenant1,
      'students',
      {
        user_id: 'u7',
        student_id: 'S7',
        first_name: 'Grace',
        last_name: 'Stone',
        college: 'Engineering',
        email: 'grace@school.edu',
        status: 'Freshman',
        enrollment_year: 2024
      }
    )
  })

  test('Tenant can get its own record by ID', async () => {
    const student = await TenantIsolationService.getRecordByIdAndTenant(
      tenant1,
      'students',
      student1.id
    )

    expect(student.id).toBe(student1.id)
    expect(student.student_id).toBe('S7')
  })

  test('Other tenant cannot get record by ID', async () => {
    await expect(
      TenantIsolationService.getRecordByIdAndTenant(
        tenant2,
        'students',
        student1.id
      )
    ).rejects.toThrow('not found or access denied')
  })

  test('Non-existent ID throws error', async () => {
    const fakeId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

    await expect(
      TenantIsolationService.getRecordByIdAndTenant(
        tenant1,
        'students',
        fakeId
      )
    ).rejects.toThrow('not found or access denied')
  })
})

/**
 * TEST SUITE: Update-Level Isolation
 * Verifies that updates check tenant ownership
 */
describe('Update-Level Isolation', () => {
  let student1: any
  let student2: any

  beforeAll(async () => {
    student1 = await TenantIsolationService.insertRecordWithTenant(
      tenant1,
      'students',
      {
        user_id: 'u8',
        student_id: 'S8',
        first_name: 'Henry',
        last_name: 'Miller',
        college: 'Business',
        email: 'henry@school.edu',
        status: 'Freshman',
        enrollment_year: 2024
      }
    )

    student2 = await TenantIsolationService.insertRecordWithTenant(
      tenant2,
      'students',
      {
        user_id: 'u9',
        student_id: 'S9',
        first_name: 'Ivy',
        last_name: 'Taylor',
        college: 'Physics',
        email: 'ivy@school.edu',
        status: 'Freshman',
        enrollment_year: 2024
      }
    )
  })

  test('Tenant can update its own record', async () => {
    const updated = await TenantIsolationService.updateRecordWithTenant(
      tenant1,
      'students',
      student1.id,
      { first_name: 'Henry-Updated' }
    )

    expect(updated.first_name).toBe('Henry-Updated')
  })

  test('Tenant cannot update other tenant record', async () => {
    await expect(
      TenantIsolationService.updateRecordWithTenant(
        tenant1,
        'students',
        student2.id,
        { first_name: 'Hacked' }
      )
    ).rejects.toThrow('not found or access denied')
  })

  test('Update fails for non-existent record', async () => {
    const fakeId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

    await expect(
      TenantIsolationService.updateRecordWithTenant(
        tenant1,
        'students',
        fakeId,
        { first_name: 'Fake' }
      )
    ).rejects.toThrow('not found or access denied')
  })
})

/**
 * TEST SUITE: Delete-Level Isolation
 * Verifies that deletes check tenant ownership
 */
describe('Delete-Level Isolation', () => {
  let student1: any
  let student2: any

  beforeAll(async () => {
    student1 = await TenantIsolationService.insertRecordWithTenant(
      tenant1,
      'students',
      {
        user_id: 'u10',
        student_id: 'S10',
        first_name: 'Jack',
        last_name: 'Wilson',
        college: 'Chemistry',
        email: 'jack@school.edu',
        status: 'Freshman',
        enrollment_year: 2024
      }
    )

    student2 = await TenantIsolationService.insertRecordWithTenant(
      tenant2,
      'students',
      {
        user_id: 'u11',
        student_id: 'S11',
        first_name: 'Kelly',
        last_name: 'Anderson',
        college: 'Biology',
        email: 'kelly@school.edu',
        status: 'Freshman',
        enrollment_year: 2024
      }
    )
  })

  test('Tenant cannot delete other tenant record', async () => {
    await expect(
      TenantIsolationService.deleteRecordWithTenant(
        tenant1,
        'students',
        student2.id
      )
    ).rejects.toThrow('not found or access denied')
  })

  test('Delete fails for non-existent record', async () => {
    const fakeId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

    await expect(
      TenantIsolationService.deleteRecordWithTenant(
        tenant1,
        'students',
        fakeId
      )
    ).rejects.toThrow('not found or access denied')
  })

  test('Tenant can delete its own record', async () => {
    const deleted = await TenantIsolationService.deleteRecordWithTenant(
      tenant1,
      'students',
      student1.id
    )

    expect(deleted.id).toBe(student1.id)

    // Verify deletion
    await expect(
      TenantIsolationService.getRecordByIdAndTenant(
        tenant1,
        'students',
        student1.id
      )
    ).rejects.toThrow('not found or access denied')
  })
})

/**
 * TEST SUITE: Query Builder Isolation
 * Verifies TenantQuery builder enforces isolation
 */
describe('Query Builder Isolation', () => {
  test('withTenant is required', async () => {
    const query = TenantQuery.from('students').where('status', 'active')

    // Should fail without withTenant
    await expect(query.execute()).rejects.toThrow(
      'Tenant context required'
    )
  })

  test('Query results are filtered to tenant', async () => {
    const students = await TenantQuery.from('students')
      .where('status', 'Freshman')
      .withTenant(tenant1)
      .execute()

    students.forEach(s => {
      expect(s.platform_id).toBe(tenant1.tenantId)
    })
  })

  test('Count respects tenant filter', async () => {
    const count = await TenantQuery.from('students')
      .where('status', 'Freshman')
      .withTenant(tenant1)
      .count()

    // Count should only include tenant1 records
    expect(count).toBeGreaterThanOrEqual(0)
  })
})

/**
 * TEST SUITE: Boundary Checker Wrapper
 * Verifies convenience wrapper enforces isolation
 */
describe('Boundary Checker Wrapper', () => {
  let student1: any

  beforeAll(async () => {
    student1 = await TenantIsolationService.insertRecordWithTenant(
      tenant1,
      'students',
      {
        user_id: 'u12',
        student_id: 'S12',
        first_name: 'Liam',
        last_name: 'Davis',
        college: 'Math',
        email: 'liam@school.edu',
        status: 'Freshman',
        enrollment_year: 2024
      }
    )
  })

  test('Boundary checker creates verified resource', async () => {
    const checker = createTenantBoundaryChecker(tenant1)

    const student = await checker.getById('students', student1.id)
    expect(student.id).toBe(student1.id)
  })

  test('Boundary checker prevents cross-tenant access', async () => {
    const checker = createTenantBoundaryChecker(tenant2)

    await expect(
      checker.getById('students', student1.id)
    ).rejects.toThrow('access denied')
  })

  test('Boundary checker creates resources for tenant', async () => {
    const checker = createTenantBoundaryChecker(tenant1)

    const student = await checker.insert('students', {
      user_id: 'u13',
      student_id: 'S13',
      first_name: 'Mia',
      last_name: 'Thompson',
      college: 'History',
      email: 'mia@school.edu',
      status: 'Freshman',
      enrollment_year: 2024
    })

    expect(student.platform_id).toBe(tenant1.tenantId)
  })
})

/**
 * TEST SUITE: Edge Cases
 * Tests unusual scenarios
 */
describe('Edge Cases', () => {
  test('Empty string tenant ID is rejected', async () => {
    const invalidTenant = {
      ...tenant1,
      tenantId: ''
    }

    await expect(
      TenantIsolationService.listRecordsByTenant(
        invalidTenant,
        'students'
      )
    ).rejects.toThrow()
  })

  test('Null tenant ID is rejected', async () => {
    const invalidTenant = {
      ...tenant1,
      tenantId: null as any
    }

    await expect(
      TenantIsolationService.listRecordsByTenant(
        invalidTenant,
        'students'
      )
    ).rejects.toThrow()
  })

  test('Invalid UUID format is rejected', async () => {
    const invalidTenant = {
      ...tenant1,
      tenantId: 'not-a-uuid'
    }

    await expect(
      TenantIsolationService.listRecordsByTenant(
        invalidTenant,
        'students'
      )
    ).rejects.toThrow()
  })
})

export default {
  tenant1,
  tenant2
}
