'use client';
import FilterableTable, { type Column } from '@/components/ui/FilterableTable';
import ProductThumb from '@/components/ProductThumb';

export type BatchRow = {
  id: string | number; flavour: string | null; sku: string; size: string; site: string;
  lot_number: string | null; expiry_date: string | null; days_left: number | null; on_hand: number;
  color: string; statusLabel: string; statusBg: string;
};

const fmtInt = (n: number) => n.toLocaleString('en-AU');
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export default function BatchesTable({ rows }: { rows: BatchRow[] }) {
  const columns: Column<BatchRow>[] = [
    { key: 'flavour', header: 'Product', sort: 'text', value: (r) => r.flavour ?? r.sku, cell: (r) => (
      <div className="flex items-center gap-2.5">
        <ProductThumb flavour={r.flavour} size={28} />
        <div><div className="font-medium text-gray-900">{r.flavour ?? r.sku}</div><div className="text-[11px] text-gray-500">{r.sku} · {r.size}</div></div>
      </div>
    ) },
    { key: 'site', header: 'Site', filter: 'select', sort: 'text', cell: (r) => <span className="text-gray-600">{r.site}</span> },
    { key: 'lot_number', header: 'Lot', sort: 'text', cell: (r) => <span className="font-mono text-gray-700">{r.lot_number}</span> },
    { key: 'expiry_date', header: 'Best before', sort: 'date', filter: 'date', value: (r) => r.expiry_date, cell: (r) => <span className="whitespace-nowrap text-gray-700">{fmtDate(r.expiry_date)}</span> },
    { key: 'days_left', header: 'Days left', sort: 'num', align: 'right', value: (r) => r.days_left ?? 999999, cell: (r) => <span className="text-gray-700">{r.days_left == null ? '—' : `${r.days_left}d`}</span> },
    { key: 'on_hand', header: 'On hand', sort: 'num', align: 'right', value: (r) => r.on_hand, cell: (r) => <span className="font-semibold text-gray-900">{fmtInt(r.on_hand)}</span> },
    { key: 'statusLabel', header: 'Status', filter: 'select', sort: 'text', cell: (r) => <span className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold text-white" style={{ backgroundColor: r.statusBg }}>{r.statusLabel}</span> },
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm">
      <FilterableTable rows={rows} columns={columns} getKey={(r) => r.id} initialSort={{ key: 'days_left', dir: 'asc' }}
        searchPlaceholder="Search product / lot…" empty="No lot data yet — it populates from the daily ShipBob sync." />
    </div>
  );
}
