# Role-Based Access Control - Architecture & Database Design

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     SMARTATTEND PLATFORM                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐              ┌──────────────────┐           │
│  │  SCHOOL ADMIN   │              │ CORPORATE ADMIN  │           │
│  └────────┬────────┘              └────────┬─────────┘           │
│           │                                 │                     │
│           └─────────────┬───────────────────┘                     │
│                         │                                         │
│           ┌─────────────▼────────────────┐                       │
│           │   Admin Approval Dashboard   │                       │
│           │   - View Pending Requests   │                       │
│           │   - Approve/Reject Users    │                       │
│           │   - Track Approvals         │                       │
│           └────────────┬────────────────┘                        │
│                        │                                          │
│    ┌───────────────────┼───────────────────┐                     │
│    │                   │                   │                     │
│    ▼                   ▼                   ▼                      │
│  USERS              ROLES           ENTITIES                    │
│  (Active)         (Permissions)    (Schools/Corps)             │
│                                                                   │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐               │
│  │ Student  │    │ Student  │    │ Primary Uni  │               │
│  │ Faculty  │───▶│ Faculty  │───▶│ Secondary Uni│               │
│  │ IT       │    │ IT       │    │ Tech Corp    │               │
│  │ Employee │    │ Employee │    │ Finance Ltd  │               │
│  │ HR       │    │ HR       │    └──────────────┘               │
│  └──────────┘    └──────────┘                                   │
│       ▲                ▲                                          │
│       │                │                                          │
│    ┌──┴────────────────┴──┐                                     │
│    │  PENDING APPROVALS   │                                     │
│    │  - Faculty/IT (School│                                     │
│    │  - IT/HR (Corporate) │                                     │
│    └─────────────────────┘                                      │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 Database Schema

### Core Tables (Existing)

```
platforms
├── id (UUID)
├── name ('school' | 'corporate')
└── display_name

roles
├── id (UUID)
├── platform_id (FK → platforms)
├── name (VARCHAR)
├── permissions (JSONB)
└── ...

users
├── id (UUID)
├── platform_id (FK → platforms)
├── email (VARCHAR)
├── full_name (VARCHAR)
├── role_id (FK → roles)
├── is_active (BOOLEAN)
└── ...
```

### New Entity Management Tables

```
school_entities
├── id (UUID, PK)
├── name (VARCHAR, UNIQUE)
├── code (VARCHAR)
├── address (TEXT)
├── phone (VARCHAR)
├── email (VARCHAR)
├── admin_user_id (FK → users)
└── is_active (BOOLEAN)

corporate_entities
├── id (UUID, PK)
├── name (VARCHAR, UNIQUE)
├── code (VARCHAR)
├── industry (VARCHAR)
├── headquarters_address (TEXT)
├── phone (VARCHAR)
├── email (VARCHAR)
├── admin_user_id (FK → users)
└── is_active (BOOLEAN)
```

### User Association Tables

```
school_user_associations
├── id (UUID, PK)
├── user_id (FK → users)
├── school_entity_id (FK → school_entities)
├── status ('active' | 'inactive' | 'suspended')
└── assigned_at (TIMESTAMP)
UNIQUE(user_id, school_entity_id)

corporate_user_associations
├── id (UUID, PK)
├── user_id (FK → users)
├── corporate_entity_id (FK → corporate_entities)
├── department_id (FK → corporate_departments)
├── status ('active' | 'inactive' | 'suspended')
└── assigned_at (TIMESTAMP)
UNIQUE(user_id, corporate_entity_id)
```

### Approval Workflow Tables

```
school_user_approvals
├── id (UUID, PK)
├── user_id (FK → users)
├── school_entity_id (FK → school_entities)
├── requested_role ('faculty' | 'it')
├── status ('pending' | 'approved' | 'rejected')
├── requested_at (TIMESTAMP)
├── approved_by_user_id (FK → users)
├── approved_at (TIMESTAMP)
├── rejection_reason (TEXT)
└── UNIQUE(user_id, school_entity_id, requested_role)

corporate_user_approvals
├── id (UUID, PK)
├── user_id (FK → users)
├── corporate_entity_id (FK → corporate_entities)
├── requested_role ('it' | 'hr')
├── status ('pending' | 'approved' | 'rejected')
├── requested_at (TIMESTAMP)
├── approved_by_user_id (FK → users)
├── approved_at (TIMESTAMP)
├── rejection_reason (TEXT)
└── UNIQUE(user_id, corporate_entity_id, requested_role)
```

---

## 🔄 User Lifecycle

### Auto-Approved Roles (Student, Employee)

```
┌─ Registration Form
│  - Select Platform
│  - Select Role (Student/Employee)
│  - Select Entity
│  - Fill Details
│
├─ Backend Processing
│  1. Validate platform & role
│  2. Check entity exists
│  3. Hash password
│  4. Create user (is_active = TRUE)
│  5. Create association
│  6. Return status = 'active'
│
└─ User Result
   ✅ Active immediately
   ✅ Can login now
   ✅ Full access
```

### Approval-Required Roles (Faculty, IT, HR)

```
┌─ Registration Form
│  - Select Platform
│  - Select Role (Faculty/IT/HR)
│  - Select Entity
│  - Fill Details
│
├─ Backend Processing
│  1. Validate platform & role
│  2. Check entity exists
│  3. Hash password
│  4. Create user (is_active = FALSE)
│  5. Create approval request (status = 'pending')
│  6. Return status = 'pending_approval'
│
├─ Frontend Display
│  ⏳ "Pending admin approval"
│  ⏳ "You will be notified once approved"
│
├─ Admin Workflow
│  1. Admin sees in dashboard
│  2. Clicks Approve
│  3. Backend:
│     - Update user (is_active = TRUE)
│     - Update approval (status = 'approved')
│     - Create association
│  4. Dashboard updates
│
└─ User Result
   ✅ Now active
   ✅ Can login
   ✅ Full access
   (OR ✗ Rejected - deleted)
```

---

## 🎯 Data Isolation Model

### By Entity
Each school or corporate entity is completely isolated:

```
Primary University
├── Students (Can see each other's course data)
├── Faculty (Can see all students, attendance)
├── IT Admin (System access for this school)
└── Data: Only PU students, PU courses, PU attendance
    ✗ Cannot see: Secondary University data

Secondary University
├── Students (Can see each other's course data)
├── Faculty (Can see all students, attendance)
├── IT Admin (System access for this school)
└── Data: Only SU students, SU courses, SU attendance
    ✗ Cannot see: Primary University data
```

### By Role
Users only see data relevant to their role:

```
SCHOOL - Student Role
├── View own attendance
├── View own courses/grades
└── ✗ Cannot: Manage other students, view school admin

SCHOOL - Faculty Role
├── Mark attendance for own courses
├── View course students
├── View attendance reports
└── ✗ Cannot: Create courses, manage roles

SCHOOL - IT Role
├── Manage school users
├── System administration
├── View all reports
└── ✗ Cannot: Modify other schools' data

CORPORATE - Employee Role
├── Check in/out
├── View own history
└── ✗ Cannot: View other employees' data

CORPORATE - HR Role
├── Manage employees
├── View all attendance
├── Approve assignments
└── ✗ Cannot: Modify other companies' data
```

---

## 🔐 Query Examples

### Find all pending Faculty requests for a school

```sql
SELECT sua.*, u.email, u.full_name
FROM school_user_approvals sua
JOIN users u ON sua.user_id = u.id
WHERE sua.school_entity_id = $1
  AND sua.requested_role = 'faculty'
  AND sua.status = 'pending'
ORDER BY sua.requested_at DESC;
```

### Get all active users in a school

```sql
SELECT u.*, r.name as role_name
FROM users u
JOIN school_user_associations sua ON u.id = sua.user_id
JOIN roles r ON u.role_id = r.id
WHERE sua.school_entity_id = $1
  AND sua.status = 'active'
  AND u.is_active = true;
```

### Check if email exists in other entities

```sql
SELECT DISTINCT se.name, se.id
FROM users u
JOIN school_user_associations sua ON u.id = sua.user_id
JOIN school_entities se ON sua.school_entity_id = se.id
WHERE u.email = $1
  AND u.platform_id = (SELECT id FROM platforms WHERE name = 'school');
```

### Get all rejections with reasons

```sql
SELECT sua.*, u.email, u.full_name, au.email as admin_email
FROM school_user_approvals sua
JOIN users u ON sua.user_id = u.id
LEFT JOIN users au ON sua.approved_by_user_id = au.id
WHERE sua.status = 'rejected'
  AND sua.school_entity_id = $1
ORDER BY sua.approved_at DESC;
```

---

## 🔗 Entity Relationships

### User → Role → Permissions

```
User (John)
├── role_id → Role (Faculty)
│   └── permissions: [
│       "mark_attendance",
│       "view_reports",
│       "manage_schedule"
│     ]
└── platform_id → Platform (School)
```

### User → Entity Associations

```
User (John)
├── users table
│  └── platform_id = school
│      role_id = faculty
│
├── school_user_associations
│  ├── school_entity_id = uuid-1 (Primary University)
│  │   └── status = 'active'
│  │
│  ├── school_user_approvals (if pending)
│  │   └── status = 'pending'
```

### Admin → Entity → Users

```
User (Admin)
├── admin_user_id in school_entities (Primary University)
│   ├── Can see all school_user_approvals for PU
│   ├── Can approve/reject PU registrations
│   └── Cannot touch Secondary University
│
├── admin_user_id in corporate_entities (Tech Corp)
│   ├── Can see all corporate_user_approvals for TC
│   ├── Can approve/reject TC registrations
│   └── Cannot touch other corporate entities
```

---

## 🚀 Performance Optimizations

### Indexes Created

```sql
CREATE INDEX idx_school_user_approvals_status 
  ON school_user_approvals(status);

CREATE INDEX idx_school_user_approvals_school_entity_id 
  ON school_user_approvals(school_entity_id);

CREATE INDEX idx_corporate_user_approvals_status 
  ON corporate_user_approvals(status);

CREATE INDEX idx_corporate_user_approvals_corporate_entity_id 
  ON corporate_user_approvals(corporate_entity_id);

CREATE INDEX idx_school_user_associations_user_id 
  ON school_user_associations(user_id);

CREATE INDEX idx_school_user_associations_school_entity_id 
  ON school_user_associations(school_entity_id);

CREATE INDEX idx_corporate_user_associations_user_id 
  ON corporate_user_associations(user_id);

CREATE INDEX idx_corporate_user_associations_corporate_entity_id 
  ON corporate_user_associations(corporate_entity_id);
```

### Query Patterns

**Get pending approvals (with admin check):**
- Uses status index ✅
- Uses entity_id index ✅
- Joins to verify admin relationship ✅

**Find user's entities:**
- Uses user_id index ✅
- Single join per entity ✅

---

## 📋 Approval State Machine

### School Faculty/IT Registration States

```
        ┌─ PENDING
        │  └── Admin reviews
        │
    Start──┼─ APPROVED
        │  │  ├── User activated
        │  │  ├── Association created
        │  │  └── User can login
        │  │
        └─ REJECTED
           ├── User deleted
           ├── Reason logged
           └── User must re-register
```

### State Transitions

```
PENDING → APPROVED
- Condition: Admin clicks Approve
- Action: 
  1. Update approval.status = 'approved'
  2. Update user.is_active = true
  3. Create association
  4. Log timestamp

PENDING → REJECTED
- Condition: Admin clicks Reject
- Action:
  1. Update approval.status = 'rejected'
  2. Delete user record
  3. Log rejection reason
  4. Log timestamp

APPROVED → (no transitions)
- Once approved, registration is complete

REJECTED → (no transitions)
- User deleted, cannot transition
```

---

## 🔐 Security Considerations

### Admin Authorization
```
Before allowing approval action:
1. Get approval record
2. Find owning entity (school_entities/corporate_entities)
3. Check: admin_user_id == current_user_id
4. If mismatch: throw "Not authorized"
```

### Role Validation
```
At registration:
1. Get platform ID
2. Validate role exists for platform
3. Check role name is in approved list
4. Prevent arbitrary role selection
```

### Entity Isolation
```
In all queries:
- Always include entity check
- Never retrieve cross-entity data
- Verify user association before showing data
- Log cross-entity access attempts
```

### Password Security
```
1. Hash with bcryptjs (10 salt rounds)
2. Never return in responses
3. Compare in auth service only
4. Never log plaintext
```

---

## 📈 Scaling Considerations

### As Platform Grows

**Current capacity:**
- Unlimited schools/corporate entities
- Per-entity admins (no central bottleneck)
- Per-entity approvals (localized workflow)

**Optimization points:**
1. Archive old approvals to separate table
2. Partition user data by entity
3. Cache role permissions
4. Batch approval operations

---

## 🧪 Test Coverage

### Unit Tests Needed
- `registerUserWithRole()` - All role combinations
- `getPendingApprovalsForAdmin()` - Authorization checks
- `approveOrRejectRegistration()` - State transitions
- Role validation functions
- Entity lookup functions

### Integration Tests Needed
- Full registration → approval → login flow
- Cross-entity isolation verification
- Admin authorization verification
- Approval state machine transitions
- Email notification triggers (if implemented)

### E2E Tests Needed
- Student auto-registration flow
- Faculty approval workflow
- Multiple entities isolation
- Admin dashboard functionality
- Role-based data filtering

---

## 📝 Migration Rollback Plan

If needed to rollback to previous system:

```sql
-- 1. Delete all new tables
DROP TABLE IF EXISTS school_user_approvals CASCADE;
DROP TABLE IF EXISTS corporate_user_approvals CASCADE;
DROP TABLE IF EXISTS school_user_associations CASCADE;
DROP TABLE IF EXISTS corporate_user_associations CASCADE;
DROP TABLE IF EXISTS school_entities CASCADE;
DROP TABLE IF EXISTS corporate_entities CASCADE;

-- 2. Remove new roles
DELETE FROM roles WHERE name IN ('it', 'hr');

-- 3. Revert backend code to previous commit
git checkout HEAD~1 -- apps/backend

-- 4. Revert frontend code to previous commit
git checkout HEAD~1 -- apps/frontend

-- 5. Rebuild and redeploy
```

---

## 🎓 Summary

This role-based system provides:

✅ **Multi-entity support** - Multiple schools and corporate entities in one platform  
✅ **Role-based workflows** - Different approval processes per role  
✅ **Data isolation** - Complete separation between entities  
✅ **Admin control** - Per-entity administration  
✅ **Flexible permissions** - Customizable per role  
✅ **Audit trail** - Track approvals and rejections  
✅ **Security** - Authorization checks on all operations  
✅ **Scalability** - Designed for growth  

Ready for production deployment! 🚀
