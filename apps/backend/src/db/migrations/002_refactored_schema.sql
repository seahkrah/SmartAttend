-- ===========================
-- SMARTATTEND REFACTORED SCHEMA
-- ===========================

-- Drop old tables (for fresh migration)
DROP TABLE IF EXISTS school_attendance CASCADE;
DROP TABLE IF EXISTS enrollments CASCADE;
DROP TABLE IF EXISTS class_schedules CASCADE;
DROP TABLE IF EXISTS courses CASCADE;
DROP TABLE IF EXISTS school_profile_picture_embeddings CASCADE;
DROP TABLE IF EXISTS school_face_embeddings CASCADE;
DROP TABLE IF EXISTS corporate_checkins CASCADE;
DROP TABLE IF EXISTS employee_shifts CASCADE;
DROP TABLE IF EXISTS shifts CASCADE;
DROP TABLE IF EXISTS locations CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS semesters CASCADE;
DROP TABLE IF EXISTS faculty CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS school_departments CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS corporate_departments CASCADE;

-- ===========================
-- CORE TABLES (unchanged)
-- ===========================

-- Platforms (School, Corporate)
CREATE TABLE IF NOT EXISTS platforms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unified Roles
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform_id, name)
);

-- Unified Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  role_id UUID NOT NULL REFERENCES roles(id),
  password_hash VARCHAR(255),
  profile_image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform_id, email)
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100),
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================
-- SCHOOL PLATFORM TABLES (REFACTORED)
-- ===========================

-- School Departments
CREATE TABLE IF NOT EXISTS school_departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  code VARCHAR(50) UNIQUE,
  description TEXT,
  head_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Students (School) - REFACTORED WITH BIODATA
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  student_id VARCHAR(50) NOT NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100) NOT NULL,
  college VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL, -- 'Freshman', 'Sophomore', 'Junior', 'Senior'
  department_id UUID REFERENCES school_departments(id),
  enrollment_year INT NOT NULL,
  is_currently_enrolled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Faculty (School) - REFACTORED WITH BIODATA
CREATE TABLE IF NOT EXISTS faculty (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_id VARCHAR(50) NOT NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100) NOT NULL,
  college VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  department_id UUID REFERENCES school_departments(id),
  specialization VARCHAR(255),
  office_location VARCHAR(100),
  office_hours TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Student Face Embeddings (NEW - replacing school_face_embeddings)
CREATE TABLE IF NOT EXISTS student_face_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  embedding_url TEXT NOT NULL,
  embedding_hash VARCHAR(255),
  liveness_score DECIMAL(3, 2),
  is_verified BOOLEAN DEFAULT false,
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, embedding_hash)
);

-- Student Profile Picture Embeddings (NEW - replacing school_profile_picture_embeddings)
CREATE TABLE IF NOT EXISTS student_profile_picture_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  picture_url TEXT NOT NULL,
  picture_hash VARCHAR(255),
  face_detection_data JSONB,
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Semesters
CREATE TABLE IF NOT EXISTS semesters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES school_departments(id),
  name VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(department_id, name)
);

-- Courses
CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES school_departments(id),
  semester_id UUID NOT NULL REFERENCES semesters(id),
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  credits INT,
  description TEXT,
  max_capacity INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(semester_id, code)
);

-- Faculty Courses (NEW - tracks which courses faculty teach)
CREATE TABLE IF NOT EXISTS faculty_courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  faculty_id UUID NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(faculty_id, course_id)
);

-- Rooms (REFACTORED - removed floor, department_id, resources)
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_number VARCHAR(50) NOT NULL UNIQUE,
  capacity INT,
  building VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Class Schedules (REFACTORED - added faculty_id)
CREATE TABLE IF NOT EXISTS class_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id),
  room_id UUID NOT NULL REFERENCES rooms(id),
  faculty_id UUID NOT NULL REFERENCES faculty(id),
  day_of_week INT NOT NULL, -- 0=Monday, 6=Sunday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Student Courses (NEW - tracks which courses students are enrolled in, per schedule)
CREATE TABLE IF NOT EXISTS student_courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID NOT NULL REFERENCES class_schedules(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(schedule_id, student_id)
);

-- School Attendance (REFACTORED - uses schedule_id instead of course_id)
CREATE TABLE IF NOT EXISTS school_attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID NOT NULL REFERENCES class_schedules(id),
  student_id UUID NOT NULL REFERENCES students(id),
  marked_by_id UUID NOT NULL REFERENCES faculty(id),
  attendance_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL, -- 'present', 'absent', 'late', 'excused'
  remarks TEXT,
  face_verified BOOLEAN DEFAULT false,
  marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(schedule_id, student_id, attendance_date)
);

-- ===========================
-- CORPORATE PLATFORM TABLES (REFACTORED)
-- ===========================

-- Corporate Departments (REFACTORED - removed budget)
CREATE TABLE IF NOT EXISTS corporate_departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  code VARCHAR(50) UNIQUE,
  description TEXT,
  head_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Employees (Corporate) - REFACTORED WITH BIODATA AND CONTACT INFO
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_id VARCHAR(50) NOT NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  department_id UUID REFERENCES corporate_departments(id),
  designation VARCHAR(255),
  employment_type VARCHAR(50), -- 'full_time', 'part_time', 'contract', 'intern'
  date_of_joining DATE NOT NULL,
  is_currently_employed BOOLEAN DEFAULT true,
  manager_id UUID REFERENCES employees(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Employee Face Embeddings (NEW - replacing corporate_face_embeddings)
CREATE TABLE IF NOT EXISTS employee_face_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  embedding_url TEXT NOT NULL,
  embedding_hash VARCHAR(255),
  liveness_score DECIMAL(3, 2),
  anti_spoofing_score DECIMAL(3, 2),
  is_verified BOOLEAN DEFAULT false,
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, embedding_hash)
);

-- Employee Profile Picture Embeddings (NEW - replacing corporate_profile_picture_embeddings)
CREATE TABLE IF NOT EXISTS employee_profile_picture_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  picture_url TEXT NOT NULL,
  picture_hash VARCHAR(255),
  face_detection_data JSONB,
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Work Assignments (NEW - for field and office work tracking)
CREATE TABLE IF NOT EXISTS work_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assignment_type VARCHAR(50) NOT NULL, -- 'office', 'field', 'remote'
  project_name VARCHAR(255),
  site_location VARCHAR(255),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  description TEXT,
  assigned_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Corporate Check-in/Check-out (REFACTORED - supports office and field)
CREATE TABLE IF NOT EXISTS corporate_checkins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  assignment_id UUID REFERENCES work_assignments(id),
  check_in_type VARCHAR(50) NOT NULL, -- 'office', 'field'
  check_in_time TIMESTAMP NOT NULL,
  check_out_time TIMESTAMP,
  check_in_latitude DECIMAL(10, 8),
  check_in_longitude DECIMAL(11, 8),
  check_out_latitude DECIMAL(10, 8),
  check_out_longitude DECIMAL(11, 8),
  site_location VARCHAR(255),
  face_verified BOOLEAN DEFAULT false,
  liveness_score DECIMAL(3, 2),
  anti_spoofing_score DECIMAL(3, 2),
  device_id VARCHAR(255),
  ip_address VARCHAR(45),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===========================
-- INDEXES FOR PERFORMANCE
-- ===========================

-- Core Indexes
CREATE INDEX IF NOT EXISTS idx_users_platform_id ON users(platform_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_platform_id ON audit_logs(platform_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- School Indexes
CREATE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id);
CREATE INDEX IF NOT EXISTS idx_students_student_id ON students(student_id);
CREATE INDEX IF NOT EXISTS idx_students_department_id ON students(department_id);
CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);

CREATE INDEX IF NOT EXISTS idx_faculty_user_id ON faculty(user_id);
CREATE INDEX IF NOT EXISTS idx_faculty_employee_id ON faculty(employee_id);
CREATE INDEX IF NOT EXISTS idx_faculty_department_id ON faculty(department_id);
CREATE INDEX IF NOT EXISTS idx_faculty_email ON faculty(email);

CREATE INDEX IF NOT EXISTS idx_student_face_embeddings_student_id ON student_face_embeddings(student_id);
CREATE INDEX IF NOT EXISTS idx_student_profile_picture_student_id ON student_profile_picture_embeddings(student_id);

CREATE INDEX IF NOT EXISTS idx_faculty_courses_faculty_id ON faculty_courses(faculty_id);
CREATE INDEX IF NOT EXISTS idx_faculty_courses_course_id ON faculty_courses(course_id);

CREATE INDEX IF NOT EXISTS idx_class_schedules_course_id ON class_schedules(course_id);
CREATE INDEX IF NOT EXISTS idx_class_schedules_faculty_id ON class_schedules(faculty_id);
CREATE INDEX IF NOT EXISTS idx_class_schedules_room_id ON class_schedules(room_id);

CREATE INDEX IF NOT EXISTS idx_student_courses_schedule_id ON student_courses(schedule_id);
CREATE INDEX IF NOT EXISTS idx_student_courses_student_id ON student_courses(student_id);

CREATE INDEX IF NOT EXISTS idx_school_attendance_schedule_id ON school_attendance(schedule_id);
CREATE INDEX IF NOT EXISTS idx_school_attendance_student_id ON school_attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_school_attendance_faculty_id ON school_attendance(marked_by_id);
CREATE INDEX IF NOT EXISTS idx_school_attendance_date ON school_attendance(attendance_date);

-- Corporate Indexes
CREATE INDEX IF NOT EXISTS idx_employees_user_id ON employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_department_id ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager_id ON employees(manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);

CREATE INDEX IF NOT EXISTS idx_employee_face_embeddings_employee_id ON employee_face_embeddings(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_profile_picture_employee_id ON employee_profile_picture_embeddings(employee_id);

CREATE INDEX IF NOT EXISTS idx_work_assignments_employee_id ON work_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_work_assignments_assigned_date ON work_assignments(assigned_date);
CREATE INDEX IF NOT EXISTS idx_work_assignments_is_active ON work_assignments(is_active);

CREATE INDEX IF NOT EXISTS idx_corporate_checkins_employee_id ON corporate_checkins(employee_id);
CREATE INDEX IF NOT EXISTS idx_corporate_checkins_assignment_id ON corporate_checkins(assignment_id);
CREATE INDEX IF NOT EXISTS idx_corporate_checkins_check_in_time ON corporate_checkins(check_in_time);
CREATE INDEX IF NOT EXISTS idx_corporate_checkins_check_in_type ON corporate_checkins(check_in_type);

-- ===========================
-- SEED DATA
-- ===========================

INSERT INTO platforms (name, display_name) VALUES 
  ('school', 'School Platform'),
  ('corporate', 'Corporate Platform')
ON CONFLICT DO NOTHING;

-- School Roles
INSERT INTO roles (platform_id, name, description, permissions) 
SELECT id, 'student', 'Student Role', '["view_attendance", "view_courses", "view_grades"]'::jsonb
FROM platforms WHERE name = 'school' ON CONFLICT DO NOTHING;

INSERT INTO roles (platform_id, name, description, permissions) 
SELECT id, 'faculty', 'Faculty/Instructor Role', '["mark_attendance", "view_reports", "manage_schedule"]'::jsonb
FROM platforms WHERE name = 'school' ON CONFLICT DO NOTHING;

INSERT INTO roles (platform_id, name, description, permissions) 
SELECT id, 'admin', 'School Administrator Role', '["manage_users", "manage_courses", "view_reports", "manage_system"]'::jsonb
FROM platforms WHERE name = 'school' ON CONFLICT DO NOTHING;

-- Corporate Roles
INSERT INTO roles (platform_id, name, description, permissions) 
SELECT id, 'employee', 'Employee Role', '["check_in", "view_history", "view_reports"]'::jsonb
FROM platforms WHERE name = 'corporate' ON CONFLICT DO NOTHING;

INSERT INTO roles (platform_id, name, description, permissions) 
SELECT id, 'hr_director', 'HR Director Role', '["view_analytics", "manage_policies", "view_all_attendance"]'::jsonb
FROM platforms WHERE name = 'corporate' ON CONFLICT DO NOTHING;

INSERT INTO roles (platform_id, name, description, permissions) 
SELECT id, 'manager', 'Manager Role', '["view_team_attendance", "approve_reports"]'::jsonb
FROM platforms WHERE name = 'corporate' ON CONFLICT DO NOTHING;
