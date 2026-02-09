-- ===========================
-- SMARTATTEND DATABASE SCHEMA
-- ===========================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===========================
-- CORE TABLES
-- ===========================

-- Platforms (School, Corporate)
CREATE TABLE IF NOT EXISTS platforms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL UNIQUE, -- 'school' or 'corporate'
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unified Roles (for both platforms)
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(platform_id, name)
);

-- Unified Users (base user table for both platforms)
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

-- Audit Logs (for both platforms)
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
-- SCHOOL PLATFORM TABLES
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

-- Students (School)
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  student_id VARCHAR(50) NOT NULL UNIQUE,
  department_id UUID REFERENCES school_departments(id),
  enrollment_year INT NOT NULL,
  is_currently_enrolled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Faculty (School)
CREATE TABLE IF NOT EXISTS faculty (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_id VARCHAR(50) NOT NULL UNIQUE,
  department_id UUID REFERENCES school_departments(id),
  specialization VARCHAR(255),
  office_location VARCHAR(100),
  office_hours TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- School Face Embeddings (for facial recognition)
CREATE TABLE IF NOT EXISTS school_face_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  embedding_url TEXT NOT NULL, -- Cloudinary URL
  embedding_hash VARCHAR(255),
  liveness_score DECIMAL(3, 2),
  is_verified BOOLEAN DEFAULT false,
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, embedding_hash)
);

-- School Profile Picture Embeddings
CREATE TABLE IF NOT EXISTS school_profile_picture_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  picture_url TEXT NOT NULL, -- Cloudinary URL
  picture_hash VARCHAR(255),
  face_detection_data JSONB, -- Coordinates, landmarks, etc.
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
  instructor_id UUID NOT NULL REFERENCES faculty(id),
  max_capacity INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(semester_id, code)
);

-- Classrooms/Rooms
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES school_departments(id),
  room_number VARCHAR(50) NOT NULL,
  capacity INT,
  building VARCHAR(100),
  floor INT,
  resources JSONB DEFAULT '[]', -- projector, whiteboard, etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(department_id, room_number)
);

-- Class Schedules
CREATE TABLE IF NOT EXISTS class_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id),
  room_id UUID NOT NULL REFERENCES rooms(id),
  day_of_week INT NOT NULL, -- 0=Monday, 6=Sunday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Enrollments (Students in Courses)
CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id),
  student_id UUID NOT NULL REFERENCES students(id),
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  grade VARCHAR(2),
  is_active BOOLEAN DEFAULT true,
  UNIQUE(course_id, student_id)
);

-- School Attendance
CREATE TABLE IF NOT EXISTS school_attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id UUID NOT NULL REFERENCES courses(id),
  student_id UUID NOT NULL REFERENCES students(id),
  marked_by_id UUID NOT NULL REFERENCES faculty(id),
  attendance_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL, -- 'present', 'absent', 'late', 'excused'
  remarks TEXT,
  face_verified BOOLEAN DEFAULT false,
  marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(course_id, student_id, attendance_date)
);

-- ===========================
-- CORPORATE PLATFORM TABLES
-- ===========================

-- Corporate Departments
CREATE TABLE IF NOT EXISTS corporate_departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL UNIQUE,
  code VARCHAR(50) UNIQUE,
  description TEXT,
  budget DECIMAL(15, 2),
  head_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Employees (Corporate)
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  employee_id VARCHAR(50) NOT NULL UNIQUE,
  department_id UUID REFERENCES corporate_departments(id),
  designation VARCHAR(255),
  employment_type VARCHAR(50), -- 'full_time', 'part_time', 'contract', 'intern'
  date_of_joining DATE NOT NULL,
  is_currently_employed BOOLEAN DEFAULT true,
  manager_id UUID REFERENCES employees(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Corporate Face Embeddings (for facial recognition with anti-spoofing)
CREATE TABLE IF NOT EXISTS corporate_face_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  embedding_url TEXT NOT NULL, -- Cloudinary URL
  embedding_hash VARCHAR(255),
  liveness_score DECIMAL(3, 2),
  anti_spoofing_score DECIMAL(3, 2),
  is_verified BOOLEAN DEFAULT false,
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, embedding_hash)
);

-- Corporate Profile Picture Embeddings
CREATE TABLE IF NOT EXISTS corporate_profile_picture_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  picture_url TEXT NOT NULL, -- Cloudinary URL
  picture_hash VARCHAR(255),
  face_detection_data JSONB, -- Coordinates, landmarks, etc.
  captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Shifts
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES corporate_departments(id),
  name VARCHAR(100) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(department_id, name)
);

-- Employee Shift Assignments
CREATE TABLE IF NOT EXISTS employee_shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  shift_id UUID NOT NULL REFERENCES shifts(id),
  assigned_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(employee_id, shift_id, assigned_date)
);

-- Locations (for location-based check-in)
CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES corporate_departments(id),
  name VARCHAR(255) NOT NULL,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  radius_meters INT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Corporate Check-in/Out
CREATE TABLE IF NOT EXISTS corporate_checkins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  check_in_time TIMESTAMP NOT NULL,
  check_out_time TIMESTAMP,
  location_id UUID REFERENCES locations(id),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  face_verified BOOLEAN DEFAULT false,
  liveness_score DECIMAL(3, 2),
  anti_spoofing_score DECIMAL(3, 2),
  device_id VARCHAR(255),
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit Logs (for both platforms)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  user_id UUID,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100),
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(45),
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

CREATE INDEX IF NOT EXISTS idx_faculty_user_id ON faculty(user_id);
CREATE INDEX IF NOT EXISTS idx_faculty_employee_id ON faculty(employee_id);
CREATE INDEX IF NOT EXISTS idx_faculty_department_id ON faculty(department_id);

CREATE INDEX IF NOT EXISTS idx_school_face_embeddings_user_id ON school_face_embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_school_profile_picture_user_id ON school_profile_picture_embeddings(user_id);

-- Indexes removed: school_attendance and enrollments are dropped in migration 002
-- These tables get recreated with different schemas, so indexes moved to migration 002

-- Corporate Indexes
CREATE INDEX IF NOT EXISTS idx_employees_user_id ON employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_department_id ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager_id ON employees(manager_id);

CREATE INDEX IF NOT EXISTS idx_corporate_face_embeddings_user_id ON corporate_face_embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_corporate_profile_picture_user_id ON corporate_profile_picture_embeddings(user_id);

CREATE INDEX IF NOT EXISTS idx_corporate_checkins_employee_id ON corporate_checkins(employee_id);
CREATE INDEX IF NOT EXISTS idx_corporate_checkins_check_in_time ON corporate_checkins(check_in_time);

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
SELECT id, 'admin', 'Corporate Administrator Role', '["manage_system", "audit_logs", "manage_users"]'::jsonb
FROM platforms WHERE name = 'corporate' ON CONFLICT DO NOTHING;

