import Link from 'next/link';
import { Clapperboard, Play, Trophy, ExternalLink } from 'lucide-react';
import { fetchCampaignPerformance, fetchAdPerformance, type AdPerf } from '@/lib/metaAds';
import DateRange from '@/components/analytics/DateRange';
import { melbDate, addDays } from '@/lib/tz';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const money = (n: number | null | undefined) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-AU');
const money2 = (n: number | null | undefined) => n == null ? '—' : '$' + n.toFixed(2);
const x = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(2)}×`;
const pct = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(2)}%`;

type SortKey = 'spend' | 'roas' | 'nc_cpa' | 'purchases';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'spend', label: 'Spend' },
  { key: 'roas', label: 'ROAS' },
  { key: 'nc_cpa', label: 'NC CPA' },
  { key: 'purchases', label: 'Purchases' },
];
// nc_cpa: lower is better (nulls last); others: higher is better.
function sortAds(ads: AdPerf[], k: SortKey): AdPerf[] {
  return [...ads].sort((a, b) => {
    const av = a[k], bv = b[k];
    if (k === 'nc_cpa') return (av ?? Infinity) - (bv ?? Infinity);
    return (bv ?? -Infinity) - (av ?? -Infinity);
  });
}

function Metric({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[9px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`truncate text-xs font-bold ${hot ? 'text-emerald-600' : 'text-caramel'}`}>{value}</p>
    </div>
  );
}

export default async function AdsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; sort?: string }> }) {
  const sp = await searchParams;
  const t = melbDate(0);
  const from = sp.from || addDays(t, -13);
  const to = sp.to || addDays(t, 1); // exclusive
  const sort = (SORTS.find((s) => s.key === sp.sort)?.key || 'spend') as SortKey;

  let campaigns: Awaited<ReturnType<typeof fetchCampaignPerformance>> = [];
  let ads: AdPerf[] = [];
  let err: string | null = null;
  try { [campaigns, ads] = await Promise.all([fetchCampaignPerformance(from, to), fetchAdPerformance(from, to)]); }
  catch (e) { err = String((e as any)?.message || e); }
  const sorted = sortAds(ads, sort);
  const top3 = new Set(sorted.slice(0, 3).map((a) => a.ad_id));
  const totals = campaigns.reduce((s, c) => ({ spend: s.spend + c.spend, revenue: s.revenue + c.revenue, purchases: s.purchases + c.purchases }), { spend: 0, revenue: 0, purchases: 0 });
  const qs = (s: string) => `/analytics/ads?from=${from}&to=${to}&sort=${s}`;

  return (
    <div className="mx-auto max-w-7xl overflow-x-hidden px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Clapperboard className="h-6 w-6 text-caramel" />
          <div>
            <h1 className="text-xl font-bold text-caramel sm:text-2xl">Ads</h1>
            <p className="mt-0.5 text-xs text-gray-500">Meta campaigns + every live creative, ranked. NC figures use incrementality.</p>
          </div>
        </div>
        <DateRange from={from} to={to} path="/analytics/ads" extraQs={`&sort=${sort}`} />
      </div>

      {err && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">Meta error: {err}</p>}

      {/* Campaign performance */}
      <section className="mb-7">
        <h2 className="mb-2 text-sm font-semibold text-caramel">📣 Campaigns</h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-right text-[10px] uppercase tracking-wide text-gray-400">
                <th className="px-2 py-1.5 text-left font-semibold">Campaign</th>
                <th className="px-2 py-1.5 font-semibold">Spend</th>
                <th className="px-2 py-1.5 font-semibold">Revenue</th>
                <th className="px-2 py-1.5 font-semibold">ROAS</th>
                <th className="px-2 py-1.5 font-semibold">Purchases</th>
                <th className="px-2 py-1.5 font-semibold">CPA</th>
                <th className="px-2 py-1.5 font-semibold">NC ROAS</th>
                <th className="px-2 py-1.5 font-semibold">NC CPA</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 text-right last:border-0 hover:bg-cream/40">
                  <td className="max-w-[260px] truncate px-2 py-2 text-left font-medium text-caramel">{c.name}</td>
                  <td className="px-2 py-2 text-gray-600">{money(c.spend)}</td>
                  <td className="px-2 py-2 text-gray-600">{money(c.revenue)}</td>
                  <td className="px-2 py-2 font-semibold text-caramel">{x(c.roas)}</td>
                  <td className="px-2 py-2 text-gray-600">{c.purchases}</td>
                  <td className="px-2 py-2 text-gray-600">{money2(c.cpa)}</td>
                  <td className="px-2 py-2 text-gray-600">{x(c.nc_roas)}</td>
                  <td className="px-2 py-2 text-gray-600">{money2(c.nc_cpa)}</td>
                </tr>
              ))}
              {campaigns.length > 0 && (
                <tr className="border-t-2 border-caramel/30 bg-gray-50 text-right font-semibold">
                  <td className="px-2 py-2 text-left text-caramel">Total</td>
                  <td className="px-2 py-2 text-caramel">{money(totals.spend)}</td>
                  <td className="px-2 py-2 text-caramel">{money(totals.revenue)}</td>
                  <td className="px-2 py-2 text-caramel">{totals.spend ? x(totals.revenue / totals.spend) : '—'}</td>
                  <td className="px-2 py-2 text-caramel">{totals.purchases}</td>
                  <td className="px-2 py-2 text-caramel">{totals.purchases ? money2(totals.spend / totals.purchases) : '—'}</td>
                  <td className="px-2 py-2" colSpan={2}></td>
                </tr>
              )}
              {campaigns.length === 0 && !err && (
                <tr><td colSpan={8} className="px-2 py-4 text-center text-gray-400">No campaign spend in this range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Creative gallery */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-caramel">🎬 Creatives <span className="text-[11px] font-normal text-gray-400">({ads.length} with spend)</span></h2>
          <div className="flex overflow-hidden rounded-lg border border-gray-200 text-xs">
            {SORTS.map((s) => (
              <Link key={s.key} href={qs(s.key)} className={`px-2.5 py-1.5 font-medium ${sort === s.key ? 'bg-caramel text-white' : 'bg-white text-caramel hover:bg-cream'}`}>{s.label}</Link>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((a, i) => (
            <div key={a.ad_id} className={`overflow-hidden rounded-xl border bg-white shadow-sm transition hover:shadow-md ${top3.has(a.ad_id) ? 'border-emerald-400 ring-1 ring-emerald-300' : 'border-gray-200'}`}>
              <div className="relative aspect-square bg-gray-100">
                {a.thumbnail
                  ? <img src={a.thumbnail} alt={a.ad_name} className="h-full w-full object-cover" loading={i < 8 ? 'eager' : 'lazy'} />
                  : <div className="flex h-full w-full items-center justify-center text-3xl">🥞</div>}
                {a.is_video && (
                  <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white"><Play className="h-3 w-3" /> video</span>
                )}
                {top3.has(a.ad_id) && (
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-white"><Trophy className="h-3 w-3" /> #{sorted.findIndex((s) => s.ad_id === a.ad_id) + 1}</span>
                )}
                {a.preview_url && (
                  <a href={a.preview_url} target="_blank" rel="noreferrer" className="absolute bottom-2 right-2 rounded-full bg-white/85 p-1.5 text-caramel shadow hover:bg-white" title="Open ad preview"><ExternalLink className="h-3.5 w-3.5" /></a>
                )}
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-semibold text-caramel" title={a.ad_name}>{a.ad_name}</p>
                <p className="truncate text-[10px] text-gray-400" title={a.campaign_name}>{a.campaign_name}</p>
                <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5">
                  <Metric label="Spend" value={money(a.spend)} />
                  <Metric label="ROAS" value={x(a.roas)} hot={(a.roas ?? 0) >= 3} />
                  <Metric label="CPA" value={money2(a.cpa)} />
                  <Metric label="NC ROAS" value={x(a.nc_roas)} />
                  <Metric label="NC CPA" value={money2(a.nc_cpa)} />
                  <Metric label="CTR" value={pct(a.ctr)} />
                </div>
              </div>
            </div>
          ))}
        </div>
        {ads.length === 0 && !err && <p className="py-8 text-center text-sm text-gray-400">No ads with spend in this range.</p>}
      </section>
    </div>
  );
}
