'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PO_STATUSES } from '@/lib/po-types';

export default function POActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const patch = async (body: object) => {
    setBusy(true);
    try {
      await fetch(`/api/logistics/purchase-orders/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      router.refresh();
    } finally { setBusy(false); }
  };

  const del = async () => {
    if (!confirm('Delete this PO?')) return;
    setBusy(true);
    try {
      await fetch(`/api/logistics/purchase-orders/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={status}
        disabled={busy}
        onChange={(e) => patch({ status: e.target.value })}
        className="rounded-md border border-gray-200 bg-paper px-2 py-1 text-xs text-gray-700"
      >
        {PO_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
      </select>
      {status !== 'received' && status !== 'cancelled' && (
        <button onClick={() => patch({ receiveAll: true })} disabled={busy}
          className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 hover:bg-emerald-100 disabled:opacity-50">
          Receive all
        </button>
      )}
      <button onClick={del} disabled={busy}
        className="rounded-md px-2 py-1 text-xs font-medium text-gray-400 hover:text-red-600 disabled:opacity-50">
        Delete
      </button>
    </div>
  );
}
