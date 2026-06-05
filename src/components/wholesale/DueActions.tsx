'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';

export default function DueActions({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const call = async (action: string, order_date?: string) => {
    setBusy(true);
    try {
      await fetch('/api/wholesale/customer', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, order_date }) });
      router.refresh();
    } finally { setBusy(false); }
  };

  const markOrdered = () => {
    const today = new Date().toISOString().slice(0, 10);
    const d = window.prompt('Order date (YYYY-MM-DD) — leave as today if just ordered:', today);
    if (d === null) return;
    call('mark_ordered', d.trim() || today);
  };

  return (
    <span className="flex shrink-0 items-center gap-1">
      <button title="Mark as ordered (snooze nudge)" disabled={busy} onClick={markOrdered}
        className="rounded p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"><Check className="h-3.5 w-3.5" /></button>
      <button title="Not stocked anymore (remove)" disabled={busy} onClick={() => { if (confirm('Remove this customer from wholesale tracking?')) call('not_stocked'); }}
        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"><X className="h-3.5 w-3.5" /></button>
    </span>
  );
}
