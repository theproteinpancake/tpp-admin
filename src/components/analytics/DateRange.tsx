'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, ChevronDown } from 'lucide-react';

const aestToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date()); // DST-safe
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

function presets() {
  const t = aestToday();
  const tomorrow = addDays(t, 1);
  const dow = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7; // Mon=0 (Z = calendar-space, no local-TZ skew)
  const thisMon = addDays(t, -dow);
  return [
    { k: 'Today', from: t, to: tomorrow },
    { k: 'Yesterday', from: addDays(t, -1), to: t },
    { k: 'Last 7 days', from: addDays(t, -6), to: tomorrow },
    { k: 'Last 14 days', from: addDays(t, -13), to: tomorrow },
    { k: 'Last 30 days', from: addDays(t, -29), to: tomorrow },
    { k: 'Last 90 days', from: addDays(t, -89), to: tomorrow },
    { k: 'This week', from: thisMon, to: tomorrow },
    { k: 'Last week', from: addDays(thisMon, -7), to: thisMon },
  ];
}

export default function DateRange({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(from);
  const [tIncl, setTIncl] = useState(addDays(to, -1));
  const go = (ff: string, tt: string) => { router.push(`/analytics?from=${ff}&to=${tt}`); setOpen(false); };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-caramel shadow-sm hover:border-caramel">
        <Calendar className="h-4 w-4" />{fmt(from)} – {fmt(addDays(to, -1))}<ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
            <div className="grid grid-cols-2 gap-1.5">
              {presets().map((p) => (
                <button key={p.k} onClick={() => go(p.from, p.to)} className="rounded-md px-2 py-1.5 text-left text-xs font-medium text-gray-700 hover:bg-cream">{p.k}</button>
              ))}
            </div>
            <div className="mt-3 border-t border-gray-100 pt-3">
              <div className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="date" value={f} onChange={(e) => setF(e.target.value)} className="rounded border border-gray-200 px-2 py-1 text-caramel" />
                <span>→</span>
                <input type="date" value={tIncl} onChange={(e) => setTIncl(e.target.value)} className="rounded border border-gray-200 px-2 py-1 text-caramel" />
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <button onClick={() => setOpen(false)} className="rounded px-2 py-1 text-xs text-gray-500">Cancel</button>
                <button onClick={() => go(f, addDays(tIncl, 1))} className="rounded-md bg-caramel px-3 py-1 text-xs font-medium text-white hover:bg-maple">Apply</button>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-gray-400">vs previous period · AEST</p>
          </div>
        </>
      )}
    </div>
  );
}
