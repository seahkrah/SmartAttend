import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Menu, Search } from 'lucide-react';
import { JjeloTechMark } from '../BrandLogo';
import { useAuthStore } from '../../store/authStore';
import { navForPlatform, visibleGroups, type NavItem, type Platform } from '../../navigation/navConfig';

/**
 * The shared application shell — screens 1a and 3b.
 *
 * One shell serves both platforms. The School/Employees switcher sits at the
 * top of the sidebar and the navigation below it is grouped under headings.
 * This replaces SchoolAdminLayout, TenantAdminLayout, FacultyLayout,
 * StudentLayout and SuperadminLayout, which are separate and flat.
 *
 * The EMS side marks its active item in orange, the school side in blue,
 * matching the mockups.
 */

interface AppShellProps {
  children: React.ReactNode;
  /** Small line above the page title, e.g. "SEMESTER I · 2026/27 · WEEK 6". */
  eyebrow?: string;
  title: string;
  /** Buttons for the top-right of the header. */
  actions?: React.ReactNode;
  /** Live counts keyed by NavItem.countKey. */
  counts?: Record<string, number>;
  searchPlaceholder?: string;
  onSearch?: (q: string) => void;
}

function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('');
}

const PlatformSwitcher: React.FC<{
  active: Platform;
  available: Platform[];
  onSwitch: (p: Platform) => void;
}> = ({ active, available, onSwitch }) => (
  <div className="flex gap-1 p-1 bg-sunken rounded-lg" role="tablist" aria-label="Platform">
    {(['school', 'corporate'] as Platform[]).map(p => {
      const label = p === 'school' ? 'School' : 'Employees';
      const isActive = active === p;
      const permitted = available.includes(p);
      return (
        <button
          key={p}
          role="tab"
          aria-selected={isActive}
          disabled={!permitted}
          onClick={() => permitted && onSwitch(p)}
          title={permitted ? undefined : `Your account does not have access to the ${label.toLowerCase()} platform`}
          className={[
            'flex-1 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors duration-150',
            isActive ? 'bg-card text-primary shadow-card' : 'text-muted',
            permitted && !isActive ? 'hover:text-secondary' : '',
            !permitted ? 'opacity-40 cursor-not-allowed' : '',
          ].join(' ')}
        >
          {label}
        </button>
      );
    })}
  </div>
);

const NavLink: React.FC<{ item: NavItem; active: boolean; accent: boolean; count?: number }> = ({
  item,
  active,
  accent,
  count,
}) => {
  const Icon = item.icon;

  // 'planned' items are in the mockups but have no backend yet. Showing them
  // disabled keeps the product's shape visible without offering a dead link.
  if (item.status === 'planned') {
    return (
      <span
        className="nav-item opacity-45 cursor-not-allowed"
        title="Not built yet — this domain has no backend behind it"
        aria-disabled="true"
      >
        <Icon className="w-[18px] h-[18px] flex-shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Soon</span>
      </span>
    );
  }

  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={active ? (accent ? 'nav-item-active-accent' : 'nav-item-active') : 'nav-item'}
    >
      <Icon className="w-[18px] h-[18px] flex-shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {count !== undefined && (
        <span
          className={[
            'text-xs font-semibold tabular-nums',
            active ? 'opacity-90' : 'text-muted',
          ].join(' ')}
        >
          {count.toLocaleString()}
        </span>
      )}
    </Link>
  );
};

export const AppShell: React.FC<AppShellProps> = ({
  children,
  eyebrow,
  title,
  actions,
  counts = {},
  searchPlaceholder = 'Search...',
  onSearch,
}) => {
  const { user, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  // A user belongs to one platform today. The switcher shows both so the
  // product's shape is legible, but only the user's own platform is
  // selectable — see DESIGN_AUDIT.md on cross-platform access.
  const platform: Platform = user?.platform ?? 'school';
  const available: Platform[] = user?.platform ? [user.platform] : ['school'];
  const isCorporate = platform === 'corporate';

  const groups = visibleGroups(navForPlatform(platform), user?.role);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebar = (
    <nav className="flex flex-col h-full" aria-label="Main">
      <div className="px-4 py-4 border-b border-subtle">
        <Link to="/dashboard" className="flex items-center gap-2.5 mb-4">
          <JjeloTechMark className="w-9 h-9 flex-shrink-0" idSuffix="shell-sidebar" />
          <span className="min-w-0">
            <span className="block font-bold text-primary leading-tight">JjeloTech</span>
            <span className="block text-xs text-muted truncate">
              {isCorporate ? 'Employee management' : 'School management'}
            </span>
          </span>
        </Link>
        <PlatformSwitcher
          active={platform}
          available={available}
          onSwitch={() => {
            /* Single-platform accounts only; see above. */
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map(group => (
          <div key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <NavLink
                  key={item.label}
                  item={item}
                  active={location.pathname === item.to}
                  accent={isCorporate}
                  count={item.countKey ? counts[item.countKey] : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="px-3 py-3 border-t border-subtle flex items-center gap-3">
        <span
          className={[
            'w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
            isCorporate ? 'bg-accent-500 text-ink-900' : 'bg-brand-600 text-white',
          ].join(' ')}
        >
          {initialsOf(user?.fullName ?? '')}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-primary truncate">{user?.fullName}</span>
          <span className="block text-xs text-muted truncate">{user?.role}</span>
        </span>
        <button onClick={handleLogout} className="btn-ghost p-2" title="Sign out" aria-label="Sign out">
          <LogOut className="w-[18px] h-[18px]" />
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-page">
      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-[276px] flex-shrink-0 h-screen sticky top-0 bg-card border-r border-subtle">
          {sidebar}
        </aside>

        {/* Mobile drawer */}
        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-40 flex">
            <div
              className="absolute inset-0 bg-ink-950/50"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
            <aside className="relative w-[276px] bg-card border-r border-subtle">{sidebar}</aside>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <header className="sticky top-0 z-30 bg-page/90 backdrop-blur border-b border-subtle">
            <div className="flex items-center gap-4 px-5 py-3.5">
              <button
                className="lg:hidden btn-ghost p-2"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="min-w-0 flex-1">
                {eyebrow && (
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{eyebrow}</p>
                )}
                <h1 className="text-xl font-bold text-primary truncate">{title}</h1>
              </div>

              {onSearch && (
                <div className="hidden md:block relative w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
                  <input
                    type="search"
                    placeholder={searchPlaceholder}
                    onChange={e => onSearch(e.target.value)}
                    className="input-field pl-9"
                  />
                </div>
              )}

              <button className="btn-secondary p-2.5 relative" aria-label="Notifications">
                <Bell className="w-[18px] h-[18px]" />
              </button>

              {actions}
            </div>
          </header>

          <main className="p-5">{children}</main>
        </div>
      </div>
    </div>
  );
};

export default AppShell;
