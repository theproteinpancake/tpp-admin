'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { PanelLeftOpen, PanelLeftClose, ListTodo,
  LayoutDashboard,
  Clapperboard,
  TrendingUp,
  UtensilsCrossed,
  Users,
  Bell,
  UserCircle,
  Settings,
  LogOut,
  Package,
  ClipboardList,
  Layers,
  Truck,
  ArrowLeftRight,
  Package2,
  Sparkles,
  Store,
  ShoppingCart,
  Megaphone,
  Handshake,
  BarChart3,
  Table2,
  X,
  type LucideIcon,
} from 'lucide-react';

type Section = 'analytics' | 'app' | 'logistics' | 'wholesale' | 'marketing' | 'staff';
type NavItem = { name: string; href: string; icon: LucideIcon };
type NavGroup = { label: string; section: Section; ownerOnly?: boolean; items: NavItem[] };
type Me = { name: string | null; email: string; role: string; sections: Section[]; isOwner: boolean };

const groups: NavGroup[] = [
  {
    label: 'Analytics',
    section: 'analytics',
    items: [
      { name: 'Analytics', href: '/analytics', icon: BarChart3 },
      { name: 'Sales & Data', href: '/analytics/master', icon: Table2 },
      { name: 'Ads', href: '/analytics/ads', icon: Clapperboard },
    ],
  },
  {
    label: 'Staff',
    section: 'staff',
    items: [
      { name: 'To do lists', href: '/staff/todos', icon: ListTodo },
    ],
  },
  {
    label: 'Logistics',
    section: 'logistics',
    items: [
      { name: 'Assistant', href: '/logistics/assistant', icon: Sparkles },
      { name: 'Forecasting', href: '/logistics/forecasting', icon: TrendingUp },
      { name: 'Stock Overview', href: '/logistics/stock', icon: Package },
      { name: 'Purchase Orders', href: '/logistics/purchase-orders', icon: ClipboardList },
      { name: 'Batches', href: '/logistics/batches', icon: Layers },
      { name: 'Packaging', href: '/logistics/packaging', icon: Package2 },
      { name: 'Transfers', href: '/logistics/transfers', icon: ArrowLeftRight },
      { name: 'Shipping & Billing', href: '/logistics/shipping', icon: Truck },
    ],
  },
  {
    label: 'Wholesale',
    section: 'wholesale',
    items: [
      { name: 'Dashboard', href: '/wholesale', icon: Store },
      { name: 'Orders', href: '/wholesale/orders', icon: ShoppingCart },
    ],
  },
  {
    label: 'Marketing',
    section: 'marketing',
    items: [
      { name: 'Influencers', href: '/marketing/influencers', icon: Megaphone },
      { name: 'Influencer Reporting', href: '/marketing/influencer-reporting', icon: BarChart3 },
      { name: 'Collabs', href: '/marketing/collabs', icon: Handshake },
    ],
  },
  {
    label: 'App',
    section: 'app',
    items: [
      { name: 'App Dashboard', href: '/app', icon: LayoutDashboard },
      { name: 'Recipes', href: '/recipes', icon: UtensilsCrossed },
      { name: 'Creators', href: '/creators', icon: UserCircle },
      { name: 'Users', href: '/users', icon: Users },
      { name: 'Notifications', href: '/notifications', icon: Bell },
    ],
  },
];

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', admin: 'Owner', wholesale: 'Wholesale & Marketing',
  marketing: 'Marketing', logistics: 'Logistics', staff: 'Staff',
};

export default function Sidebar({
  onNavigate,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.email) setMe(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  // Until /api/me resolves, show nothing extra; once we know the user, scope the nav.
  const visibleGroups = me ? groups.filter((g) => me.sections.includes(g.section) && (!g.ownerOnly || me.isOwner)) : groups.filter((g) => !g.ownerOnly);

  // Longest-matching href wins, so /wholesale/orders highlights only "Orders", not "Dashboard".
  const allHrefs = visibleGroups.flatMap((g) => g.items.map((i) => i.href));
  const activeHref = allHrefs
    .filter((h) => pathname === h || pathname.startsWith(h + '/'))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;

  return (
    <div
      data-collapsed={collapsed}
      className={`group/sb relative flex h-[100dvh] w-64 flex-col border-r border-gray-200 bg-paper transition-[width] duration-200 ${
        collapsed ? 'md:w-[4.5rem]' : ''
      }`}
    >
      {/* Collapse toggle — straddles the right edge so it's reachable in both states.
          Desktop only: on mobile the sidebar is a drawer with its own close button. */}
      {onToggleCollapse && (
        <button
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-3 top-[4.6rem] z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-paper text-caramel shadow-sm transition hover:bg-cream hover:text-maple md:flex"
        >
          {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </button>
      )}
      {/* Logo */}
      <div className="safe-top flex h-16 items-center gap-2.5 border-b border-gray-200 px-5 md:group-data-[collapsed=true]/sb:justify-center md:group-data-[collapsed=true]/sb:px-0">
        <Image src="/smile.png" alt="The Protein Pancake" width={36} height={36} className="rounded-lg shadow-sm" />
        <div className="leading-tight md:group-data-[collapsed=true]/sb:hidden">
          <h1 className="text-[15px] font-bold text-caramel">TPP Control</h1>
          <p className="text-[11px] text-gray-500">The Protein Pancake</p>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close menu" className="ml-auto rounded-lg p-1.5 text-gray-500 hover:bg-cream md:hidden">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 md:group-data-[collapsed=true]/sb:hidden">
              {group.label}
            </p>
            <div className="mx-3 mb-2 hidden border-t border-gray-200 md:group-data-[collapsed=true]/sb:block" aria-hidden />
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.name : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors md:group-data-[collapsed=true]/sb:justify-center md:group-data-[collapsed=true]/sb:px-0 ${
                      active
                        ? 'bg-caramel text-white shadow-sm'
                        : 'text-caramel hover:bg-cream hover:text-maple'
                    }`}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    <span className="md:group-data-[collapsed=true]/sb:hidden">{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom Section */}
      <div className="safe-bottom border-t border-gray-200 p-3">
        {me && (
          <div
            title={collapsed ? `${me.name || me.email} · ${ROLE_LABEL[me.role] || me.role}` : undefined}
            className="mb-2 flex items-center gap-2.5 rounded-lg bg-cream/60 px-3 py-2 md:group-data-[collapsed=true]/sb:justify-center md:group-data-[collapsed=true]/sb:bg-transparent md:group-data-[collapsed=true]/sb:px-0"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-caramel text-[13px] font-semibold text-white">
              {(me.name || me.email).trim().charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 leading-tight md:group-data-[collapsed=true]/sb:hidden">
              <p className="truncate text-[13px] font-semibold text-caramel">{me.name || me.email}</p>
              <p className="truncate text-[11px] text-gray-500">{ROLE_LABEL[me.role] || me.role}</p>
            </div>
          </div>
        )}
        <Link
          href="/settings"
          onClick={onNavigate}
          title={collapsed ? 'Settings' : undefined}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-caramel transition-colors hover:bg-cream hover:text-maple md:group-data-[collapsed=true]/sb:justify-center md:group-data-[collapsed=true]/sb:px-0"
        >
          <Settings className="h-5 w-5 shrink-0" />
          <span className="md:group-data-[collapsed=true]/sb:hidden">Settings</span>
        </Link>
        <button
          onClick={handleLogout}
          title={collapsed ? 'Sign out' : undefined}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-caramel transition-colors hover:bg-red-50 hover:text-red-600 md:group-data-[collapsed=true]/sb:justify-center md:group-data-[collapsed=true]/sb:px-0"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          <span className="md:group-data-[collapsed=true]/sb:hidden">Sign Out</span>
        </button>
      </div>
    </div>
  );
}
