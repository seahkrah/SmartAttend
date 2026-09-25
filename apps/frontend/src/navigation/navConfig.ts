import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Clock,
  DoorOpen,
  FileText,
  GraduationCap,
  Landmark,
  Layers,
  LayoutDashboard,
  Receipt,
  Settings,
  UserCog,
  UserPlus,
  Users,
  ScanFace,
} from 'lucide-react';

/**
 * Navigation for the shared shell.
 *
 * One shell serves the whole product, and this file is the only description of
 * what is in it. It replaced five separate flat layouts — SchoolAdminLayout,
 * TenantAdminLayout, FacultyLayout, StudentLayout and SuperadminLayout — each
 * of which carried its own hardcoded sidebar and its own copy of the route
 * table. Those copies had drifted: several real pages appeared in no menu at
 * all, and two menu entries pointed at routes that had never existed.
 *
 * Two rules keep that from happening again:
 *
 *   1. `to` is the real, absolute path. There is no prefix arithmetic and no
 *      per-role rewriting, because a destination assembled at render time is a
 *      destination nobody can check.
 *
 *   2. Every path here is verified against App.tsx by scripts/check-nav.mjs,
 *      which fails if a menu entry points somewhere the router does not go, or
 *      if a page exists that no menu offers. A menu that can drift from the
 *      routes is the bug this file exists to fix.
 *
 * Navigation is per AUDIENCE rather than per platform, because the routes
 * genuinely differ: an HR manager and a corporate administrator are both on
 * the corporate platform and reach different pages. Pretending one prefix
 * covers both is what produced the dead links.
 *
 * `status` records whether the destination exists:
 *   'ready'   — the route is wired and backed by an API
 *   'planned' — in the mockups, with no page behind it. Rendered disabled
 *               rather than hidden, so the product's shape stays visible
 *               without offering a link that would go nowhere.
 */

export type Platform = 'school' | 'corporate';
export type NavStatus = 'ready' | 'planned';

/** Who is looking. Derived from role and platform by `audienceFor`. */
export type Audience =
  | 'superadmin'
  | 'schoolAdmin'
  | 'corporateAdmin'
  | 'hr'
  | 'manager'
  | 'faculty'
  | 'student'
  | 'employee';

export interface NavItem {
  label: string;
  /** The real, absolute route. Checked against App.tsx by the nav gate. */
  to: string;
  icon: LucideIcon;
  status: NavStatus;
  /** Key for a live count shown on the right, e.g. a pending-approvals badge. */
  countKey?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface AudienceNav {
  /** Where the brand mark links, and where a bare sign-in lands. */
  home: string;
  platform: Platform;
  /** The line under the brand. Defaults to the platform's name. */
  subtitle?: string;
  /**
   * Whether the School/Employees switcher belongs here. A superadmin sits
   * above both platforms, so offering them a choice between the two is
   * offering a choice that means nothing.
   */
  showPlatformSwitcher?: boolean;
  groups: NavGroup[];
}

// ---------------------------------------------------------------------------
// School
// ---------------------------------------------------------------------------

const schoolAdminNav: AudienceNav = {
  home: '/admin/school/dashboard',
  platform: 'school',
  groups: [
    {
      label: 'Overview',
      items: [
        { label: 'Dashboard', to: '/admin/school/dashboard', icon: LayoutDashboard, status: 'ready' },
        { label: 'Reports', to: '/admin/school/reports', icon: BarChart3, status: 'ready' },
      ],
    },
    {
      label: 'People',
      items: [
        { label: 'Users', to: '/admin/school/users', icon: Users, status: 'ready' },
        { label: 'Students', to: '/admin/school/students', icon: GraduationCap, status: 'ready', countKey: 'students' },
        { label: 'Faculty', to: '/admin/school/faculty', icon: UserCog, status: 'ready', countKey: 'faculty' },
      ],
    },
    {
      label: 'Academics',
      items: [
        // No page has ever existed for this; the school's departments are
        // modelled in the database but nothing reads them yet.
        { label: 'Colleges & departments', to: '/admin/school/departments', icon: Landmark, status: 'planned' },
        { label: 'Programmes', to: '/admin/school/programmes', icon: Layers, status: 'ready' },
        { label: 'Courses', to: '/admin/school/courses', icon: BookOpen, status: 'ready' },
      ],
    },
    {
      label: 'Operations',
      items: [
        { label: 'Rooms', to: '/admin/school/rooms', icon: DoorOpen, status: 'ready' },
        { label: 'Schedules', to: '/admin/school/schedules', icon: CalendarDays, status: 'ready' },
        { label: 'Enrollment', to: '/admin/school/enrollment', icon: UserPlus, status: 'ready' },
        { label: 'Attendance', to: '/admin/school/attendance', icon: ClipboardList, status: 'ready' },
        { label: 'Face matching', to: '/admin/school/face-matching', icon: ScanFace, status: 'ready' },
        { label: 'Admissions', to: '/admin/school/admissions', icon: ClipboardCheck, status: 'ready' },
      ],
    },
    {
      label: 'Finance',
      items: [
        { label: 'Fees & invoices', to: '/admin/school/finance', icon: Receipt, status: 'ready' },
      ],
    },
    {
      label: 'Examinations',
      items: [
        // Grading schemes and publication belong to the registrar; lecturers
        // enter marks from their own gradebook, which exists.
        { label: 'Results & transcripts', to: '/admin/school/examinations', icon: FileText, status: 'planned' },
      ],
    },
    {
      label: 'System',
      items: [
        { label: 'Approvals', to: '/admin/school/approvals', icon: ClipboardCheck, status: 'ready', countKey: 'approvals' },
        { label: 'Notifications', to: '/admin/school/notifications', icon: Bell, status: 'ready' },
        { label: 'Settings', to: '/admin/school/settings', icon: Settings, status: 'ready' },
      ],
    },
  ],
};

const facultyNav: AudienceNav = {
  home: '/faculty',
  platform: 'school',
  groups: [
    {
      label: 'Overview',
      items: [
        { label: 'Dashboard', to: '/faculty', icon: LayoutDashboard, status: 'ready' },
        { label: 'Reports', to: '/faculty/reports', icon: BarChart3, status: 'ready' },
      ],
    },
    {
      label: 'Teaching',
      items: [
        { label: 'My courses', to: '/faculty/courses', icon: BookOpen, status: 'ready' },
        { label: 'Students', to: '/faculty/students', icon: GraduationCap, status: 'ready' },
        { label: 'Enrollment', to: '/faculty/enrollment', icon: UserPlus, status: 'ready' },
        { label: 'Gradebook', to: '/faculty/gradebook', icon: FileText, status: 'ready' },
      ],
    },
    {
      label: 'Operations',
      items: [
        { label: 'Schedules', to: '/faculty/schedules', icon: CalendarDays, status: 'ready' },
        { label: 'Attendance', to: '/faculty/attendance', icon: ClipboardList, status: 'ready' },
      ],
    },
    {
      label: 'System',
      items: [
        { label: 'Settings', to: '/faculty/settings', icon: Settings, status: 'ready' },
      ],
    },
  ],
};

const studentNav: AudienceNav = {
  home: '/student',
  platform: 'school',
  groups: [
    {
      label: 'Overview',
      items: [
        { label: 'Dashboard', to: '/student', icon: LayoutDashboard, status: 'ready' },
      ],
    },
    {
      label: 'Studies',
      items: [
        { label: 'My courses', to: '/student/courses', icon: BookOpen, status: 'ready' },
        { label: 'Schedule', to: '/student/schedule', icon: CalendarDays, status: 'ready' },
        { label: 'Results', to: '/student/results', icon: FileText, status: 'ready' },
        { label: 'Attendance', to: '/student/attendance', icon: ClipboardList, status: 'ready' },
      ],
    },
    {
      label: 'Finance',
      items: [
        { label: 'Fees', to: '/student/fees', icon: Receipt, status: 'ready' },
      ],
    },
    {
      label: 'System',
      items: [
        { label: 'Settings', to: '/student/settings', icon: Settings, status: 'ready' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

/**
 * A corporate administrator reaches both the tenant administration pages under
 * /admin/corporate and the HR pages under /hr, which the router admits them
 * to. HR staff reach only the second set, which is why these are two navs and
 * not one filtered by role.
 */
const corporateAdminNav: AudienceNav = {
  home: '/admin/corporate/dashboard',
  platform: 'corporate',
  groups: [
    {
      label: 'Overview',
      items: [
        { label: 'Dashboard', to: '/admin/corporate/dashboard', icon: LayoutDashboard, status: 'ready' },
        { label: 'Reports', to: '/admin/corporate/reports', icon: BarChart3, status: 'ready' },
        { label: 'HR analytics', to: '/hr/analytics', icon: BarChart3, status: 'ready' },
      ],
    },
    {
      label: 'Workforce',
      items: [
        { label: 'Employees', to: '/admin/corporate/employees', icon: Users, status: 'ready', countKey: 'employees' },
        { label: 'Departments', to: '/admin/corporate/departments', icon: Building2, status: 'ready' },
        { label: 'Roles & contracts', to: '/hr/contracts', icon: FileText, status: 'ready' },
      ],
    },
    {
      label: 'Time & attendance',
      items: [
        { label: 'Attendance', to: '/admin/corporate/attendance', icon: ClipboardList, status: 'ready' },
        { label: 'Shifts & rosters', to: '/hr/shifts', icon: CalendarDays, status: 'ready' },
        { label: 'Timesheets', to: '/hr/timesheets', icon: Clock, status: 'ready' },
        { label: 'Leave requests', to: '/hr/leave', icon: CalendarCheck, status: 'ready', countKey: 'leave' },
        { label: 'Face matching', to: '/hr/face-matching', icon: ScanFace, status: 'ready' },
      ],
    },
    {
      label: 'Pay',
      items: [
        { label: 'Payroll', to: '/hr/payroll', icon: Banknote, status: 'ready' },
      ],
    },
    {
      label: 'System',
      items: [
        { label: 'Approvals', to: '/admin/corporate/approvals', icon: ClipboardCheck, status: 'ready', countKey: 'approvals' },
        { label: 'Notifications', to: '/admin/corporate/notifications', icon: Bell, status: 'ready' },
        // The backend has an incident lifecycle; no page has ever been wired
        // to it, so this has never been a working link.
        { label: 'Incidents', to: '/admin/corporate/incidents', icon: AlertTriangle, status: 'planned' },
        { label: 'Settings', to: '/admin/corporate/settings', icon: Settings, status: 'ready' },
      ],
    },
  ],
};

const hrNav: AudienceNav = {
  home: '/hr',
  platform: 'corporate',
  groups: [
    {
      label: 'Overview',
      items: [
        { label: 'Attendance overview', to: '/hr', icon: LayoutDashboard, status: 'ready' },
        { label: 'HR analytics', to: '/hr/analytics', icon: BarChart3, status: 'ready' },
      ],
    },
    {
      label: 'Me',
      items: [
        { label: 'Check in', to: '/hr/check-in', icon: Clock, status: 'ready' },
      ],
    },
    {
      label: 'Workforce',
      items: [
        { label: 'Roles & contracts', to: '/hr/contracts', icon: FileText, status: 'ready' },
      ],
    },
    {
      label: 'Time & attendance',
      items: [
        { label: 'Shifts & rosters', to: '/hr/shifts', icon: CalendarDays, status: 'ready' },
        { label: 'Timesheets', to: '/hr/timesheets', icon: Clock, status: 'ready' },
        { label: 'Leave requests', to: '/hr/leave', icon: CalendarCheck, status: 'ready', countKey: 'leave' },
        { label: 'Face matching', to: '/hr/face-matching', icon: ScanFace, status: 'ready' },
      ],
    },
    {
      label: 'Pay',
      items: [
        { label: 'Payroll', to: '/hr/payroll', icon: Banknote, status: 'ready' },
      ],
    },
  ],
};

/**
 * A manager sees only what the API lets them act on: rosters, timesheets and
 * leave decisions. Contracts and payroll are HR's, and listing them here would
 * offer a page that answers 403.
 */
const managerNav: AudienceNav = {
  home: '/hr',
  platform: 'corporate',
  groups: [
    {
      label: 'Overview',
      items: [
        { label: 'Attendance overview', to: '/hr', icon: LayoutDashboard, status: 'ready' },
      ],
    },
    {
      label: 'Me',
      items: [
        { label: 'Check in', to: '/hr/check-in', icon: Clock, status: 'ready' },
      ],
    },
    {
      label: 'My team',
      items: [
        { label: 'Shifts & rosters', to: '/hr/shifts', icon: CalendarDays, status: 'ready' },
        { label: 'Timesheets', to: '/hr/timesheets', icon: Clock, status: 'ready' },
        { label: 'Leave requests', to: '/hr/leave', icon: CalendarCheck, status: 'ready', countKey: 'leave' },
      ],
    },
  ],
};

/**
 * Employees share the /student/* routes with students, but only three of them
 * are theirs.
 *
 * The dashboard, the attendance page and the settings page all read a student
 * record — courses, enrolment, a student profile — and answer an employee with
 * a 403 or a 404. They are listed for students and not here, because a menu
 * entry that leads to "No data available" is worse than no entry at all.
 *
 * Check-in is the home, because it is what an employee opens the app to do.
 * It has its own page rather than reusing the students' attendance page,
 * which is about classes and reads a student record.
 */
const employeeNav: AudienceNav = {
  home: '/student/check-in',
  platform: 'corporate',
  groups: [
    {
      label: 'My work',
      items: [
        { label: 'Check in', to: '/student/check-in', icon: Clock, status: 'ready' },
        { label: 'Shifts & timesheets', to: '/student/work', icon: CalendarDays, status: 'ready' },
        { label: 'Leave', to: '/student/leave', icon: CalendarCheck, status: 'ready' },
      ],
    },
    {
      label: 'Pay',
      items: [
        { label: 'My payslips', to: '/student/payslips', icon: Receipt, status: 'ready' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Platform operations
// ---------------------------------------------------------------------------

const superadminNav: AudienceNav = {
  home: '/superadmin/dashboard',
  // Nominal only: a superadmin is above both platforms, so the switcher is
  // suppressed and the subtitle says where they actually are.
  platform: 'school',
  subtitle: 'Platform operations',
  showPlatformSwitcher: false,
  groups: [
    {
      label: 'Overview',
      items: [
        // /superadmin is a bare redirect to the dashboard, so it is the home
        // rather than an entry of its own; two entries for one page is how a
        // menu starts lying about what is behind it.
        { label: 'Dashboard', to: '/superadmin/dashboard', icon: LayoutDashboard, status: 'ready' },
      ],
    },
    {
      label: 'Tenants',
      items: [
        { label: 'Entities & tenants', to: '/superadmin/management', icon: Building2, status: 'ready' },
        { label: 'Administrators', to: '/superadmin/admins', icon: UserCog, status: 'ready' },
      ],
    },
    {
      label: 'System',
      items: [
        { label: 'Audit log', to: '/superadmin/audit', icon: FileText, status: 'ready' },
        { label: 'Settings', to: '/superadmin/settings', icon: Settings, status: 'ready' },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export const NAVS: Record<Audience, AudienceNav> = {
  superadmin: superadminNav,
  schoolAdmin: schoolAdminNav,
  corporateAdmin: corporateAdminNav,
  hr: hrNav,
  manager: managerNav,
  faculty: facultyNav,
  student: studentNav,
  employee: employeeNav,
};

/**
 * Which navigation a signed-in person gets.
 *
 * Role first, platform only where one role spans both — 'admin' and the shared
 * self-service group are the two cases. An unrecognised role gets nothing
 * rather than somebody else's menu.
 */
export function audienceFor(
  role: string | undefined,
  platform: Platform | undefined
): Audience | null {
  switch (role) {
    case 'superadmin':
      return 'superadmin';
    case 'admin':
      return platform === 'corporate' ? 'corporateAdmin' : 'schoolAdmin';
    case 'hr':
    case 'hr_director':
      return 'hr';
    case 'manager':
      return 'manager';
    case 'faculty':
      return 'faculty';
    case 'student':
      return 'student';
    case 'employee':
      return 'employee';
    default:
      return null;
  }
}

export function navFor(
  role: string | undefined,
  platform: Platform | undefined
): AudienceNav | null {
  const audience = audienceFor(role, platform);
  return audience ? NAVS[audience] : null;
}

/**
 * The item whose route the browser is on.
 *
 * Longest match wins, so /admin/school/students is the students page rather
 * than the dashboard at /admin/school. Exact-matching alone would leave every
 * nested page looking as though nothing were selected.
 */
export function activeItem(groups: NavGroup[], pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      if (item.status !== 'ready') continue;
      if (pathname === item.to || pathname.startsWith(`${item.to}/`)) {
        if (!best || item.to.length > best.to.length) best = item;
      }
    }
  }
  return best;
}
