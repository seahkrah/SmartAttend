import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileText,
  GraduationCap,
  Landmark,
  Layers,
  LayoutDashboard,
  Receipt,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';

/**
 * Navigation for the shared shell.
 *
 * Mirrors the grouped information architecture in the mockups (screens 1a and
 * 3b): one shell for both platforms, with a School/Employees switcher and
 * navigation grouped under headings, replacing the five separate flat layouts.
 *
 * `status` records whether the destination actually exists yet:
 *   'ready'   — the route is wired and backed by an API
 *   'planned' — in the mockups, but the domain has no schema or routes behind
 *               it (see DESIGN_AUDIT.md). Rendered disabled rather than hidden,
 *               so the shape of the product is visible without offering a link
 *               that would 404.
 */

export type Platform = 'school' | 'corporate';
export type NavStatus = 'ready' | 'planned';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  status: NavStatus;
  /** Roles permitted to see the item. Omitted means every role on the platform. */
  roles?: string[];
  /** Key for a live count shown on the right, e.g. a pending-approvals badge. */
  countKey?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** School Management System — screen 1a. */
export const schoolNav: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, status: 'ready' },
      { label: 'Reports', to: '/reports', icon: BarChart3, status: 'ready' },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Users', to: '/users', icon: Users, status: 'ready' },
      { label: 'Students', to: '/students', icon: GraduationCap, status: 'ready', countKey: 'students' },
      { label: 'Faculty', to: '/faculty', icon: Users, status: 'ready', countKey: 'faculty' },
    ],
  },
  {
    label: 'Academics',
    items: [
      { label: 'Colleges & Departments', to: '/departments', icon: Landmark, status: 'ready' },
      { label: 'Programmes & Curriculum', to: '/programmes', icon: Layers, status: 'ready' },
      { label: 'Courses & Sections', to: '/courses', icon: BookOpen, status: 'ready' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Rooms & Schedules', to: '/schedules', icon: CalendarDays, status: 'ready' },
      { label: 'Enrollment', to: '/enrollment', icon: UserPlus, status: 'ready' },
      { label: 'Attendance', to: '/attendance', icon: ClipboardList, status: 'ready' },
      { label: 'Admissions', to: '/admissions', icon: ClipboardCheck, status: 'ready' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Fees & Invoices', to: '/finance', icon: Receipt, status: 'ready' },
    ],
  },
  {
    label: 'Examinations',
    items: [
      // Grading schemes and publication live with the registrar; lecturers
      // enter marks from their own gradebook.
      { label: 'Results & Transcripts', to: '/examinations', icon: FileText, status: 'planned' },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Approvals', to: '/approvals', icon: ClipboardCheck, status: 'ready', countKey: 'approvals' },
      { label: 'Settings', to: '/settings', icon: Settings, status: 'ready' },
    ],
  },
];

/** Employee Management System — screen 3b. */
export const corporateNav: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, status: 'ready' },
      { label: 'HR analytics', to: '/analytics', icon: BarChart3, status: 'ready' },
    ],
  },
  {
    label: 'Workforce',
    items: [
      { label: 'Employees', to: '/employees', icon: Users, status: 'ready', countKey: 'employees' },
      { label: 'Departments', to: '/departments', icon: Building2, status: 'ready' },
      // Needs a contracts model; roles today are a flat string on the user.
      { label: 'Roles & contracts', to: '/contracts', icon: FileText, status: 'planned' },
    ],
  },
  {
    label: 'Time & attendance',
    items: [
      { label: 'Attendance', to: '/attendance', icon: ClipboardList, status: 'ready' },
      // Needs rosters and shift coverage.
      { label: 'Shifts & rosters', to: '/shifts', icon: CalendarDays, status: 'planned' },
      // Needs verified-hours aggregation and payroll export.
      { label: 'Timesheets', to: '/timesheets', icon: Clock, status: 'planned' },
      { label: 'Leave requests', to: '/leave', icon: ClipboardCheck, status: 'ready', countKey: 'leave' },
    ],
  },
  {
    label: 'Pay',
    items: [
      // Approval and payment need hr_director or admin; plain HR reaches the
      // page and the API withholds those two actions.
      { label: 'Payroll', to: '/payroll', icon: Banknote, status: 'ready',
        roles: ['hr', 'hr_director', 'admin'] },
      { label: 'My payslips', to: '/payslips', icon: Receipt, status: 'ready',
        roles: ['employee', 'manager'] },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Incidents', to: '/incidents', icon: AlertTriangle, status: 'ready' },
      { label: 'Settings', to: '/settings', icon: Settings, status: 'ready' },
    ],
  },
];

export function navForPlatform(platform: Platform): NavGroup[] {
  return platform === 'school' ? schoolNav : corporateNav;
}

/** Filters out items the given role may not see. */
export function visibleGroups(groups: NavGroup[], role: string | undefined): NavGroup[] {
  return groups
    .map(g => ({ ...g, items: g.items.filter(i => !i.roles || (role ? i.roles.includes(role) : false)) }))
    .filter(g => g.items.length > 0);
}
