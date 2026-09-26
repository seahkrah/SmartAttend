import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Menu, Search, ShieldCheck } from 'lucide-react';
import { JjeloTechMark, JjeloTechWordmark, BRAND_NAME } from '../BrandLogo';
import { useAuthStore } from '../../store/authStore';
import { activeItem, navFor, type NavItem, type Platform } from '../../navigation/navConfig';
import { LoadingState } from '../states/PageStates';

/**
 * The shared application shell — screens 1a and 3b.
 *
 * One shell serves the whole product. The School/Employees switcher sits at
 * the top of the sidebar and the navigation below it is grouped under
 * headings.
 *
 * This replaced TenantAdminLayout, FacultyLayout, StudentLayout and
 * SuperadminLayout, four flat sidebars that each carried their own copy of
 * the route table. The copies had drifted from the router and from each
 * other: the HR pages were in none of them and were reachable only by typing
 * a URL, and two entries pointed at routes that had never existed.
 *
 * The EMS side marks its active item in orange, the school side in blue,
 * matching the mockups.
 *
 * Which navigation appears is decided by audience — see navConfig. The shell
 * itself knows nothing about roles beyond passing them through, so adding a
 * page is a change to one file rather than to a sidebar and a route table that
 * can disagree with each other.
 */

interface AppShellProps {
  children: React.ReactNode;
  /** Small line above the page title, e.g. "SEMESTER I · 2026/27 · WEEK 6". */
  eyebrow?: string;
  /**
   * The header's heading. Optional: most pages render their own, and a shell
   * that repeated it would put two headings on every screen. Passed by the
   * dev preview and available to any page that would rather the shell owned
   * its title.
   */
  title?: string;
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
      const label = p === 'school' ? 'School' : 'Employer';
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

  // The navigation belongs to the audience, not to the platform: an HR
  // manager and a corporate administrator are both on the corporate platform
  // and reach different pages.
  const nav = navFor(user?.role, user?.platform as Platform | undefined);
  const groups = nav?.groups ?? [];
  const home = nav?.home ?? '/dashboard';
  const showSwitcher = nav?.showPlatformSwitcher !== false;

  // A user belongs to one platform today. The switcher shows both so the
  // product's shape is legible, but only the user's own platform is
  // selectable — see docs/archive/DESIGN_AUDIT.md on cross-platform access.
  const platform: Platform = nav?.platform ?? (user?.platform as Platform) ?? 'school';
  const available: Platform[] = user?.platform ? [user.platform as Platform] : ['school'];
  const isCorporate = platform === 'corporate';

  const current = activeItem(groups, location.pathname);

  // Each page names itself in the browser tab, so a dozen open tabs are not
  // a dozen identical titles.
  React.useEffect(() => {
    document.title = current ? `${current.label} · ${BRAND_NAME}` : BRAND_NAME;
  }, [current?.label]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebar = (
    <nav className="flex flex-col h-full" aria-label="Main">
      <div className="px-4 py-4 border-b border-subtle">
        <Link to={home} className="flex items-center gap-2.5 mb-4">
          <JjeloTechMark className="w-10 h-10 flex-shrink-0" title={BRAND_NAME} />
          <span className="min-w-0">
            <JjeloTechWordmark size="sm" className="text-primary" />
            <span className="block text-xs text-muted truncate mt-1">
              {nav?.subtitle ?? (isCorporate ? 'Employee management' : 'School management')}
            </span>
          </span>
        </Link>
        {showSwitcher && (
          <PlatformSwitcher
            active={platform}
            available={available}
            onSwitch={() => {
              /* Single-platform accounts only; see above. */
            }}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.label}
                  item={item}
                  active={current?.to === item.to}
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
        <Link to="/account/security" className="btn-ghost p-2" title="Account security" aria-label="Account security">
          <ShieldCheck className="w-[18px] h-[18px]" />
        </Link>
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
                {title && <h1 className="text-xl font-bold text-primary truncate">{title}</h1>}
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

          {/* No padding here: every page in this app already carries its own, and
              a second gutter would indent the whole product by two. */}
          <main>
            {/* Pages load on demand; the shell stays in place while one does. */}
            <React.Suspense fallback={<div className="p-4 sm:p-6"><LoadingState label="Loading…" /></div>}>
              {children}
            </React.Suspense>
          </main>
        </div>
      </div>
    </div>
  );
};

export default AppShell;
