'use client';
import FilterableTable, { type Column } from '@/components/ui/FilterableTable';
import StatusSelect from '@/components/marketing/StatusSelect';

export type CollabRow = {
  id: string | number; partner_name: string; handle: string | null; collab_type: string | null;
  due_date: string | null; expecting_samples: boolean | null; samples_received: boolean | null;
  sample_qty: number | null; title: string | null; status: string | null;
};

const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const STATUS_OPTS = [
  { v: 'planned', label: 'Planned' }, { v: 'samples_incoming', label: 'Samples incoming' },
  { v: 'active', label: 'Active' }, { v: 'completed', label: 'Completed' }, { v: 'cancelled', label: 'Cancelled' },
];
const BADGE: Record<string, string> = {
  planned: 'bg-gray-100 text-gray-600', samples_incoming: 'bg-amber-100 text-amber-700',
  active: 'bg-blue-100 text-blue-700', completed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-600',
};

export default function CollabsTable({ rows }: { rows: CollabRow[] }) {
  const columns: Column<CollabRow>[] = [
    { key: 'partner_name', header: 'Partner', sort: 'text', cell: (r) => <span className="font-medium text-caramel">{r.partner_name}</span> },
    { key: 'handle', header: 'Handle', sort: 'text', cell: (r) => <span className="text-gray-500">{r.handle || '—'}</span> },
    { key: 'collab_type', header: 'Type', filter: 'select', sort: 'text', value: (r) => r.collab_type || '', cell: (r) => <span className="text-gray-600">{r.collab_type || '—'}</span> },
    { key: 'due_date', header: 'Due', sort: 'date', filter: 'date', value: (r) => r.due_date, cell: (r) => <span className="whitespace-nowrap text-gray-500">{fmtDate(r.due_date)}</span> },
    { key: 'samples', header: 'Samples', cell: (r) => <span className="text-xs">{r.expecting_samples ? (r.samples_received ? '✓ received' : `expecting${r.sample_qty ? ` ${r.sample_qty}` : ''}`) : '—'}</span> },
    { key: 'title', header: 'Notes', cell: (r) => <span className="text-xs text-gray-400">{r.title || '—'}</span> },
    { key: 'status', header: 'Status', filter: 'select', sort: 'text', value: (r) => r.status || '', cell: (r) => (
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[r.status || ''] || 'bg-gray-100 text-gray-600'}`}>{(r.status || '').replace('_', ' ')}</span>
        <StatusSelect table="collabs" id={String(r.id)} value={r.status || 'planned'} options={STATUS_OPTS} />
      </div>
    ) },
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm">
      <FilterableTable rows={rows} columns={columns} getKey={(r) => r.id} initialSort={{ key: 'due_date', dir: 'asc' }}
        searchPlaceholder="Search partner / handle…" empty="No collabs yet — Kate can add one via WhatsApp." />
    </div>
  );
}
