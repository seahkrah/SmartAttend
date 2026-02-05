/**
 * PHASE 4, STEP 4.1: TENANT BOUNDARY ENFORCEMENT - INTEGRATION GUIDE
 * 
 * Shows how to integrate tenant isolation into existing routes
 * Demonstrates the three main integration patterns
 */

// ============================================================
// PATTERN 1: USING TENANT ISOLATION SERVICE (Recommended)
// ============================================================

import { TenantIsolationService, createTenantBoundaryChecker } from '../services/tenantIsolationService.js'
import { TenantAwareRequest } from '../types/tenantContext.js'
import { authenticateToken } from '../auth/middleware.js'
import { enforceTenantBoundaries, withTenantErrorHandling } from '../auth/tenantEnforcementMiddleware.js'
import { Response, Router } from 'express'

const router = Router()

/**
 * Example 1: Get all students for tenant
 * 
 * Before (vulnerable to cross-tenant access):
 * SELECT * FROM students;
 * 
 * After (automatically scoped to tenant):
 * SELECT * FROM students WHERE platform_id = 'tenant-id';
 */
router.get(
  '/students',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) {
      res.status(401).json({ error: 'Tenant context required' })
      return
    }

    // List students - automatically filtered to tenant
    const result = await TenantIsolationService.listRecordsByTenant(
      req.tenant,
      'students',
      {
        orderBy: 'created_at DESC',
        limit: 20,
        offset: 0
      }
    )

    res.json({
      data: result.records,
      total: result.total,
      count: result.count
    })
  })
)

/**
 * Example 2: Get single student by ID with tenant verification
 * 
 * Automatic tenant check:
 * - Looks up student by ID
 * - Verifies it belongs to authenticated tenant
 * - Throws error if record belongs to different tenant
 */
router.get(
  '/students/:studentId',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) {
      res.status(401).json({ error: 'Tenant context required' })
      return
    }

    const { studentId } = req.params

    // Get student - throws if not found or wrong tenant
    const student = await TenantIsolationService.getRecordByIdAndTenant(
      req.tenant,
      'students',
      studentId
    )

    res.json({ data: student })
  })
)

/**
 * Example 3: Create student (impossible to create for wrong tenant)
 * 
 * Enforces tenant on insert:
 * - Automatically adds platform_id = tenant_id
 * - User cannot override with different tenant
 * - Makes cross-tenant writes impossible by construction
 */
router.post(
  '/students',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) {
      return res.status(401).json({ error: 'Tenant context required' })
    }

    const { userId, studentId, firstName, lastName, college, email, status, enrollmentYear } = req.body

    if (!userId || !studentId || !firstName || !lastName || !college || !email || !status || !enrollmentYear) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Insert - automatically adds platform_id
    // Even if body contains { platform_id: 'different-tenant' }, it will be overwritten
    const student = await TenantIsolationService.insertRecordWithTenant(
      req.tenant,
      'students',
      {
        user_id: userId,
        student_id: studentId,
        first_name: firstName,
        last_name: lastName,
        college,
        email,
        status,
        enrollment_year: enrollmentYear
      }
    )

    res.status(201).json({ data: student })
  })
)

/**
 * Example 4: Update student (only their own tenant's records)
 * 
 * Safety checks:
 * - Verifies student belongs to tenant
 * - Only updates if ownership confirmed
 * - Throws error if attempting cross-tenant update
 */
router.put(
  '/students/:studentId',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) {
      return res.status(401).json({ error: 'Tenant context required' })
    }

    const { studentId } = req.params
    const { firstName, lastName, email, status } = req.body

    // Update - verifies ownership first
    const student = await TenantIsolationService.updateRecordWithTenant(
      req.tenant,
      'students',
      studentId,
      {
        first_name: firstName,
        last_name: lastName,
        email,
        status
      }
    )

    res.json({ data: student })
  })
)

/**
 * Example 5: Delete student (only from own tenant)
 * 
 * Delete safety:
 * - Verifies record belongs to tenant
 * - Only deletes if ownership confirmed
 * - Prevents accidental cross-tenant deletes
 */
router.delete(
  '/students/:studentId',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) {
      return res.status(401).json({ error: 'Tenant context required' })
    }

    const { studentId } = req.params

    // Delete - verifies ownership
    const student = await TenantIsolationService.deleteRecordWithTenant(
      req.tenant,
      'students',
      studentId
    )

    res.json({ data: student, message: 'Student deleted' })
  })
)

// ============================================================
// PATTERN 2: USING TENANT QUERY BUILDER (Fluent API)
// ============================================================

import { TenantQuery, TenantBulkOperation } from '../services/tenantQueryBuilder.js'

/**
 * Example 6: Complex query with filters using fluent API
 * 
 * Advantages:
 * - Tenant filter automatically applied
 * - Type-safe column references
 * - Easy to understand query structure
 */
router.get(
  '/students/search',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) {
      return res.status(401).json({ error: 'Tenant context required' })
    }

    const { department, status, limit = 20, offset = 0 } = req.query

    let query = TenantQuery.from('students')
      .select('id', 'student_id', 'first_name', 'last_name', 'email', 'status')
      .withTenant(req.tenant)

    // Add filters if provided
    if (department) {
      query = query.where('department_id', department as string)
    }
    if (status) {
      query = query.where('status', status as string)
    }

    // Add pagination
    query = query
      .orderBy('created_at DESC')
      .limit(parseInt(limit as string))
      .offset(parseInt(offset as string))

    const students = await query.execute()
    const total = await query.count()

    res.json({
      data: students,
      total,
      count: students.length,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    })
  })
)

/**
 * Example 7: Bulk operations with tenant enforcement
 * 
 * Useful for:
 * - Batch imports
 * - Bulk updates
 * - Bulk deletes
 * All automatically scoped to tenant
 */
router.post(
  '/students/bulk-import',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) {
      return res.status(401).json({ error: 'Tenant context required' })
    }

    const { students } = req.body

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ error: 'Invalid students array' })
    }

    const bulkOp = new TenantBulkOperation(req.tenant)

    // Bulk insert - all automatically assigned to tenant
    const result = await bulkOp.insertMany('students', students)

    res.status(201).json({
      imported: result.inserted,
      records: result.records
    })
  })
)

// ============================================================
// PATTERN 3: MANUAL TENANT VERIFICATION (For custom queries)
// ============================================================

import { verifyTenantOwnsResource } from '../auth/tenantEnforcementMiddleware.js'

/**
 * Example 8: Custom query with manual verification
 * 
 * Use when:
 * - Need raw SQL for complex operations
 * - Existing query patterns
 * - Performance-critical operations
 * 
 * Must verify tenant ownership manually
 */
router.get(
  '/students/attendance-summary/:studentId',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) {
      return res.status(401).json({ error: 'Tenant context required' })
    }

    const { studentId } = req.params

    // Manual verification step
    const student = await TenantIsolationService.getRecordByIdAndTenant(
      req.tenant,
      'students',
      studentId
    )

    // Now safe to run custom query
    const attendanceResult = await TenantIsolationService.queryWithTenant(
      req.tenant,
      `
        SELECT 
          COUNT(*) as total_classes,
          SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
          SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
          SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late
        FROM school_attendance
        WHERE student_id = $1
      `,
      [studentId]
    )

    const stats = attendanceResult.rows[0]

    res.json({
      student,
      attendance: {
        total: stats.total_classes,
        present: stats.present,
        absent: stats.absent,
        late: stats.late,
        percentage: stats.total_classes > 0 
          ? ((stats.present / stats.total_classes) * 100).toFixed(2)
          : 0
      }
    })
  })
)

// ============================================================
// PATTERN 4: USING BOUNDARY CHECKER WRAPPER
// ============================================================

/**
 * Example 9: Using boundary checker for inline verification
 * 
 * Good for:
 * - Multiple resource verifications in one handler
 * - Mixing different operations
 * - Readable inline checks
 */
router.post(
  '/enroll-student',
  authenticateToken,
  enforceTenantBoundaries,
  withTenantErrorHandling(async (req: TenantAwareRequest, res: Response) => {
    if (!req.tenant) {
      res.status(401).json({ error: 'Tenant context required' })
      return
    }

    const { studentId, semesterId } = req.body
    const checker = createTenantBoundaryChecker(req.tenant)

    try {
      // Verify both student and semester belong to tenant
      const student = await checker.getById('students', studentId)
      const semester = await checker.getById('semesters', semesterId)

      // Can now safely work with these resources
      const enrollment = await checker.insert('enrollments', {
        student_id: studentId,
        semester_id: semesterId,
        status: 'active'
      })

      res.status(201).json({ data: enrollment })
    } catch (error: any) {
      if (error.message.includes('access denied')) {
        res.status(403).json({ error: error.message })
        return
      }
      throw error
    }
  })
)

// ============================================================
// SECURITY GUARANTEES PROVIDED
// ============================================================

/**
 * CROSS-TENANT ACCESS IS IMPOSSIBLE BY CONSTRUCTION
 * 
 * 1. QUERY-LEVEL ENFORCEMENT
 *    - Every SELECT automatically includes AND platform_id = 'tenant_id'
 *    - Even raw SQL gets tenant filter appended
 *    - JOINs work correctly with tenant filtering on primary table
 * 
 * 2. INSERT-LEVEL ENFORCEMENT
 *    - platform_id automatically set to authenticated tenant
 *    - Malicious platform_id in request body is overwritten
 *    - Impossible to insert record into other tenant
 * 
 * 3. UPDATE-LEVEL ENFORCEMENT
 *    - Record lookup includes tenant check
 *    - Update WHERE clause includes AND platform_id = 'tenant_id'
 *    - Fails if record doesn't belong to tenant
 * 
 * 4. DELETE-LEVEL ENFORCEMENT
 *    - Record lookup includes tenant check
 *    - Delete WHERE clause includes AND platform_id = 'tenant_id'
 *    - Impossible to delete record from other tenant
 * 
 * 5. REQUEST-LEVEL ENFORCEMENT
 *    - Middleware validates JWT contains valid platform_id
 *    - URL parameters are checked against authenticated tenant
 *    - Request body platform_id is validated
 *    - Query string tenant filters are validated
 * 
 * 6. AUDIT TRAIL
 *    - Every access logged with tenant ID
 *    - Cross-tenant attempts logged as security violations
 *    - User and tenant context always available
 * 
 * RESULT: Cross-tenant access is impossible by construction
 */

export default router
