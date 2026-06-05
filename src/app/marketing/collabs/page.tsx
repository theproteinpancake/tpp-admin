import { Handshake, CalendarClock, PackageCheck } from 'lucide-react';
import { listCollabs } from '@/lib/marketing';
import StatusSelect from '@/components/marketing/StatusSelect';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const STATUS_OPTS = [
  { v: 'planned', label: 'Planned' }, { v: 'samples_incoming', label: 'Samples incoming' },
  { v: 'active', label: 'Active' }, { v: 'completed', label: 'Completed' }, { v: 'cancelled', label: 'Cancelled' },
];
const BADGE: Record<string, string> = {
  planned: 'bg-gray-100 text-gray-600', samples_incoming: 'bg-amber-100 text-amber-700',
  active: 'bg-blue-100 text-blue-700', completed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-600',
};

export default async function CollabsPage() {
  const collabs = (await listCollabs()) as any[];
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = collabs
    .filter((c) => c.due_date && c.due_date >= today && c.status !== 'completed' && c.status !== 'cancelled')
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <Handshake className="h-6 w-6 text-caramel" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Collabs</h1>
          <p className="text-sm text-gray-500">{collabs.length} partners &amp; collaborations</p>
        </div>
      </div>

      {upcoming && (
        <div className="mb-6 rounded-xl border border-caramel/30 bg-cream/50 p-4 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-semibold text-maple"><CalendarClock className="h-4 w-4" /> Next collab</p>
          <p className="mt-1 text-base font-bold text-gray-900">{upcoming.partner_name} — {fmtDate(upcoming.due_date)}</p>
          <p className="text-sm text-gray-600">{upcoming.title || upcoming.collab_type}</p>
          {upcoming.expecting_samples && (
            <p className={`mt-1 text-xs font-medium ${upcoming.samples_received ? 'text-emerald-600' : 'text-amber-600'}`}>
              <PackageCheck className="mr-1 inline h-3.5 w-3.5" />
              {upcoming.samples_received ? 'Samples received ✓' : `Expecting ${upcoming.sample_qty ? upcoming.sample_qty + ' ' : ''}samples — received yet?`}
            </p>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Partner</th><th className="px-4 py-3">Handle</th><th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Due</th><th className="px-4 py-3">Samples</th><th className="px-4 py-3">Notes</th><th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {collabs.map((c) => (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-cream/30">
                <td className="px-4 py-3 font-medium text-gray-800">{c.partner_name}</td>
                <td className="px-4 py-3 text-gray-500">{c.handle || '—'}</td>
                <td className="px-4 py-3 text-gray-600">{c.collab_type || '—'}</td>
                <td className="px-4 py-3 text-gray-500">{fmtDate(c.due_date)}</td>
                <td className="px-4 py-3 text-xs">{c.expecting_samples ? (c.samples_received ? '✓ received' : `expecting${c.sample_qty ? ` ${c.sample_qty}` : ''}`) : '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{c.title || '—'}</td>
                <td className="px-4 py-3"><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[c.status] || 'bg-gray-100 text-gray-600'}`}>{(c.status || '').replace('_', ' ')}</span><StatusSelect table="collabs" id={c.id} value={c.status || 'planned'} options={STATUS_OPTS} /></div></td>
              </tr>
            ))}
            {collabs.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No collabs yet — Kate can add one via WhatsApp (send the chat screenshot + a short description).</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
