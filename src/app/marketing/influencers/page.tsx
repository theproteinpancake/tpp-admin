import { Megaphone, Clock, CalendarDays, DollarSign } from 'lucide-react';
import RefreshButton from '@/components/RefreshButton';
import { listInfluencers, likelyToPost, influencerAnalytics } from '@/lib/marketing';
import InfluencerTable from '@/components/marketing/InfluencerTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—');
const money = (n: number | null) => (n == null ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n));

export default async function InfluencersPage() {
  const [influencers, likely, stats] = await Promise.all([listInfluencers(), likelyToPost(5), influencerAnalytics()]);
  const maxMonth = Math.max(1, ...stats.months.map((m) => m.count));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <Megaphone className="h-6 w-6 text-caramel" />
        <div>
          <h1 className="text-xl font-bold text-caramel">Influencers</h1>
          <p className="text-sm text-gray-500">{(influencers as any[]).length} in the database · seeding pipeline</p>
        </div>
        <RefreshButton />
      </div>

      {/* Analytics */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-paper p-4 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-400"><CalendarDays className="h-3.5 w-3.5" /> Avg influencers / month</p>
          <p className="mt-1 text-2xl font-bold text-caramel">{stats.avgPerMonth}</p>
          <p className="text-[11px] text-gray-400">{stats.sentLast12} sent in the last 12 months</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-paper p-4 shadow-sm lg:col-span-2">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Sent per month (12 mo)</p>
          <div className="flex h-20 items-end gap-1.5">
            {stats.months.map((m, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full items-end justify-center" style={{ height: '56px' }}>
                  <div className="w-full rounded-t bg-caramel/80" style={{ height: `${Math.round((m.count / maxMonth) * 100)}%` }} title={`${m.count}`} />
                </div>
                <span className="text-[9px] text-gray-400">{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-paper p-4 shadow-sm">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-400"><DollarSign className="h-3.5 w-3.5" /> Avg cost per parcel</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="text-2xl font-bold text-caramel">{money(stats.avg_parcel)}</span>
          <span className="text-sm text-gray-500">COGS {money(stats.avg_cogs)} + fulfilment {money(stats.avg_fulfilment)}</span>
          <span className="text-[11px] text-gray-400">based on {stats.costed_count} parcel{stats.costed_count === 1 ? '' : 's'} with cost data{stats.fulfilment_count === 0 ? ' (fulfilment fills in once ShipBob bills the orders)' : ''}</span>
        </div>
      </div>

      {likely.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-paper p-4 shadow-sm">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-caramel"><Clock className="h-4 w-4 text-caramel" /> Most likely to post next</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {likely.map((i) => (
              <div key={i.name} className="rounded-lg border border-gray-100 bg-cream/40 p-3">
                <p className="truncate text-sm font-medium text-caramel">{i.name}</p>
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
