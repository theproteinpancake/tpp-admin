'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { RefreshCw } from 'lucide-react';

// Mobile PWA has no pull-to-refresh or reload — Kate was force-closing the app to see fresh
// data. router.refresh() re-runs the server component with current data in place.
export default function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      title="Refresh data"
      className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-paper px-3 py-2 text-sm font-medium text-caramel shadow-sm hover:bg-cream/50 disabled:opacity-60"
    >
      <RefreshCw className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} />
      <span className="hidden sm:inline">{pending ? 'Refreshing…' : 'Refresh'}</span>
    </button>
  );
}
