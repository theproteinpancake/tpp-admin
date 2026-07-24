'use client';

import { useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { packagingCommand } from '@/lib/packagingActions';

// The one input that replaces per-row baseline/delivery forms: type what happened, in
// plain English, and the parser applies it (delivery, order placed, stock-take).
export default function PackagingCommand() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; summary: string } | null>(null);
  const [value, setValue] = useState('');

  return (
    <div className="mb-6 rounded-xl border border-caramel/30 bg-cream/40 p-4 shadow-sm">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-caramel">
        <Sparkles className="h-4 w-4" /> Tell me what happened
      </p>
      <form
        action={(fd) => start(async () => { const r = await packagingCommand(fd); setResult(r); if (r.ok) setValue(''); })}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          name="command" value={value} onChange={(e) => setValue(e.target.value)}
          placeholder='e.g. "VISY delivered 1,000 BMS boxes" · "ordered 20k buttermilk 520g pouches from China, landing mid Sept" · "stocktake: SCM pouches 8,000"'
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-caramel focus:outline-none"
        />
        <button type="submit" disabled={pending}
          className="rounded-lg bg-caramel px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-60">
          {pending ? 'Working…' : 'Apply'}
        </button>
      </form>
      {result && (
        <p className={`mt-2 whitespace-pre-line text-sm ${result.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{result.summary}</p>
      )}
      <p className="mt-2 text-[11px] text-gray-400">Deliveries add to stock · orders with a future arrival show as inbound and roll in automatically · stock-takes reset the count.</p>
    </div>
  );
}
