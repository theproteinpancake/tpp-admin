'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function StatusSelect({ table, id, value, options }: {
  table: 'influencers' | 'collabs'; id: string; value: string; options: { v: string; label: string }[];
}) {
  const [val, setVal] = useState(value);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const onChange = async (next: string) => {
    setVal(next); setBusy(true);
    try {
      await fetch('/api/marketing/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ table, id, status: next }) });
      router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <select value={val} disabled={busy} onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-caramel focus:outline-none disabled:opacity-50">
      {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}
