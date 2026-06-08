'use client';
import { ExternalLink } from 'lucide-react';
import FilterableTable, { type Column } from '@/components/ui/FilterableTable';

export type OrderRow = {
  invoice_number: string; customer: string; order_date: string | null; cartons: number | null;
  items: string | null; total: number; currency: string; status: string | null;
  reference: string | null; xero_url: string | null; shipbob_url: string | null;
};

const money = (n: number, ccy: string) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || 'AUD' }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const STATUS: Record<string, string> = {
  PAID: 'bg-emerald-100 text-emerald-700', AUTHORISED: 'bg-blue-100 text-blue-700',
  SUBMITTED: 'bg-amber-100 text-amber-700', DRAFT: 'bg-gray-100 text-gray-600',
};

export default function OrdersTable({ rows }: { rows: OrderRow[] }) {
  const columns: Column<OrderRow>[] = [
    { key: 'invoice_number', header: 'Invoice', sort: 'text', cell: (r) => (
      r.xero_url
        ? <a href={r.xero_url} target="_blank" rel="noreferrer" title="Open in Xero" className="inline-flex items-center gap-1 font-medium text-maple hover:underline">{r.invoice_number}<ExternalLink className="h-3 w-3 opacity-60" /></a>
        : <span className="font-medium text-gray-700">{r.invoice_number}</span>
    ) },
    { key: 'reference', header: 'Reference', sort: 'text', value: (r) => r.reference || '', cell: (r) => <span className="text-xs text-gray-500">{r.reference || '—'}</span> },
    { key: 'customer', header: 'Customer', sort: 'text', cell: (r) => <span className="text-gray-800">{r.customer}</span> },
    { key: 'order_date', header: 'Date', sort: 'date', filter: 'date', value: (r) => r.order_date, cell: (r) => <span className="whitespace-nowrap text-gray-500">{fmtDate(r.order_date)}</span> },
    { key: 'cartons', header: 'Cartons', sort: 'num', align: 'right', value: (r) => r.cartons ?? 0, cell: (r) => <span className="text-gray-700">{r.cartons || '—'}</span> },
    { key: 'items', header: 'Items', cell: (r) => <span className="text-xs text-gray-400">{r.items || '—'}</span> },
    { key: 'total', header: 'Total', sort: 'num', align: 'right', value: (r) => r.total, cell: (r) => <span className="font-medium text-gray-800">{money(r.total, r.currency)}</span> },
    { key: 'status', header: 'Status', filter: 'select', sort: 'text', value: (r) => r.status || '', cell: (r) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[r.status || ''] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span> },
    { key: 'shipbob', header: 'ShipBob', cell: (r) => (
      r.shipbob_url
        ? <a href={r.shipbob_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">Order<ExternalLink className="h-3 w-3" /></a>
        : <span className="text-xs text-gray-300">—</span>
    ) },
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <FilterableTable rows={rows} columns={columns} getKey={(r) => r.invoice_number} initialSort={{ key: 'invoice_number', dir: 'desc' }}
        searchPlaceholder="Search invoice / customer / ref…" empty="No orders yet — hit “Sync from Xero” on the dashboard." />
    </div>
  );
}
