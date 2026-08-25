import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAppState } from '../state/useAppState';

// Visual shell for the Admin Portal (Stitch mockup redesign) — sidebar nav
// on desktop, slide-in drawer on mobile. Deliberately kept separate from
// Nav.jsx rather than folded into it: Nav.jsx's other branches (teacher/
// salesman/production) are untouched by this redesign, and giving Admin
// its own layout component means this restyle can't leak into those roles.
//
// "Products" points at AdminCatalog — an admin-only fork of
// ProductionCatalog (same AppState handlers, restyled markup) so
// Production's own /production/catalog keeps its original look untouched.
// Same pattern for order detail: /admin/orders/:id uses AdminOrderDetail,
// a fork of ProductionOrderDetail.
const NAV_ITEMS = [
  { to: '/admin/dashboard', icon: 'dashboard', label: 'Dashboard', match: (p) => p === '/admin/dashboard' },
  { to: '/admin/orders', icon: 'shopping_cart', label: 'Orders', match: (p) => p.startsWith('/admin/orders') },
  { to: '/admin/schools', icon: 'school', label: 'Schools', match: (p) => p.startsWith('/admin/schools') },
  { to: '/admin/salesmen', icon: 'badge', label: 'Salesmen', match: (p) => p.startsWith('/admin/salesmen') },
  { to: '/admin/users', icon: 'group', label: 'Users', match: (p) => p === '/admin/users' },
  { to: '/admin/catalog', icon: 'inventory_2', label: 'Products', match: (p) => p === '/admin/catalog' },
  { to: '/admin/audit-log', icon: 'history', label: 'Activity Log', match: (p) => p === '/admin/audit-log' },
];

function SidebarLinks({ pathname, onNavigate }) {
  return (
    <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'flex items-center gap-3 bg-primary-container rounded-lg px-4 py-3 border-l-4 border-primary'
                : 'flex items-center gap-3 hover:bg-white/10 px-4 py-3 rounded-lg transition-all duration-200'
            }
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className="text-label-bold font-semibold tracking-wide">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export default function AdminLayout({ title, subtitle, headerActions, children }) {
  const { logout } = useAppState();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="admin-shell min-h-screen bg-background text-on-surface">
      {/* Desktop sidebar */}
      <nav className="fixed left-0 top-0 h-full z-40 hidden lg:flex flex-col py-6 bg-inverse-surface w-[260px] shadow-md">
        <div className="px-6 mb-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-headline-sm font-semibold">A</div>
          <div>
            <h1 className="text-headline-md font-extrabold text-white">Admin Portal</h1>
            <p className="text-body-sm text-surface-variant opacity-80">Enterprise Management</p>
          </div>
        </div>
        <SidebarLinks pathname={pathname} />
        <div className="px-4 mt-auto pt-4 border-t border-on-surface-variant/20">
          <button type="button" onClick={handleLogout} className="w-full flex items-center gap-3 bg-error-container text-on-error-container hover:bg-error hover:text-on-error px-4 py-3 rounded-lg transition-all duration-200">
            <span className="material-symbols-outlined">logout</span>
            <span className="text-label-bold font-semibold tracking-wide">Logout</span>
          </button>
        </div>
      </nav>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 bg-surface-container-lowest border-b border-outline-variant flex justify-between items-center w-full px-4 py-4">
        <span className="text-headline-md font-bold tracking-tighter text-on-surface">ADMIN PORTAL</span>
        <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu" className="text-on-surface-variant hover:text-primary transition-colors">
          <span className="material-symbols-outlined">menu</span>
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-on-background/50"
            onClick={() => setMobileOpen(false)}
          />
          <nav className="relative flex flex-col py-6 bg-inverse-surface w-[260px] h-full shadow-lg">
            <div className="px-6 mb-8 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-semibold">A</div>
                <h1 className="text-headline-sm font-extrabold text-white">Admin Portal</h1>
              </div>
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu" className="text-surface-variant hover:text-white">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <SidebarLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            <div className="px-4 mt-auto pt-4 border-t border-on-surface-variant/20">
              <button type="button" onClick={handleLogout} className="w-full flex items-center gap-3 bg-error-container text-on-error-container hover:bg-error hover:text-on-error px-4 py-3 rounded-lg transition-all duration-200">
                <span className="material-symbols-outlined">logout</span>
                <span className="text-label-bold font-semibold tracking-wide">Logout</span>
              </button>
            </div>
          </nav>
        </div>
      )}

      <main className="lg:ml-[260px]">
        <div className="p-6 md:p-10 max-w-[1440px] mx-auto">
          {(title || headerActions) && (
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
              <div>
                {title && <h2 className="text-display-lg text-on-surface mb-2">{title}</h2>}
                {subtitle && <p className="text-body-md text-on-surface-variant">{subtitle}</p>}
              </div>
              {headerActions && <div className="flex items-center gap-3 w-full md:w-auto">{headerActions}</div>}
            </header>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
