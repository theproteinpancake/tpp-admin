'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Link2 } from 'lucide-react';

export default function XeroButtons({ connected, org }: { connected: boolean; org?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!connected) {
    return (
      <a href="/api/xero/connect"
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-cream hover:text-maple">
        <Link2 className="h-4 w-4" /> Connect Xero
      </a>
    );
  }

  const sync = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/xero/sync-pos', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'sync failed');
      setMsg(`Synced ${d.pos_synced} POs`);
      router.refresh();
    } catch (e) {
      setMsg(String(e).slice(0, 80));
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 5000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-gray-400 sm:inline">Xero: {org || 'connected'} ✓</span>
      <button onClick={sync} disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-cream hover:text-maple disabled:opacity-60">
        <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
        {busy ? 'Syncing…' : msg ?? 'Sync from Xero'}
      </button>
    </div>
  );
}
