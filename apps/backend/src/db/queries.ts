import { query } from './connection.js'
import type { 
  User, Student, Faculty, Employee, SchoolAttendance, CorporateCheckin,
  StudentCourse, FacultyCourse, WorkAssignment, StudentFaceEmbedding, EmployeeFaceEmbedding
} from '../types/database.js'

// ===========================
// GENERAL USER QUERIES
// ===========================

export async function getUserById(userId: string): Promise<User | null> {
  const result = await query('SELECT * FROM users WHERE id = $1', [userId])
  return result.rows[0] || null
}

// ===========================
// SCHOOL PLATFORM QUERIES
// ===========================

// Students
export async function getStudentById(studentId: string): Promise<Student | null> {
  const result = await query('SELECT * FROM students WHERE id = $1', [studentId])
  return result.rows[0] || null
}

export async function getStudentByUserId(userId: string): Promise<Student | null> {
  const result = await query('SELECT * FROM students WHERE user_id = $1', [userId])
  return result.rows[0] || null
}

export async function getStudentsBySemester(semesterId: string, limit = 100, offset = 0): Promise<Student[]> {
  const result = await query(
    `SELECT DISTINCT s.* FROM students s
     INNER JOIN student_courses sc ON s.id = sc.student_id
     INNER JOIN class_schedules cs ON sc.schedule_id = cs.id
     INNER JOIN courses c ON cs.course_id = c.id
     WHERE c.semester_id = $1
     LIMIT $2 OFFSET $3`,
    [semesterId, limit, offset]
  )
  return result.rows
}

export async function createStudent(
  userId: string,
  studentId: string,
  firstName: string,
  lastName: string,
  college: string,
  email: string,
  status: 'Freshman' | 'Sophomore' | 'Junior' | 'Senior',
  enrollmentYear: number,
  departmentId?: string
): Promise<Student> {
  const result = await query(
    `INSERT INTO students (user_id, student_id, first_name, last_name, college, email, status, enrollment_year, department_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [userId, studentId, firstName, lastName, college, email, status, enrollmentYear, departmentId || null]
  )
  return result.rows[0]
}

// Faculty
export async function getFacultyById(facultyId: string): Promise<Faculty | null> {
  const result = await query('SELECT * FROM faculty WHERE id = $1', [facultyId])
  return result.rows[0] || null
}

export async function getFacultyByUserId(userId: string): Promise<Faculty | null> {
  const result = await query('SELECT * FROM faculty WHERE user_id = $1', [userId])
  return result.rows[0] || null
}

export async function getFacultyByDepartment(departmentId: string, limit = 50, offset = 0): Promise<Faculty[]> {
  const result = await query(
    `SELECT * FROM faculty WHERE department_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [departmentId, limit, offset]
  )
  return result.rows
}

export async function createFaculty(
  userId: string,
  employeeId: string,
  firstName: string,
  lastName: string,
  college: string,
  email: string,
  departmentId?: string,
  specialization?: string,
  officeLocation?: string
): Promise<Faculty> {
  const result = await query(
    `INSERT INTO faculty (user_id, employee_id, first_name, last_name, college, email, department_id, specialization, office_location)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [userId, employeeId, firstName, lastName, college, email, departmentId || null, specialization || null, officeLocation || null]
  )
  return result.rows[0]
}

// Faculty Courses
export async function getFacultyCourses(facultyId: string): Promise<FacultyCourse[]> {
  const result = await query(
    `SELECT fc.* FROM faculty_courses fc
     WHERE fc.faculty_id = $1
     ORDER BY fc.assigned_at DESC`,
    [facultyId]
  )
  return result.rows
}

export async function assignFacultyToCourse(facultyId: string, courseId: string): Promise<FacultyCourse> {
  const result = await query(
    `INSERT INTO faculty_courses (faculty_id, course_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [facultyId, courseId]
  )
  return result.rows[0]
}

// School Attendance
export async function recordAttendance(
  scheduleId: string,
  studentId: string,
  markedById: string,
  attendanceDate: string,
  status: 'present' | 'absent' | 'late' | 'excused',
  faceVerified: boolean = false,
  remarks?: string
): Promise<SchoolAttendance> {
  const result = await query(
    `INSERT INTO school_attendance (schedule_id, student_id, marked_by_id, attendance_date, status, face_verified, remarks)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (schedule_id, student_id, attendance_date) DO UPDATE SET
       status = $5, face_verified = $6, remarks = $7, marked_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [scheduleId, studentId, markedById, attendanceDate, status, faceVerified, remarks || null]
  )
  return result.rows[0]
}

export async function getAttendanceBySchedule(scheduleId: string, date: string): Promise<SchoolAttendance[]> {
  const result = await query(
    `SELECT * FROM school_attendance
     WHERE schedule_id = $1 AND attendance_date = $2
     ORDER BY marked_at DESC`,
    [scheduleId, date]
  )
  return result.rows
}

export async function getStudentAttendance(studentId: string, startDate: string, endDate: string): Promise<SchoolAttendance[]> {
  const result = await query(
    `SELECT * FROM school_attendance
     WHERE student_id = $1 AND attendance_date BETWEEN $2 AND $3
     ORDER BY attendance_date DESC`,
    [studentId, startDate, endDate]
  )
  return result.rows
}

// Student Courses
export async function enrollStudentInSchedule(scheduleId: string, studentId: string): Promise<StudentCourse> {
  const result = await query(
    `INSERT INTO student_courses (schedule_id, student_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [scheduleId, studentId]
  )
  return result.rows[0]
}

export async function getStudentSchedules(studentId: string): Promise<any[]> {
  const result = await query(
    `SELECT cs.*, c.name as course_name, c.code as course_code, f.first_name, f.last_name, r.room_number
     FROM student_courses sc
     INNER JOIN class_schedules cs ON sc.schedule_id = cs.id
     INNER JOIN courses c ON cs.course_id = c.id
     INNER JOIN faculty f ON cs.faculty_id = f.id
     INNER JOIN rooms r ON cs.room_id = r.id
     WHERE sc.student_id = $1 AND sc.is_active = true
     ORDER BY cs.day_of_week, cs.start_time`,
    [studentId]
  )
  return result.rows
}

// ===========================
// CORPORATE PLATFORM QUERIES
// ===========================

// Employees
export async function getEmployeeById(employeeId: string): Promise<Employee | null> {
  const result = await query('SELECT * FROM employees WHERE id = $1', [employeeId])
  return result.rows[0] || null
}

export async function getEmployeeByUserId(userId: string): Promise<Employee | null> {
  const result = await query('SELECT * FROM employees WHERE user_id = $1', [userId])
  return result.rows[0] || null
}

export async function getEmployeesByDepartment(departmentId: string, limit = 50, offset = 0): Promise<Employee[]> {
  const result = await query(
    `SELECT * FROM employees WHERE department_id = $1 AND is_currently_employed = true
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [departmentId, limit, offset]
  )
  return result.rows
}

export async function createEmployee(
  userId: string,
  employeeId: string,
  firstName: string,
  lastName: string,
  email: string,
  phone: string,
  departmentId?: string,
  designation?: string,
  employmentType: 'full_time' | 'part_time' | 'contract' | 'intern' = 'full_time',
  dateOfJoining?: string
): Promise<Employee> {
  const result = await query(
    `INSERT INTO employees (user_id, employee_id, first_name, last_name, email, phone, department_id, designation, employment_type, date_of_joining)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      userId,
      employeeId,
      firstName,
      lastName,
      email,
      phone,
      departmentId || null,
      designation || null,
      employmentType,
      dateOfJoining || new Date().toISOString().split('T')[0]
    ]
  )
  return result.rows[0]
}

// Work Assignments
export async function createWorkAssignment(
  employeeId: string,
  assignmentType: 'office' | 'field' | 'remote',
  assignedDate: string,
  projectName?: string,
  siteLocation?: string,
  latitude?: number,
  longitude?: number,
  endDate?: string
): Promise<WorkAssignment> {
  const result = await query(
    `INSERT INTO work_assignments (employee_id, assignment_type, assigned_date, project_name, site_location, latitude, longitude, end_date, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     RETURNING *`,
    [employeeId, assignmentType, assignedDate, projectName || null, siteLocation || null, latitude || null, longitude || null, endDate || null]
  )
  return result.rows[0]
}

export async function getActiveAssignments(employeeId: string): Promise<WorkAssignment[]> {
  const result = await query(
    `SELECT * FROM work_assignments
     WHERE employee_id = $1 AND is_active = true
     ORDER BY assigned_date DESC`,
    [employeeId]
  )
  return result.rows
}

// Corporate Check-ins
export async function recordCheckIn(
  employeeId: string,
  checkInType: 'office' | 'field',
  checkInLatitude?: number,
  checkInLongitude?: number,
  siteLocation?: string,
  faceVerified: boolean = false,
  assignmentId?: string
): Promise<CorporateCheckin> {
  const result = await query(
    `INSERT INTO corporate_checkins (employee_id, check_in_type, check_in_time, check_in_latitude, check_in_longitude, site_location, face_verified, assignment_id)
     VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6, $7)
     RETURNING *`,
    [employeeId, checkInType, checkInLatitude || null, checkInLongitude || null, siteLocation || null, faceVerified, assignmentId || null]
  )
  return result.rows[0]
}

export async function recordCheckOut(
  checkInId: string,
  checkOutLatitude?: number,
  checkOutLongitude?: number
): Promise<CorporateCheckin> {
  const result = await query(
    `UPDATE corporate_checkins
     SET check_out_time = CURRENT_TIMESTAMP, check_out_latitude = $2, check_out_longitude = $3
     WHERE id = $1
     RETURNING *`,
    [checkInId, checkOutLatitude || null, checkOutLongitude || null]
  )
  return result.rows[0]
}

export async function getEmployeeCheckIns(employeeId: string, days: number = 30): Promise<CorporateCheckin[]> {
  const result = await query(
    `SELECT * FROM corporate_checkins
     WHERE employee_id = $1 AND check_in_time > CURRENT_TIMESTAMP - INTERVAL '1 day' * $2
     ORDER BY check_in_time DESC`,
    [employeeId, days]
  )
  return result.rows
}

// ===========================
// FACE EMBEDDINGS QUERIES
// ===========================

export async function storeStudentFaceEmbedding(
  studentId: string,
  embeddingUrl: string,
  embeddingHash: string,
  livenessScore?: number
): Promise<StudentFaceEmbedding> {
  const result = await query(
    `INSERT INTO student_face_embeddings (student_id, embedding_url, embedding_hash, liveness_score)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [studentId, embeddingUrl, embeddingHash, livenessScore || null]
  )
  return result.rows[0]
}

export async function getStudentFaceEmbeddings(studentId: string): Promise<StudentFaceEmbedding[]> {
  const result = await query(
    `SELECT * FROM student_face_embeddings
     WHERE student_id = $1 AND is_verified = true
     ORDER BY captured_at DESC`,
    [studentId]
  )
  return result.rows
}

export async function storeEmployeeFaceEmbedding(
  employeeId: string,
  embeddingUrl: string,
  embeddingHash: string,
  livenessScore?: number,
  antiSpoofingScore?: number
): Promise<EmployeeFaceEmbedding> {
  const result = await query(
    `INSERT INTO employee_face_embeddings (employee_id, embedding_url, embedding_hash, liveness_score, anti_spoofing_score)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [employeeId, embeddingUrl, embeddingHash, livenessScore || null, antiSpoofingScore || null]
  )
  return result.rows[0]
}

export async function getEmployeeFaceEmbeddings(employeeId: string): Promise<EmployeeFaceEmbedding[]> {
  const result = await query(
    `SELECT * FROM employee_face_embeddings
     WHERE employee_id = $1 AND is_verified = true
     ORDER BY captured_at DESC`,
    [employeeId]
  )
  return result.rows
}
