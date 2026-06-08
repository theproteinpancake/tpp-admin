'use client';
import FilterableTable, { type Column } from '@/components/ui/FilterableTable';
import POActions from '@/components/po/POActions';

export type PORow = {
  id: string; supplier_name: string; po_ref: string; dest: string; status: string;
  statusLabel: string; statusChip: string; expected_date: string | null;
  received: number; ordered: number; outstanding: number;
  total_cost: number | null; valueText: string; itemLines: string[]; extraItems: number;
};

export default function POTable({ rows }: { rows: PORow[] }) {
  const columns: Column<PORow>[] = [
    { key: 'supplier_name', header: 'PO / Supplier', sort: 'text', value: (r) => `${r.supplier_name} ${r.po_ref}`, cell: (r) => (
      <div><div className="font-medium text-gray-900">{r.supplier_name}</div><div className="text-[11px] text-gray-400">{r.po_ref}</div></div>
    ) },
    { key: 'dest', header: 'Dest', filter: 'select', sort: 'text', cell: (r) => <span className="text-gray-600">{r.dest}</span> },
    { key: 'statusLabel', header: 'Status', filter: 'select', sort: 'text', cell: (r) => (
      <div><span className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${r.statusChip}`}>{r.statusLabel}</span><POActions id={r.id} status={r.status} /></div>
    ) },
    { key: 'expected_date', header: 'Expected', sort: 'date', filter: 'date', value: (r) => r.expected_date, cell: (r) => <span className="whitespace-nowrap text-gray-600">{r.expected_date ?? '—'}</span> },
    { key: 'ordered', header: 'Units (recv/ord)', sort: 'num', value: (r) => r.ordered, cell: (r) => (
      <span className="text-gray-700">{r.received}/{r.ordered}{r.outstanding > 0 && <span className="ml-1 text-[11px] text-amber-600">(+{r.outstanding} inbound)</span>}</span>
    ) },
    { key: 'total_cost', header: 'Value', sort: 'num', align: 'right', value: (r) => r.total_cost ?? 0, cell: (r) => <span className="whitespace-nowrap text-gray-700">{r.valueText}</span> },
    { key: 'items', header: 'Items', cell: (r) => (
      <div className="text-xs text-gray-500">{r.itemLines.map((l, i) => <div key={i}>{l}</div>)}{r.extraItems > 0 && <div>+{r.extraItems} more</div>}</div>
    ) },
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm">
      <FilterableTable rows={rows} columns={columns} getKey={(r) => r.id} initialSort={{ key: 'expected_date', dir: 'asc' }}
        searchPlaceholder="Search supplier / PO…" empty="No purchase orders match." />
    </div>
  );
}
