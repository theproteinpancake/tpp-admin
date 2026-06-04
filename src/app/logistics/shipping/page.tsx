import { TrendingUp, AlertTriangle, ExternalLink } from 'lucide-react';
import { getShippingData, shipbobOrderUrl } from '@/lib/shipping';
import ShippingTrendChart from '@/components/stock/ShippingTrendChart';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const money = (n: number, ccy: string) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || 'AUD' }).format(n);
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—');

export default async function ShippingPage() {
  const { weekly, outliers } = await getShippingData();

  // per-site latest-week summary
  const sites = ['ALTONA', 'MANCHESTER'] as const;
  const summary = sites.map((s) => {
    const rows = weekly.filter((w) => w.site === s);
    const latest = rows[rows.length - 1];
    const ccy = latest?.currency || (s === 'ALTONA' ? 'AUD' : 'GBP');
    const avg = rows.length ? rows.reduce((a, w) => a + w.avg_cost, 0) / rows.length : 0;
    return { site: s, ccy, latestAvg: latest?.avg_cost ?? 0, latestTotal: latest?.total_cost ?? 0, avg, outliers: outliers.filter((o) => o.site === s).length };
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Shipping &amp; Billing</h1>
        <p className="mt-1 text-gray-500">ShipBob fulfilment cost trends &amp; outlier alerts — Altona (AU) &amp; Manchester (UK)</p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.map((s) => (
          <div key={s.site} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-gray-900">{s.site === 'ALTONA' ? 'Altona (AU)' : 'Manchester (UK)'}</p>
            <div className="mt-2 text-2xl font-bold text-gray-900">{money(s.avg, s.ccy)}</div>
            <p className="text-xs text-gray-400">avg shipping / order (12-wk)</p>
            <div className="mt-2 flex items-center gap-3 text-xs">
              <span className="text-gray-500">this wk: {money(s.latestTotal, s.ccy)}</span>
              {s.outliers > 0 && <span className="font-medium text-red-600">⚠ {s.outliers} outliers</span>}
            </div>
          </div>
        ))}
      </div>

      <section className="mb-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-caramel" />
          <h2 className="text-lg font-semibold text-gray-900">Avg shipping cost / order — weekly</h2>
        </div>
        <ShippingTrendChart weekly={weekly} />
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <h2 className="text-lg font-semibold text-gray-900">Cost outliers</h2>
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">take a closer look</span>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Order', 'Site', 'Date', 'Ship cost', 'vs median', 'Option', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {outliers.map((o) => (
                <tr key={o.id} className="hover:bg-cream/30">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{o.order_number || o.shipbob_order_id}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{o.site}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{fmtDate(o.ship_date)}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">{money(o.cost, o.currency)}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">{o.x_median}× median</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{o.ship_option || '—'}</td>
                  <td className="px-4 py-3">
                    <a href={shipbobOrderUrl(o.shipbob_order_id)} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-maple hover:underline">
                      ShipBob <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {outliers.length === 0 && <p className="mt-3 text-sm text-gray-500">No outliers right now — shipping costs look normal. ✅</p>}
      </section>
    </div>
  );
}
