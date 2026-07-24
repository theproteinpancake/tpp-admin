'use client';

import { useMemo, useState } from 'react';
import type { PouchRow, PackStatus } from '@/lib/packaging';
import { flavourColor } from '@/lib/flavours';

const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-AU'));
const SEV: Record<string, number> = { unset: 0, ok: 1, order_soon: 2, order_now: 3 };
// Local copy of PACK_STATUS_META: importing it as a VALUE from '@/lib/packaging' pulls the
// server-only Supabase/ShipBob clients into the browser bundle and crashes the page at load
// (their env vars don't exist client-side). Type-only imports from there are fine — erased.
const STATUS_META: Record<PackStatus, { label: string; bg: string }> = {
  unset: { label: 'No baseline', bg: '#9ca3af' },
  order_now: { label: 'Order now', bg: '#dc2626' },
  order_soon: { label: 'Order soon', bg: '#d97706' },
  ok: { label: 'Healthy', bg: '#059669' },
};

type SortKey = 'left' | 'srp' | 'packable' | 'days' | 'status';

const daysMin = (p: PouchRow) => {
  const d = Math.min(p.days_cover ?? Infinity, p.srp?.days_cover ?? Infinity);
  return Number.isFinite(d) ? d : null;
};
const sortVal = (p: PouchRow, k: SortKey): number | null => {
  if (k === 'left') return p.remaining;
  if (k === 'srp') return p.srp ? p.srp.boxes_remaining : null;
  if (k === 'packable') return p.packable;
  if (k === 'days') return daysMin(p);
  return SEV[p.status];
};

export default function PouchTable({ rows }: { rows: PouchRow[] }) {
  // Default: soonest-to-run-out first — "when do I need to order" is the question this page
  // answers. Every numeric header still click-sorts both ways.
  const [key, setKey] = useState<SortKey>('days');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');

  const sorted = useMemo(() => {
    const mul = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortVal(a, key);
      const bv = sortVal(b, key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // no baseline → always last, whichever direction
      if (bv == null) return -1;
      return (av - bv) * mul;
    });
  }, [rows, key, dir]);

  const header = (label: string, k?: SortKey) => (
    <th key={label} className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
      {k ? (
        <button
          type="button"
          onClick={() => { if (key === k) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setKey(k); setDir('asc'); } }}
          className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-caramel ${key === k ? 'text-caramel' : ''}`}
        >
          {label}
          <span className="text-[10px]">{key === k ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
        </button>
      ) : label}
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-paper shadow-sm">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {header('Pouch (SKU)')}
            {header('Pouches left', 'left')}
            {header('SRP boxes at ABC (320g)', 'srp')}
            {header('Packable', 'packable')}
            {header('~Days cover', 'days')}
            {header('Status', 'status')}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((p) => {
            const m = STATUS_META[p.status];
            const d = daysMin(p);
            return (
              <tr key={p.product_id} className="hover:bg-cream/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-1.5 rounded-full" style={{ backgroundColor: flavourColor(p.flavour) }} />
                    <span className="text-sm font-medium text-caramel">{p.flavour} {p.size}</span>
                    <span className="text-[11px] text-gray-400">{p.sku}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-caramel">
                  <span className={p.remaining != null && p.remaining < 0 ? 'text-red-600' : ''}>{fmt(p.remaining)}</span>
                  {p.remaining != null && p.remaining < 0 && <span className="block text-[10px] font-normal text-red-500">count is off — run a stock-take above</span>}
                  {p.inbound > 0 && <span className="block text-[10px] font-normal text-tppblue">+{fmt(p.inbound)} on order</span>}
                </td>
                <td className="px-4 py-3 text-sm">
                  {p.srp ? (
                    <span className={p.srp.binding ? 'font-semibold text-red-600' : 'text-gray-700'}>
                      {fmt(p.srp.boxes_remaining)} <span className="text-[11px] font-normal text-gray-400">boxes → {fmt(p.srp.packable_bags)} bags</span>
                      {p.srp.boxes_inbound > 0 && <span className="block text-[10px] font-normal text-tppblue">+{fmt(p.srp.boxes_inbound)} boxes on order</span>}
                      {p.srp.binding && <span className="block text-[10px] font-medium uppercase tracking-wide text-red-500">⚠ boxes are the limit</span>}
                    </span>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-caramel">
                  {fmt(p.packable)}
                  {p.srp?.binding && <span className="block text-[10px] font-normal text-gray-400">of {fmt(p.remaining)} pouches</span>}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {d != null ? `${d}d` : '—'}
                  {p.daily != null && p.daily > 0 && <span className="block text-[10px] text-gray-400">~{Math.round(p.daily * 7).toLocaleString('en-AU')}/wk packed</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: m.bg }}>{m.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
