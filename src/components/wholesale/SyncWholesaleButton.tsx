'use client';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function SyncWholesaleButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  const sync = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/xero/sync-wholesale', { method: 'POST' });
      const j = await r.json();
      if (j.error) setMsg(`Error: ${j.error}`);
      else { setMsg(`Synced ${j.orders} orders · ${j.customers} customers`); router.refresh(); }
    } catch (e) { setMsg(`Error: ${String(e)}`); }
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
      <button onClick={sync} disabled={busy}
        className="flex items-center gap-2 rounded-lg bg-caramel px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-maple disabled:opacity-50">
        <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
        {busy ? 'Syncing…' : 'Sync from Xero'}
      </button>
    </div>
  );
}
