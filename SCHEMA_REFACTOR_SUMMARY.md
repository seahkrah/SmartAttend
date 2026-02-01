# SMARTATTEND Database Schema - Refactored Design

## Summary of Changes

The database schema has been completely refactored to better support the dual-platform architecture (School and Corporate) with improved data modeling for biodata collection, course tracking, and flexible check-in systems.

---

## CORE TABLES (Unchanged)

### **platforms**
- `id`, `name` (UNIQUE), `display_name`, `created_at`

### **roles**
- `id`, `platform_id` (FK), `name`, `description`, `permissions` (JSONB), `created_at`

### **users**
- `id`, `platform_id` (FK), `email`, `full_name`, `phone`, `role_id` (FK), `password_hash`, `profile_image_url`, `is_active`, `last_login`, `created_at`, `updated_at`

### **audit_logs**
- `id`, `platform_id` (FK), `user_id` (FK), `action`, `entity_type`, `entity_id`, `old_values` (JSONB), `new_values` (JSONB), `ip_address`, `created_at`

---

## SCHOOL PLATFORM - NEW STRUCTURE

### **school_departments**
- `id`, `name` (UNIQUE), `code` (UNIQUE), `description`, `head_id` (FK), `created_at`

### **students** ⭐ REFACTORED
**New Biodata Attributes:**
- `first_name` (VARCHAR 100, NOT NULL)
- `middle_name` (VARCHAR 100, optional)
- `last_name` (VARCHAR 100, NOT NULL)
- `college` (VARCHAR 255, NOT NULL)
- `email` (VARCHAR 255, NOT NULL)
- `status` (VARCHAR 50) - 'Freshman' | 'Sophomore' | 'Junior' | 'Senior'

**Existing Attributes:**
- `id`, `user_id` (UNIQUE, FK), `student_id` (UNIQUE), `department_id` (FK), `enrollment_year`, `is_currently_enrolled`, `created_at`

### **faculty** ⭐ REFACTORED
**New Biodata Attributes:**
- `first_name` (VARCHAR 100, NOT NULL)
- `middle_name` (VARCHAR 100, optional)
- `last_name` (VARCHAR 100, NOT NULL)
- `college` (VARCHAR 255, NOT NULL)
- `email` (VARCHAR 255, NOT NULL)

**Existing Attributes:**
- `id`, `user_id` (UNIQUE, FK), `employee_id` (UNIQUE), `department_id` (FK), `specialization`, `office_location`, `office_hours`, `created_at`

### **student_face_embeddings** ⭐ NEW (replaces school_face_embeddings)
- `id`, `student_id` (FK, replaces user_id), `embedding_url`, `embedding_hash`, `liveness_score`, `is_verified`, `captured_at`

### **student_profile_picture_embeddings** ⭐ NEW (replaces school_profile_picture_embeddings)
- `id`, `student_id` (UNIQUE, FK, replaces user_id), `picture_url`, `picture_hash`, `face_detection_data` (JSONB), `captured_at`, `updated_at`

### **semesters**
- `id`, `department_id` (FK), `name`, `start_date`, `end_date`, `is_active`, `created_at`

### **courses**
- `id`, `department_id` (FK), `semester_id` (FK), `code`, `name`, `credits`, `description`, `max_capacity`, `created_at`
- **Removed:** `instructor_id` (moved to faculty_courses)

### **faculty_courses** ⭐ NEW
Tracks which courses each faculty teaches (many-to-many relationship)
- `id`, `faculty_id` (FK), `course_id` (FK), `assigned_at`
- Unique: (faculty_id, course_id)

### **rooms** ⭐ SIMPLIFIED
**Removed Attributes:**
- ~~`department_id`~~
- ~~`floor`~~
- ~~`resources`~~

**Remaining Attributes:**
- `id`, `room_number` (UNIQUE), `capacity`, `building`, `created_at`

### **class_schedules** ⭐ ENHANCED
**New Attribute:**
- `faculty_id` (FK) - Links directly to faculty member teaching this schedule

**Existing Attributes:**
- `id`, `course_id` (FK), `room_id` (FK), `day_of_week`, `start_time`, `end_time`, `created_at`

### **student_courses** ⭐ NEW
Tracks which students are enrolled in which class schedules (many-to-many)
- `id`, `schedule_id` (FK to class_schedules), `student_id` (FK), `enrolled_at`, `is_active`
- Unique: (schedule_id, student_id)
- **Purpose:** Supports multiple sections of the same course with different times/faculty

### **school_attendance** ⭐ REFACTORED
**Changed Reference:**
- ~~`course_id`~~ → `schedule_id` (FK to class_schedules)

**New Attribute:**
- `schedule_id` (FK) - Links to specific class schedule instead of general course

**Removed:**
- ~~`course_id`~~

**Existing Attributes:**
- `id`, `student_id` (FK), `marked_by_id` (FK to faculty), `attendance_date`, `status` ('present'|'absent'|'late'|'excused'), `remarks`, `face_verified`, `marked_at`, `created_at`
- Unique: (schedule_id, student_id, attendance_date)

---

## CORPORATE PLATFORM - NEW STRUCTURE

### **corporate_departments** ⭐ SIMPLIFIED
**Removed:**
- ~~`budget`~~

**Remaining Attributes:**
- `id`, `name` (UNIQUE), `code` (UNIQUE), `description`, `head_id` (FK), `created_at`

### **employees** ⭐ COMPLETELY REFACTORED
**New Biodata and Contact Attributes:**
- `first_name` (VARCHAR 100, NOT NULL)
- `middle_name` (VARCHAR 100, optional)
- `last_name` (VARCHAR 100, NOT NULL)
- `email` (VARCHAR 255, NOT NULL)
- `phone` (VARCHAR 20, NOT NULL)

**Existing Attributes:**
- `id`, `user_id` (UNIQUE, FK), `employee_id` (UNIQUE), `department_id` (FK), `designation`, `employment_type` ('full_time'|'part_time'|'contract'|'intern'), `date_of_joining`, `is_currently_employed`, `manager_id` (self-referencing FK), `created_at`

### **employee_face_embeddings** ⭐ NEW (replaces corporate_face_embeddings)
- `id`, `employee_id` (FK, replaces user_id), `embedding_url`, `embedding_hash`, `liveness_score`, `anti_spoofing_score`, `is_verified`, `captured_at`

### **employee_profile_picture_embeddings** ⭐ NEW (replaces corporate_profile_picture_embeddings)
- `id`, `employee_id` (UNIQUE, FK, replaces user_id), `picture_url`, `picture_hash`, `face_detection_data` (JSONB), `captured_at`, `updated_at`

### **work_assignments** ⭐ NEW (replaces shifts + locations concept)
Flexible system for tracking office, field, and remote assignments
- `id`, `employee_id` (FK), `assignment_type` ('office'|'field'|'remote'), `project_name`, `site_location`, `latitude`, `longitude`, `description`, `assigned_date`, `end_date`, `is_active`, `created_at`
- **Purpose:** Tracks where each employee is assigned to work (office desk, field site, project, etc.)

### **corporate_checkins** ⭐ COMPLETELY REDESIGNED
**Supports Both Office and Field Check-ins:**
- `id`, `employee_id` (FK), `assignment_id` (FK to work_assignments), `check_in_type` ('office'|'field')
- `check_in_time`, `check_out_time`
- `check_in_latitude`, `check_in_longitude` - GPS at check-in
- `check_out_latitude`, `check_out_longitude` - GPS at check-out
- `site_location` - Text description of location
- `face_verified`, `liveness_score`, `anti_spoofing_score`
- `device_id`, `ip_address`, `notes`, `created_at`

**How It Works:**
1. **Office Check-in:** `check_in_type='office'`, optional GPS, links to office assignment
2. **Field Check-in:** `check_in_type='field'`, GPS coordinates required, links to field assignment
3. **Flexible Tracking:** GPS captured at both check-in and check-out for field work validation
4. **Assignment Context:** Links to work_assignments to show what project/site employee is working on

### **Removed Tables:**
- ~~`shifts`~~ - Replaced by work_assignments
- ~~`employee_shifts`~~ - Replaced by work_assignments
- ~~`locations`~~ - GPS coordinates now directly on work_assignments and corporate_checkins

---

## KEY DESIGN IMPROVEMENTS

### School Platform
1. ✅ **Biodata Collection:** Students and faculty now have structured name fields (first, middle, last)
2. ✅ **College/Institution:** Both have college attribute for multi-college systems
3. ✅ **Student Status:** Academic standing tracked (Freshman, Sophomore, etc.)
4. ✅ **Course Management:** Multiple sections of same course supported via class_schedules
5. ✅ **Better Enrollment:** student_courses links students to specific schedules, not just courses
6. ✅ **Attendance Accuracy:** Attendance now tied to specific schedule, supporting multiple sections
7. ✅ **Simplified Rooms:** Removed department coupling and resources field (can be added to courses if needed)
8. ✅ **Face Embeddings:** Moved to student_face_embeddings for clarity

### Corporate Platform
1. ✅ **Biodata Collection:** Employees have structured name fields
2. ✅ **Contact Info:** Direct email and phone storage
3. ✅ **Flexible Assignments:** work_assignments supports office, field, and remote work
4. ✅ **Dual Check-in:** Supports both office attendance and field location tracking
5. ✅ **GPS Tracking:** Check-in and check-out coordinates for field validation
6. ✅ **Assignment Context:** Check-ins linked to specific work assignments
7. ✅ **Removed Complexity:** Simplified from shifts+locations to single assignment table
8. ✅ **Face Embeddings:** Moved to employee_face_embeddings for clarity

---

## INDEXES CREATED (35 total)

All foreign keys are indexed for performance. Additional indexes on:
- Email fields (for lookups)
- Frequently filtered dates
- Assignment active status
- Check-in type classification

---

## MIGRATION NOTES

- Old tables dropped and recreated
- Core tables (platforms, roles, users, audit_logs) preserved
- New entities: `faculty_courses`, `student_courses`, `work_assignments`
- Renamed entities: `student_face_embeddings`, `student_profile_picture_embeddings`, `employee_face_embeddings`, `employee_profile_picture_embeddings`
- All seed data (platforms, roles with permissions) re-inserted

---

## NEXT STEPS

1. Update backend query functions to use new table references
2. Implement API endpoints for new entities (faculty_courses, student_courses, work_assignments)
3. Create admin interfaces for managing course-faculty assignments
4. Build attendance marking with schedule-based system
5. Implement flexible check-in logic for corporate platform
