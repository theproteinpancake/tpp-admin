'use client';

import { useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { buildRestockDraft } from '@/lib/transferBuilderActions';

export default function BuildRestockButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-sm text-gray-600">{msg}</span>}
      <button
        onClick={() => start(async () => {
          setMsg(null);
          const r = await buildRestockDraft('MANCHESTER');
          setMsg(r.ok ? `✅ Created ${r.reference} — ${r.lines} lines, ${r.units?.toLocaleString()} units (draft)` : `⚠️ ${r.error}`);
        })}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-caramel px-3 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
      >
        <Sparkles className="h-4 w-4" /> {pending ? 'Building…' : 'Build Manchester restock'}
      </button>
    </div>
  );
}
