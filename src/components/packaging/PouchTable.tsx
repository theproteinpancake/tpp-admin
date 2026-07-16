'use client';

import { useMemo, useState } from 'react';
import type { PouchRow, PackStatus } from '@/lib/packaging';
import { setPouchBaseline, logPackagingDelivery } from '@/lib/packagingActions';
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
  // Default: least packable stock first — "what can I actually still pack" is the number
  // Luke scans for, and the scarcest SKU should always be the top row.
  const [key, setKey] = useState<SortKey>('packable');
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
            {header('Baseline / log delivery')}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((p) => {
            const m = STATUS_META[p.status];
            const d = daysMin(p);
            // delivery targets: the pouch packaging row (exists once a baseline is set) and,
            // for 320g, the linked SRP-carton row
            const targets = [
              ...(p.pack_id ? [{ id: p.pack_id, label: 'Pouches' }] : []),
              ...(p.srp ? [{ id: p.srp.pack_id, label: 'SRP boxes' }] : []),
            ];
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
                  {fmt(p.remaining)}
                  {p.delivered > 0 && <span className="block text-[10px] font-normal text-emerald-600">incl. +{fmt(p.delivered)} delivered</span>}
                </td>
                <td className="px-4 py-3 text-sm">
                  {p.srp ? (
                    <span className={p.srp.binding ? 'font-semibold text-red-600' : 'text-gray-700'}>
                      {fmt(p.srp.boxes_remaining)} <span className="text-[11px] font-normal text-gray-400">boxes → {fmt(p.srp.packable_bags)} bags</span>
                      {p.srp.boxes_delivered > 0 && <span className="block text-[10px] font-normal text-emerald-600">incl. +{fmt(p.srp.boxes_delivered)} delivered</span>}
                      {p.srp.binding && <span className="block text-[10px] font-medium uppercase tracking-wide text-red-500">⚠ boxes are the limit</span>}
                    </span>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-caramel">
                  {fmt(p.packable)}
                  {p.srp?.binding && <span className="block text-[10px] font-normal text-gray-400">of {fmt(p.remaining)} pouches</span>}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{d != null ? `${d}d` : '—'}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: m.bg }}>{m.label}</span>
                </td>
                <td className="px-4 py-3">
                  <form action={async (fd) => { await setPouchBaseline(fd); }} className="flex items-center gap-1.5">
                    <input type="hidden" name="product_id" value={p.product_id} />
                    <input name="baseline_qty" type="number" defaultValue={p.baseline_qty ?? ''} placeholder="baseline"
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-caramel focus:outline-none" />
                    <input name="lead_days" type="number" defaultValue={p.lead_days} title="lead days"
                      className="w-12 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-caramel focus:outline-none" />
                    <button type="submit" className="rounded-md bg-caramel px-2 py-1 text-[11px] font-medium text-white hover:opacity-90">Save</button>
                  </form>
                  {targets.length > 0 && (
                    <form action={async (fd) => { await logPackagingDelivery(fd); }} className="mt-1.5 flex items-center gap-1.5">
                      <input name="qty" type="number" min={1} placeholder="+ delivery"
                        className="w-20 rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-caramel focus:outline-none" />
                      {targets.length > 1 ? (
                        <select name="packaging_id" defaultValue={targets[targets.length - 1].id}
                          className="rounded-md border border-gray-300 px-1.5 py-1 text-xs focus:border-caramel focus:outline-none">
                          {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      ) : (
                        <>
                          <input type="hidden" name="packaging_id" value={targets[0].id} />
                          <span className="text-[11px] text-gray-400">{targets[0].label.toLowerCase()}</span>
                        </>
                      )}
                      <button type="submit" className="rounded-md border border-caramel px-2 py-1 text-[11px] font-medium text-caramel hover:bg-cream/50">Log</button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
