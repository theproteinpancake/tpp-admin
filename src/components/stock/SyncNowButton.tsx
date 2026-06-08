'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

export default function SyncNowButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  const sync = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch('/api/logistics/sync', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      setMsg('Synced');
      router.refresh();
    } catch {
      setMsg('Sync failed');
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  return (
    <button
      onClick={sync}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-paper px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-cream hover:text-maple disabled:opacity-60"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      {loading ? 'Syncing…' : msg ?? 'Sync now'}
    </button>
  );
}
