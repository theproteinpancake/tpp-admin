'use client';
import FilterableTable, { type Column } from '@/components/ui/FilterableTable';

export type InvoiceRow = {
  id: string | number; invoice_number: string | null; siteLabel: string; invoice_date: string | null;
  period_start: string | null; period_end: string | null; total_amount: number | null; currency: string | null;
  status: string; notes: string | null;
};

const INV_STATUS: Record<string, { label: string; bg: string }> = {
  unpaid: { label: 'Unpaid', bg: '#d97706' }, paid: { label: 'Paid', bg: '#059669' }, disputed: { label: 'Disputed', bg: '#dc2626' },
};
const money = (n: number, ccy: string) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || 'AUD' }).format(n);
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—');

export default function InvoicesTable({ rows }: { rows: InvoiceRow[] }) {
  const columns: Column<InvoiceRow>[] = [
    { key: 'invoice_number', header: 'Invoice', sort: 'text', value: (r) => r.invoice_number || '', cell: (r) => <span className="font-medium text-gray-900">{r.invoice_number || '—'}</span> },
    { key: 'siteLabel', header: 'Site', filter: 'select', sort: 'text', cell: (r) => <span className="text-gray-600">{r.siteLabel || '—'}</span> },
    { key: 'invoice_date', header: 'Date', filter: 'date', sort: 'date', value: (r) => r.invoice_date, cell: (r) => <span className="whitespace-nowrap text-gray-600">{fmtDate(r.invoice_date)}</span> },
    { key: 'period', header: 'Period', cell: (r) => <span className="whitespace-nowrap text-xs text-gray-500">{r.period_start ? `${fmtDate(r.period_start)}–${fmtDate(r.period_end)}` : '—'}</span> },
    { key: 'total_amount', header: 'Total', sort: 'num', align: 'right', value: (r) => r.total_amount ?? 0, cell: (r) => <span className="font-semibold text-gray-900">{r.total_amount != null ? money(r.total_amount, r.currency || 'AUD') : '—'}</span> },
    { key: 'status', header: 'Status', filter: 'select', sort: 'text', cell: (r) => { const st = INV_STATUS[r.status] || INV_STATUS.unpaid; return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: st.bg }}>{st.label}</span>; } },
    { key: 'notes', header: 'Notes', cell: (r) => <span className="text-xs text-gray-500">{r.notes || '—'}</span> },
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm">
      <FilterableTable rows={rows} columns={columns} getKey={(r) => r.id} initialSort={{ key: 'invoice_date', dir: 'desc' }} searchPlaceholder="Search invoices…" empty="No invoices logged yet." />
    </div>
  );
}
