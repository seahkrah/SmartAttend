# SMARTATTEND API Documentation

## Base URL
```
http://localhost:3000/api
```

---

## Authentication Endpoints

### 1. Register User
**POST** `/auth/register`

**Request Body:**
```json
{
  "platform": "school" | "corporate",
  "email": "user@example.com",
  "fullName": "John Doe",
  "password": "password123",
  "confirmPassword": "password123",
  "phone": "555-1234",
  "role": "optional_role_id"
}
```

**Response:** `201 Created`
```json
{
  "message": "User registered successfully",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "fullName": "John Doe",
    "platform": "school",
    "createdAt": "2026-01-27T..."
  }
}
```

---

### 2. Login
**POST** `/auth/login`

**Request Body:**
```json
{
  "platform": "school" | "corporate",
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:** `200 OK`
```json
{
  "message": "Login successful",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "fullName": "John Doe",
    "platform": "school",
    "role": "student",
    "permissions": ["view_attendance", "view_courses"],
    "profileImage": null
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

---

### 3. Refresh Token
**POST** `/auth/refresh`

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response:** `200 OK`
```json
{
  "message": "Token refreshed successfully",
  "accessToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

---

### 4. Get Current User
**GET** `/auth/me`

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Response:** `200 OK`
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "fullName": "John Doe",
    "platform": "school",
    "role": "student",
    "permissions": ["view_attendance", "view_courses"],
    "isActive": true,
    "lastLogin": "2026-01-27T..."
  }
}
```

---

### 5. Logout
**POST** `/auth/logout`

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Response:** `200 OK`
```json
{
  "message": "Logout successful"
}
```

---

## School Platform Endpoints

### Students

#### Get All Students
**GET** `/school/students?limit=20&offset=0&departmentId={id}`

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Response:** `200 OK`
```json
{
  "data": [
    {
      "id": "uuid",
      "student_id": "S12345",
      "first_name": "John",
      "middle_name": "Paul",
      "last_name": "Doe",
      "college": "Engineering",
      "email": "john@example.com",
      "status": "Freshman",
      "enrollment_year": 2026,
      "is_currently_enrolled": true,
      "created_at": "2026-01-27T..."
    }
  ],
  "total": 150,
  "limit": 20,
  "offset": 0
}
```

#### Get Single Student
**GET** `/school/students/{studentId}`

**Headers:**
```
Authorization: Bearer {accessToken}
```

#### Create Student
**POST** `/school/students`

**Headers:**
```
Authorization: Bearer {accessToken}
Content-Type: application/json
```

**Request Body:**
```json
{
  "userId": "uuid",
  "studentId": "S12345",
  "firstName": "John",
  "middleName": "Paul",
  "lastName": "Doe",
  "college": "Engineering",
  "email": "john@example.com",
  "status": "Freshman",
  "enrollmentYear": 2026,
  "departmentId": "uuid (optional)"
}
```

**Response:** `201 Created`

#### Update Student
**PUT** `/school/students/{studentId}`

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Request Body:** (any field to update)
```json
{
  "first_name": "Jane",
  "status": "Sophomore",
  "email": "jane@example.com"
}
```

#### Delete Student
**DELETE** `/school/students/{studentId}`

#### Get Student Schedules
**GET** `/school/students/{studentId}/schedules`

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "course_name": "Introduction to CS",
      "course_code": "CS101",
      "day_of_week": 0,
      "start_time": "09:00:00",
      "end_time": "10:30:00",
      "first_name": "Dr.",
      "last_name": "Smith",
      "room_number": "A101"
    }
  ]
}
```

#### Get Student Attendance
**GET** `/school/students/{studentId}/attendance?startDate=2026-01-01&endDate=2026-12-31`

---

### Faculty

#### Get All Faculty
**GET** `/school/faculty?limit=20&offset=0&departmentId={id}`

#### Get Single Faculty
**GET** `/school/faculty/{facultyId}`

#### Create Faculty
**POST** `/school/faculty`

**Request Body:**
```json
{
  "userId": "uuid",
  "employeeId": "F12345",
  "firstName": "John",
  "middleName": "Paul",
  "lastName": "Smith",
  "college": "Engineering",
  "email": "smith@example.com",
  "departmentId": "uuid (optional)",
  "specialization": "Computer Science",
  "officeLocation": "Building A, Room 301"
}
```

#### Update Faculty
**PUT** `/school/faculty/{facultyId}`

#### Get Faculty Courses
**GET** `/school/faculty/{facultyId}/courses`

#### Assign Faculty to Course
**POST** `/school/faculty/{facultyId}/courses/{courseId}`

**Response:**
```json
{
  "message": "Faculty assigned to course",
  "data": {
    "id": "uuid",
    "faculty_id": "uuid",
    "course_id": "uuid",
    "assigned_at": "2026-01-27T..."
  }
}
```

---

## Corporate Platform Endpoints

### Employees

#### Get All Employees
**GET** `/corporate/employees?limit=20&offset=0&departmentId={id}`

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "employee_id": "E12345",
      "first_name": "Jane",
      "middle_name": "Marie",
      "last_name": "Johnson",
      "email": "jane@company.com",
      "phone": "+1-555-0123",
      "designation": "Software Engineer",
      "employment_type": "full_time",
      "is_currently_employed": true,
      "date_of_joining": "2024-01-15",
      "created_at": "2026-01-27T..."
    }
  ],
  "total": 250,
  "limit": 20,
  "offset": 0
}
```

#### Get Single Employee
**GET** `/corporate/employees/{employeeId}`

#### Create Employee
**POST** `/corporate/employees`

**Request Body:**
```json
{
  "userId": "uuid",
  "employeeId": "E12345",
  "firstName": "Jane",
  "middleName": "Marie",
  "lastName": "Johnson",
  "email": "jane@company.com",
  "phone": "+1-555-0123",
  "departmentId": "uuid (optional)",
  "designation": "Software Engineer",
  "employmentType": "full_time",
  "dateOfJoining": "2024-01-15"
}
```

#### Update Employee
**PUT** `/corporate/employees/{employeeId}`

#### Terminate Employee
**PATCH** `/corporate/employees/{employeeId}/terminate`

---

### Work Assignments

#### Get Employee Active Assignments
**GET** `/corporate/employees/{employeeId}/assignments`

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "employee_id": "uuid",
      "assignment_type": "field",
      "project_name": "Bridge Construction",
      "site_location": "Downtown Site A",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "assigned_date": "2026-01-20",
      "end_date": null,
      "is_active": true,
      "created_at": "2026-01-27T..."
    }
  ]
}
```

#### Create Work Assignment
**POST** `/corporate/assignments`

**Request Body:**
```json
{
  "employeeId": "uuid",
  "assignmentType": "office" | "field" | "remote",
  "assignedDate": "2026-01-20",
  "projectName": "Project Name (optional)",
  "siteLocation": "Location (optional)",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "endDate": "2026-02-20 (optional)",
  "description": "Assignment description (optional)"
}
```

#### End Work Assignment
**PATCH** `/corporate/assignments/{assignmentId}/end`

**Request Body:**
```json
{
  "endDate": "2026-02-20 (optional - defaults to today)"
}
```

---

### Check-in/Check-out

#### Record Check-in
**POST** `/corporate/checkins`

**Request Body:**
```json
{
  "employeeId": "uuid",
  "checkInType": "office" | "field",
  "checkInLatitude": 40.7128,
  "checkInLongitude": -74.0060,
  "siteLocation": "Building A, Floor 1",
  "assignmentId": "uuid (optional)",
  "faceVerified": false
}
```

**Response:** `201 Created`
```json
{
  "message": "Check-in recorded",
  "data": {
    "id": "uuid",
    "employee_id": "uuid",
    "check_in_type": "field",
    "check_in_time": "2026-01-27T09:30:00Z",
    "check_in_latitude": 40.7128,
    "check_in_longitude": -74.0060,
    "face_verified": false
  }
}
```

#### Record Check-out
**POST** `/corporate/checkins/{checkinId}/checkout`

**Request Body:**
```json
{
  "checkOutLatitude": 40.7135,
  "checkOutLongitude": -74.0055
}
```

#### Get Employee Check-ins
**GET** `/corporate/employees/{employeeId}/checkins?days=30`

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "employee_id": "uuid",
      "check_in_time": "2026-01-27T09:30:00Z",
      "check_out_time": "2026-01-27T18:00:00Z",
      "check_in_type": "field",
      "face_verified": true,
      "liveness_score": 0.95,
      "anti_spoofing_score": 0.98
    }
  ]
}
```

#### Get Department Daily Attendance
**GET** `/corporate/checkins/department/{departmentId}`

**Response:**
```json
{
  "data": [
    {
      "employee_id": "E12345",
      "first_name": "Jane",
      "last_name": "Johnson",
      "check_in_time": "2026-01-27T09:30:00Z",
      "check_out_time": "2026-01-27T18:00:00Z",
      "check_in_type": "office",
      "face_verified": true
    }
  ]
}
```

---

## Error Responses

All endpoints return standard error responses:

### 400 Bad Request
```json
{
  "error": "Missing required fields"
}
```

### 401 Unauthorized
```json
{
  "error": "Access token required"
}
```

### 403 Forbidden
```json
{
  "error": "Invalid token"
}
```

### 404 Not Found
```json
{
  "error": "Resource not found"
}
```

### 409 Conflict
```json
{
  "error": "Email already registered"
}
```

### 500 Internal Server Error
```json
{
  "error": "Error message"
}
```

---

## Authentication

All protected endpoints require the `Authorization` header with a valid JWT token:

```
Authorization: Bearer {accessToken}
```

Access tokens expire in **24 hours**.  
Refresh tokens expire in **7 days**.

Use the `/auth/refresh` endpoint to get a new access token when it expires.

---

## Rate Limiting

No rate limiting currently implemented. Can be added based on requirements.

---

## Pagination

Endpoints that return lists support pagination:

- `limit`: Number of results per page (default: 20)
- `offset`: Starting position (default: 0)

Example:
```
GET /school/students?limit=50&offset=100
```

---

## Search & Filtering

List endpoints support filtering:

- Students: `departmentId`
- Faculty: `departmentId`
- Employees: `departmentId`
- Check-ins: `days` (number of days to retrieve)

---

## Data Types

### Student Status
- `Freshman`
- `Sophomore`
- `Junior`
- `Senior`

### Employment Type
- `full_time`
- `part_time`
- `contract`
- `intern`

### Assignment Type
- `office` - Office-based work
- `field` - Site/location-based work
- `remote` - Remote work

### Check-in Type
- `office` - Office attendance
- `field` - Field work check-in

### Attendance Status
- `present`
- `absent`
- `late`
- `excused`

---

## Example Workflow

### School Platform - Student Registration & Attendance

1. **Register student user:**
   ```
   POST /auth/register
   {
     "platform": "school",
     "email": "student@example.com",
     "fullName": "John Doe",
     "password": "password123",
     "confirmPassword": "password123"
   }
   ```

2. **Login as student:**
   ```
   POST /auth/login
   {
     "platform": "school",
     "email": "student@example.com",
     "password": "password123"
   }
   ```
   → Get `accessToken`

3. **Create student profile:**
   ```
   POST /school/students
   Authorization: Bearer {accessToken}
   {
     "userId": "{returned from registration}",
     "studentId": "S12345",
     "firstName": "John",
     "lastName": "Doe",
     "college": "Engineering",
     "email": "student@example.com",
     "status": "Freshman",
     "enrollmentYear": 2026
   }
   ```

4. **View student schedules:**
   ```
   GET /school/students/{studentId}/schedules
   Authorization: Bearer {accessToken}
   ```

5. **View attendance:**
   ```
   GET /school/students/{studentId}/attendance
   Authorization: Bearer {accessToken}
   ```

---

## Implementation Status

✅ **Completed:**
- Authentication (register, login, token management)
- Student CRUD operations
- Faculty CRUD operations  
- Employee CRUD operations
- Work assignments management
- Check-in/Check-out system
- Department attendance reporting

🔄 **In Progress:**
- Attendance marking endpoints
- Course management
- Enrollment endpoints
- Face recognition integration

❌ **Not Started:**
- Admin dashboard endpoints
- Analytics/reporting endpoints
- Bulk operations
- Advanced filtering
