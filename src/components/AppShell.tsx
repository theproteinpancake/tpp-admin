'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // close the drawer whenever the route changes
  useEffect(() => { setOpen(false); }, [pathname]);

  // login (and any unauthenticated full-screen route) renders without the shell
  if (pathname === '/login') return <>{children}</>;

  return (
    <div className="flex h-[100dvh] bg-cream">
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
        className={`fixed inset-y-0 left-0 z-40 transform shadow-xl transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:shadow-none ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />
      </div>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="safe-top sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-black/5 bg-paper px-3 md:hidden">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="-ml-0.5 rounded-lg p-2 text-caramel hover:bg-cream active:bg-cream"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex items-center gap-2">
            <Image src="/smile.png" alt="" width={26} height={26} className="rounded-md shadow-sm" />
            <span className="text-[15px] font-bold text-caramel">TPP Control</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overscroll-contain">{children}</main>
      </div>
    </div>
  );
}
