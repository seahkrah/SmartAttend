// ===========================
// CORE TYPES
// ===========================

export interface Platform {
  id: string
  name: 'school' | 'corporate'
  display_name: string
  created_at: Date
}

export interface Role {
  id: string
  platform_id: string
  name: string
  description?: string
  permissions: string[]
  created_at: Date
}

export interface User {
  id: string
  platform_id: string
  email: string
  full_name: string
  phone?: string
  role_id: string
  password_hash?: string
  profile_image_url?: string
  is_active: boolean
  last_login?: Date
  created_at: Date
  updated_at: Date
}

export interface AuditLog {
  id: string
  platform_id: string
  user_id?: string
  action: string
  entity_type?: string
  entity_id?: string
  old_values?: Record<string, any>
  new_values?: Record<string, any>
  ip_address?: string
  created_at: Date
}

// ===========================
// SCHOOL PLATFORM TYPES (REFACTORED)
// ===========================

export interface SchoolDepartment {
  id: string
  name: string
  code?: string
  description?: string
  head_id?: string
  created_at: Date
}

export interface Student {
  id: string
  user_id: string
  student_id: string
  first_name: string
  middle_name?: string
  last_name: string
  college: string
  email: string
  status: 'Freshman' | 'Sophomore' | 'Junior' | 'Senior'
  department_id?: string
  enrollment_year: number
  is_currently_enrolled: boolean
  created_at: Date
}

export interface Faculty {
  id: string
  user_id: string
  employee_id: string
  first_name: string
  middle_name?: string
  last_name: string
  college: string
  email: string
  department_id?: string
  specialization?: string
  office_location?: string
  office_hours?: string
  created_at: Date
}

export interface StudentFaceEmbedding {
  id: string
  student_id: string
  embedding_url: string
  embedding_hash?: string
  liveness_score?: number
  is_verified: boolean
  captured_at: Date
}

export interface StudentProfilePictureEmbedding {
  id: string
  student_id: string
  picture_url: string
  picture_hash?: string
  face_detection_data?: Record<string, any>
  captured_at: Date
  updated_at: Date
}

export interface Semester {
  id: string
  department_id: string
  name: string
  start_date: Date
  end_date: Date
  is_active: boolean
  created_at: Date
}

export interface Course {
  id: string
  department_id: string
  semester_id: string
  code: string
  name: string
  credits?: number
  description?: string
  max_capacity?: number
  created_at: Date
}

export interface FacultyCourse {
  id: string
  faculty_id: string
  course_id: string
  assigned_at: Date
}

export interface Room {
  id: string
  room_number: string
  capacity?: number
  building?: string
  created_at: Date
}

export interface ClassSchedule {
  id: string
  course_id: string
  room_id: string
  faculty_id: string
  day_of_week: number
  start_time: string
  end_time: string
  created_at: Date
}

export interface StudentCourse {
  id: string
  schedule_id: string
  student_id: string
  enrolled_at: Date
  is_active: boolean
}

export interface SchoolAttendance {
  id: string
  schedule_id: string
  student_id: string
  marked_by_id: string
  attendance_date: Date
  status: 'present' | 'absent' | 'late' | 'excused'
  remarks?: string
  face_verified: boolean
  marked_at: Date
}

// ===========================
// CORPORATE PLATFORM TYPES (REFACTORED)
// ===========================

export interface CorporateDepartment {
  id: string
  name: string
  code?: string
  description?: string
  head_id?: string
  created_at: Date
}

export interface Employee {
  id: string
  user_id: string
  employee_id: string
  first_name: string
  middle_name?: string
  last_name: string
  email: string
  phone: string
  department_id?: string
  designation?: string
  employment_type: 'full_time' | 'part_time' | 'contract' | 'intern'
  date_of_joining: Date
  is_currently_employed: boolean
  manager_id?: string
  created_at: Date
}

export interface EmployeeFaceEmbedding {
  id: string
  employee_id: string
  embedding_url: string
  embedding_hash?: string
  liveness_score?: number
  anti_spoofing_score?: number
  is_verified: boolean
  captured_at: Date
}

export interface EmployeeProfilePictureEmbedding {
  id: string
  employee_id: string
  picture_url: string
  picture_hash?: string
  face_detection_data?: Record<string, any>
  captured_at: Date
  updated_at: Date
}

export interface WorkAssignment {
  id: string
  employee_id: string
  assignment_type: 'office' | 'field' | 'remote'
  project_name?: string
  site_location?: string
  latitude?: number
  longitude?: number
  description?: string
  assigned_date: Date
  end_date?: Date
  is_active: boolean
  created_at: Date
}

export interface CorporateCheckin {
  id: string
  employee_id: string
  assignment_id?: string
  check_in_type: 'office' | 'field'
  check_in_time: Date
  check_out_time?: Date
  check_in_latitude?: number
  check_in_longitude?: number
  check_out_latitude?: number
  check_out_longitude?: number
  site_location?: string
  face_verified: boolean
  liveness_score?: number
  anti_spoofing_score?: number
  device_id?: string
  ip_address?: string
  notes?: string
  created_at: Date
}

// ===========================
// ROLE-BASED ACCESS CONTROL TYPES
// ===========================

export interface SchoolEntity {
  id: string
  name: string
  code?: string
  address?: string
  phone?: string
  email?: string
  admin_user_id?: string
  is_active: boolean
  created_at: Date
  updated_at: Date
}

export interface CorporateEntity {
  id: string
  name: string
  code?: string
  industry?: string
  headquarters_address?: string
  phone?: string
  email?: string
  admin_user_id?: string
  is_active: boolean
  created_at: Date
  updated_at: Date
}

export interface UserRegistrationRequest {
  id: string
  user_id: string
  platform_id: string
  entity_id?: string
  requested_role: string
  status: 'pending' | 'approved' | 'rejected'
  requested_by_user_id?: string
  approved_by_user_id?: string
  rejection_reason?: string
  submitted_at: Date
  reviewed_at?: Date
  created_at: Date
}

export interface SchoolUserAssociation {
  id: string
  user_id: string
  school_entity_id: string
  status: 'active' | 'inactive' | 'suspended'
  assigned_at: Date
}

export interface CorporateUserAssociation {
  id: string
  user_id: string
  corporate_entity_id: string
  department_id?: string
  status: 'active' | 'inactive' | 'suspended'
  assigned_at: Date
}

export interface SchoolUserApproval {
  id: string
  user_id: string
  school_entity_id: string
  requested_role: 'faculty' | 'it'
  status: 'pending' | 'approved' | 'rejected'
  requested_at: Date
  approved_by_user_id?: string
  approved_at?: Date
  rejection_reason?: string
}

export interface CorporateUserApproval {
  id: string
  user_id: string
  corporate_entity_id: string
  requested_role: 'it' | 'hr'
  status: 'pending' | 'approved' | 'rejected'
  requested_at: Date
  approved_by_user_id?: string
  approved_at?: Date
  rejection_reason?: string
}
