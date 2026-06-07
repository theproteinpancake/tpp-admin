'use client';
import FilterableTable, { type Column } from '@/components/ui/FilterableTable';

export type OrderRow = {
  invoice_number: string; customer: string; order_date: string | null; cartons: number | null;
  items: string | null; total: number; currency: string; status: string | null;
};

const money = (n: number, ccy: string) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || 'AUD' }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const STATUS: Record<string, string> = {
  PAID: 'bg-emerald-100 text-emerald-700', AUTHORISED: 'bg-blue-100 text-blue-700',
  SUBMITTED: 'bg-amber-100 text-amber-700', DRAFT: 'bg-gray-100 text-gray-600',
};

export default function OrdersTable({ rows }: { rows: OrderRow[] }) {
  const columns: Column<OrderRow>[] = [
    { key: 'invoice_number', header: 'Invoice', sort: 'text', cell: (r) => <span className="font-medium text-gray-700">{r.invoice_number}</span> },
    { key: 'customer', header: 'Customer', sort: 'text', cell: (r) => <span className="text-gray-800">{r.customer}</span> },
    { key: 'order_date', header: 'Date', sort: 'date', filter: 'date', value: (r) => r.order_date, cell: (r) => <span className="whitespace-nowrap text-gray-500">{fmtDate(r.order_date)}</span> },
    { key: 'cartons', header: 'Cartons', sort: 'num', align: 'right', value: (r) => r.cartons ?? 0, cell: (r) => <span className="text-gray-700">{r.cartons || '—'}</span> },
    { key: 'items', header: 'Items', cell: (r) => <span className="text-xs text-gray-400">{r.items || '—'}</span> },
    { key: 'total', header: 'Total', sort: 'num', align: 'right', value: (r) => r.total, cell: (r) => <span className="font-medium text-gray-800">{money(r.total, r.currency)}</span> },
    { key: 'status', header: 'Status', filter: 'select', sort: 'text', value: (r) => r.status || '', cell: (r) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[r.status || ''] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span> },
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <FilterableTable rows={rows} columns={columns} getKey={(r) => r.invoice_number} initialSort={{ key: 'order_date', dir: 'desc' }}
        searchPlaceholder="Search invoice / customer…" empty="No orders yet — hit “Sync from Xero” on the dashboard." />
    </div>
  );
}
