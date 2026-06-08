'use client';
import { ExternalLink } from 'lucide-react';
import FilterableTable, { type Column } from '@/components/ui/FilterableTable';

export type OutlierRow = {
  id: string | number; shipment_id: string; order_number: string | null; site: string;
  ship_date: string | null; cost: number; currency: string; x_median: number; ship_option: string | null; url: string;
};

const money = (n: number, ccy: string) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || 'AUD' }).format(n);
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—');

export default function OutliersTable({ rows }: { rows: OutlierRow[] }) {
  const columns: Column<OutlierRow>[] = [
    { key: 'shipment_id', header: 'Shipment', value: (r) => `${r.shipment_id} ${r.order_number || ''}`, cell: (r) => (
      <div><div className="font-medium text-gray-900">{r.shipment_id}</div>{r.order_number && <div className="text-[11px] text-gray-400">order {r.order_number}</div>}</div>
    ) },
    { key: 'site', header: 'Site', filter: 'select', sort: 'text', cell: (r) => <span className="text-gray-600">{r.site}</span> },
    { key: 'ship_date', header: 'Date', filter: 'date', sort: 'date', value: (r) => r.ship_date, cell: (r) => <span className="whitespace-nowrap text-gray-600">{fmtDate(r.ship_date)}</span> },
    { key: 'cost', header: 'Ship cost', sort: 'num', align: 'right', value: (r) => r.cost, cell: (r) => <span className="font-semibold text-gray-900">{money(r.cost, r.currency)}</span> },
    { key: 'x_median', header: 'vs median', sort: 'num', value: (r) => r.x_median, cell: (r) => <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">{r.x_median}× median</span> },
    { key: 'ship_option', header: 'Option', filter: 'select', sort: 'text', value: (r) => r.ship_option || '', cell: (r) => <span className="text-xs text-gray-500">{r.ship_option || '—'}</span> },
    { key: 'link', header: '', cell: (r) => (
      <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-maple hover:underline">ShipBob <ExternalLink className="h-3 w-3" /></a>
    ) },
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm">
      <FilterableTable rows={rows} columns={columns} getKey={(r) => r.id} initialSort={{ key: 'x_median', dir: 'desc' }}
        searchPlaceholder="Search shipment / order…" empty="No outliers right now — shipping costs look normal. ✅" />
    </div>
  );
}
