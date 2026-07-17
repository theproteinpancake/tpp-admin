import { BarChart3, Clock, CalendarDays, DollarSign, Target } from 'lucide-react';
import Link from 'next/link';
import RefreshButton from '@/components/RefreshButton';
import { likelyToPost, influencerAnalytics, influencerActionReport } from '@/lib/marketing';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—');
const money = (n: number | null) => (n == null ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n));

const RANGES = [
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: '12mo', label: 'Last 12 months', days: 365 },
  { key: 'all', label: 'All time', days: null as number | null },
];
const REGION_FLAGS: Record<string, string> = { AU: '🇦🇺', UK: '🇬🇧', NZ: '🇳🇿', USA: '🇺🇸', OTHER: '🌍' };

export default async function InfluencerReportingPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  // range param is a rolling-window key (30d/90d/12mo/all) OR a calendar year ("2025")
  const yearParam = /^\d{4}$/.test(sp.range || '') ? Number(sp.range) : null;
  const range = yearParam ? null : RANGES.find((r) => r.key === (sp.range || '30d')) || RANGES[0];
  const [report, likely, stats] = await Promise.all([influencerActionReport(range?.days ?? null, yearParam), likelyToPost(5), influencerAnalytics()]);
  const windowLabel = yearParam ? `sent in ${yearParam}` : range!.label.toLowerCase();
  const maxMonth = Math.max(1, ...stats.months.map((m) => m.count));
  const c = report.combined;
  const typeOrder = (t: string) => (t === 'None' ? 99 : 0);
  const typeMix = Object.entries(c.by_type).sort((a, b) => typeOrder(a[0]) - typeOrder(b[0]) || b[1] - a[1]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <BarChart3 className="h-6 w-6 text-caramel" />
        <div>
          <h1 className="text-xl font-bold text-caramel">Influencer Reporting</h1>
          <p className="text-sm text-gray-500">gifting performance · <Link href="/marketing/influencers" className="text-caramel underline underline-offset-2 hover:opacity-80">back to the pipeline →</Link></p>
        </div>
        <RefreshButton />
      </div>

      {/* Action report */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-paper p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-400"><Target className="h-3.5 w-3.5" /> Gifting action rate</p>
          <div className="flex flex-wrap gap-1.5">
            {RANGES.map((r) => (
              <Link key={r.key} href={`/marketing/influencer-reporting?range=${r.key}`}
                className={`rounded-full px-3 py-1 text-xs font-medium ${r.key === range?.key ? 'bg-caramel text-white' : 'border border-gray-300 text-gray-600 hover:bg-cream/50'}`}>
                {r.label}
              </Link>
            ))}
            {report.years.map((y) => (
              <Link key={y} href={`/marketing/influencer-reporting?range=${y}`}
                className={`rounded-full px-3 py-1 text-xs font-medium ${y === yearParam ? 'bg-caramel text-white' : 'border border-gray-300 text-gray-600 hover:bg-cream/50'}`}>
                {y}
              </Link>
            ))}
          </div>
        </div>

        {c.sent === 0 ? (
          <p className="py-4 text-sm text-gray-500">No gifts sent in this window.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-3xl font-bold text-caramel">{c.rate}%</span>
              <span className="text-sm text-gray-600">{c.actioned} of {c.sent} gifted influencer{c.sent === 1 ? '' : 's'} took an action ({windowLabel})</span>
            </div>
            {/* action bar */}
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${c.rate}%` }} />
            </div>
            {/* post-type mix */}
            <div className="mt-3 flex flex-wrap gap-2">
              {typeMix.map(([t, n]) => (
                <span key={t} className={`rounded-full px-2.5 py-1 text-xs font-medium ${t === 'None' ? 'bg-gray-100 text-gray-500' : 'bg-cream text-caramel'}`}>
                  {t === 'None' ? 'No action yet' : t}: {n}
                </span>
              ))}
            </div>

            {/* per-region table */}
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr>
                    {['Region', 'Gifts sent', 'Took action', 'Action rate', 'Mix'].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {report.by_region.map((r) => (
                    <tr key={r.region}>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-caramel">{REGION_FLAGS[r.region] || '🌍'} {r.region}</td>
                      <td className="px-3 py-2 text-gray-600">{r.sent}</td>
                      <td className="px-3 py-2 text-gray-600">{r.actioned}</td>
                      <td className="px-3 py-2">
                        <span className={`font-semibold ${r.rate != null && r.rate >= 50 ? 'text-emerald-600' : 'text-caramel'}`}>{r.rate != null ? `${r.rate}%` : '—'}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {Object.entries(r.by_type).filter(([t]) => t !== 'None').map(([t, n]) => `${t} ×${n}`).join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Volume + cost */}
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
    </div>
  );
}
