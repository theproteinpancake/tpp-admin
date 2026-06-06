import { Megaphone, Clock } from 'lucide-react';
import { listInfluencers, likelyToPost } from '@/lib/marketing';
import InfluencerTable from '@/components/marketing/InfluencerTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—');

export default async function InfluencersPage() {
  const [influencers, likely] = await Promise.all([listInfluencers(), likelyToPost(5)]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <Megaphone className="h-6 w-6 text-caramel" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Influencers</h1>
          <p className="text-sm text-gray-500">{(influencers as any[]).length} in the database · seeding pipeline</p>
        </div>
      </div>

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

      <InfluencerTable influencers={influencers as any} />
    </div>
  );
}
