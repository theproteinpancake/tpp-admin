'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  UtensilsCrossed,
  Users,
  Bell,
  UserCircle,
  Settings,
  LogOut,
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Recipes', href: '/recipes', icon: UtensilsCrossed },
  { name: 'Creators', href: '/creators', icon: UserCircle },
  { name: 'Users', href: '/users', icon: Users },
  { name: 'Notifications', href: '/notifications', icon: Bell },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-screen w-64 flex-col bg-white border-r border-gray-200">
      {/* Logo */}
      <div className="flex h-16 items-center justify-center border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-3xl">🥞</span>
          <div>
            <h1 className="text-lg font-bold text-gray-900">TPP Admin</h1>
            <p className="text-xs text-gray-500">The Protein Pancake</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`
                flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors
                ${isActive
                  ? 'bg-caramel text-white'
                  : 'text-gray-700 hover:bg-cream hover:text-caramel'
                }
              `}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-gray-200 p-3">
        <Link
          href="/settings"
          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-cream hover:text-caramel transition-colors"
        >
          <Settings className="h-5 w-5" />
          Settings
        </Link>
        <button
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
