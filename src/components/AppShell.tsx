'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import Sidebar from './Sidebar';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // close the drawer whenever the route changes
  useEffect(() => { setOpen(false); }, [pathname]);

  // login (and any unauthenticated full-screen route) renders without the shell
  if (pathname === '/login') return <>{children}</>;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar: off-canvas drawer on mobile, static on md+ */}
      <div
        className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onNavigate={() => setOpen(false)} />
      </div>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4 md:hidden">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="rounded-lg p-1.5 text-gray-700 hover:bg-cream"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-caramel text-sm">🥞</span>
            <span className="text-sm font-bold text-gray-900">TPP Control</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>

      {/* Close button inside drawer on mobile */}
      {open && (
        <button
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="fixed left-[15.5rem] top-3 z-50 rounded-lg bg-white/90 p-1.5 text-gray-700 shadow md:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
