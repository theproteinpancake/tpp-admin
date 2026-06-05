import { Megaphone, Clock, ExternalLink } from 'lucide-react';
import { listInfluencers, likelyToPost } from '@/lib/marketing';
import StatusSelect from '@/components/marketing/StatusSelect';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—');
const STATUS_OPTS = [
  { v: 'order_processing', label: 'Order processing' }, { v: 'shipped', label: 'Shipped' },
  { v: 'delivered', label: 'Delivered' }, { v: 'posted', label: 'Posted' }, { v: 'completed', label: 'Completed' },
];
const BADGE: Record<string, string> = {
  order_processing: 'bg-gray-100 text-gray-600', shipped: 'bg-blue-100 text-blue-700',
  delivered: 'bg-violet-100 text-violet-700', posted: 'bg-amber-100 text-amber-700', completed: 'bg-emerald-100 text-emerald-700',
};

export default async function InfluencersPage() {
  const [influencers, likely] = await Promise.all([listInfluencers(), likelyToPost(5)]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <Megaphone className="h-6 w-6 text-caramel" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Influencers</h1>
          <p className="text-sm text-gray-500">{(influencers as any[]).length} gifted · seeding pipeline</p>
        </div>
      </div>

      {/* Most likely to post next */}
      {likely.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700"><Clock className="h-4 w-4 text-caramel" /> Most likely to post next</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {likely.map((i) => (
              <div key={i.name} className="rounded-lg border border-gray-100 bg-cream/40 p-3">
                <p className="truncate text-sm font-medium text-gray-800">{i.name}</p>
                {i.handle && <p className="truncate text-xs text-gray-400">{i.handle}</p>}
                <p className="mt-1 text-xs text-gray-500">{i.flavour}</p>
                <p className="mt-1 text-[11px] text-gray-400">{i.days_since}d since received ({fmtDate(i.received)})</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Name</th><th className="px-4 py-3">Handle</th><th className="px-4 py-3">Followers</th>
              <th className="px-4 py-3">Flavour</th><th className="px-4 py-3">From</th><th className="px-4 py-3">Sent</th>
              <th className="px-4 py-3">Tracking</th><th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {(influencers as any[]).map((i) => (
              <tr key={i.id} className="border-b border-gray-50 hover:bg-cream/30">
                <td className="px-4 py-3 font-medium text-gray-800">{i.name}</td>
                <td className="px-4 py-3 text-gray-500">{i.handle || '—'}</td>
                <td className="px-4 py-3 text-gray-500">{i.followers ? i.followers.toLocaleString() : '—'}</td>
                <td className="px-4 py-3 text-gray-700">{i.flavour_sent || '—'}</td>
                <td className="px-4 py-3 text-gray-400">{i.sent_from === 'MANCHESTER' ? 'UK' : i.sent_from === 'ALTONA' ? 'AU' : '—'}</td>
                <td className="px-4 py-3 text-gray-500">{fmtDate(i.date_initiated)}</td>
                <td className="px-4 py-3 text-xs">
                  {i.tracking_url ? <a href={i.tracking_url} target="_blank" className="inline-flex items-center gap-1 text-blue-600 hover:underline">{i.tracking_number || 'track'} <ExternalLink className="h-3 w-3" /></a>
                    : i.tracking_number || <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3"><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[i.status] || 'bg-gray-100 text-gray-600'}`}>{(i.status || '').replace('_', ' ')}</span><StatusSelect table="influencers" id={i.id} value={i.status || 'order_processing'} options={STATUS_OPTS} /></div></td>
              </tr>
            ))}
            {(influencers as any[]).length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">No influencers yet — Kate can gift one via WhatsApp (send their chat screenshot + “send 1x Buttermilk 520g from AU”).</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
