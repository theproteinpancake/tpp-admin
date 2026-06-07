import { Handshake, CalendarClock, PackageCheck } from 'lucide-react';
import { listCollabs } from '@/lib/marketing';
import CollabsTable from '@/components/marketing/CollabsTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

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

      <CollabsTable rows={collabs.map((c) => ({
        id: c.id, partner_name: c.partner_name, handle: c.handle, collab_type: c.collab_type, due_date: c.due_date,
        expecting_samples: c.expecting_samples, samples_received: c.samples_received, sample_qty: c.sample_qty,
        title: c.title, status: c.status,
      }))} />
    </div>
  );
}
