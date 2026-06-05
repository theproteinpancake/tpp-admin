'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
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
  type LucideIcon,
} from 'lucide-react';

type NavItem = { name: string; href: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    label: 'App',
    items: [
      { name: 'App Dashboard', href: '/app', icon: LayoutDashboard },
      { name: 'Recipes', href: '/recipes', icon: UtensilsCrossed },
      { name: 'Creators', href: '/creators', icon: UserCircle },
      { name: 'Users', href: '/users', icon: Users },
      { name: 'Notifications', href: '/notifications', icon: Bell },
    ],
  },
  {
    label: 'Logistics',
    items: [
      { name: 'Assistant', href: '/logistics/assistant', icon: Sparkles },
      { name: 'Stock Overview', href: '/logistics/stock', icon: Package },
      { name: 'Purchase Orders', href: '/logistics/purchase-orders', icon: ClipboardList },
      { name: 'Batches', href: '/logistics/batches', icon: Layers },
      { name: 'Packaging', href: '/logistics/packaging', icon: Package2 },
      { name: 'Transfers', href: '/logistics/transfers', icon: ArrowLeftRight },
      { name: 'Shipping & Billing', href: '/logistics/shipping', icon: Truck },
    ],
  },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href));

  return (
    <div className="flex h-screen w-64 flex-col bg-white border-r border-gray-200">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-gray-200 px-5">
        <Image src="/tpp-smile.png" alt="The Protein Pancake" width={36} height={36} className="rounded-lg shadow-sm" />
        <div className="leading-tight">
          <h1 className="text-[15px] font-bold text-gray-900">TPP Control</h1>
          <p className="text-[11px] text-gray-500">The Protein Pancake</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={onNavigate}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-caramel text-white shadow-sm'
                        : 'text-gray-700 hover:bg-cream hover:text-maple'
                    }`}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-gray-200 p-3">
        <Link
          href="/settings"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-cream hover:text-maple transition-colors"
        >
          <Settings className="h-5 w-5" />
          Settings
        </Link>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
