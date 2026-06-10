import { TrendingUp, Download } from 'lucide-react';
import { getSalesForecast, getOrderingForecast } from '@/lib/forecast';
import ForecastChart from '@/components/logistics/ForecastChart';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-AU');
const pctG = (g: number) => `${g >= 1 ? '+' : ''}${((g - 1) * 100).toFixed(0)}%`;
const kg = (n: number) => (n > 0 ? `${(n / 1000) % 1 === 0 ? n / 1000 + 'T' : n + 'kg'}` : '—');
const monthLabel = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-AU', { month: 'short', year: '2-digit', timeZone: 'UTC' });

function Chip({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-caramel">{value}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  );
}

export default async function ForecastingPage() {
  const [sales, ordering] = await Promise.all([getSalesForecast(), getOrderingForecast(6)]);
  const improve = sales.last_year_total > 0 ? sales.year_projected / sales.last_year_total : 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex items-center gap-2.5">
        <TrendingUp className="h-6 w-6 text-caramel" />
        <div>
          <h1 className="text-xl font-bold text-caramel sm:text-2xl">Forecasting</h1>
          <p className="mt-0.5 text-xs text-gray-500">Projection = last year's weekly curve (your seasonality + peaks) lifted by blended growth.</p>
        </div>
      </div>

      {/* Growth metrics */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Chip label="Projected year" value={money(sales.year_projected)} sub={`vs ${money(sales.last_year_total)} last year`} />
        <Chip label="Vs last year" value={pctG(improve)} sub="full-year projection" />
        <Chip label="Revenue growth" value={pctG(sales.growth_revenue)} sub="last 12 wks vs same wks LY" />
        <Chip label="Customer base" value={pctG(sales.growth_customers)} sub={`${sales.cur_customers.toLocaleString()} vs ${sales.prev_customers.toLocaleString()} buyers/365d`} />
        <Chip label="Peak uplift" value={`${sales.growth_peak.toFixed(2)}×`} sub="BFCM & promo weeks (best recent momentum)" />
        <Chip label="Weekly run-rate" value={money(sales.run_rate_weekly)} sub="avg of last 12 weeks" />
      </div>

      {/* Sales chart */}
      <section className="mb-8 rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
        <ForecastChart series={sales.series} />
      </section>

      {/* ABC ordering forecast */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-caramel">🏭 ABC ordering forecast <span className="text-[11px] font-normal text-gray-400">(ABC multiples per flavour per month)</span></h2>
            <p className="text-[11px] text-gray-400">Live SKU velocity (OOS-softened) + wholesale buffer (~{ordering.wholesale_kg_day}kg/day) × seasonality × {ordering.growth.toFixed(2)}× growth ({ordering.growth_peak.toFixed(2)}× in peak months) — rounded to ABC multiples (Buttermilk 1T, others 500kg; bigger blocks emerge automatically when demand calls for it). Remainders carry forward.</p>
          </div>
          <a href="/api/logistics/forecast-export" className="inline-flex items-center gap-1.5 rounded-lg bg-caramel px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-maple">
            <Download className="h-3.5 w-3.5" /> Export CSV for ABC
          </a>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-right text-[10px] uppercase tracking-wide text-gray-400">
                <th className="px-2 py-1.5 text-left font-semibold">Flavour</th>
                {ordering.months.map((m) => <th key={m} className="px-2 py-1.5 font-semibold">{monthLabel(m)}</th>)}
                <th className="px-2 py-1.5 font-semibold">6-mo total</th>
              </tr>
            </thead>
            <tbody>
              {ordering.flavours.map((f) => (
                <tr key={f.flavour} className="border-b border-gray-100 text-right last:border-0 hover:bg-cream/40">
                  <td className="px-2 py-2 text-left font-medium text-caramel">{f.flavour}</td>
                  {f.months.map((v, i) => (
                    <td key={i} className={`px-2 py-2 tabular-nums ${v > 0 ? 'font-semibold text-caramel' : 'text-gray-300'}`} title={`demand ≈ ${f.demand_kg[i]}kg (incl. ~${f.ws_kg[i]}kg wholesale)`}>{kg(v)}</td>
                  ))}
                  <td className="px-2 py-2 font-bold tabular-nums text-caramel">{kg(f.total)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-caramel/30 bg-gray-50 text-right font-semibold">
                <td className="px-2 py-2 text-left text-caramel">Total</td>
                {ordering.totals.map((v, i) => <td key={i} className="px-2 py-2 tabular-nums text-caramel">{kg(v)}</td>)}
                <td className="px-2 py-2 tabular-nums text-caramel">{kg(ordering.grand_total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">Hover a cell for the raw demand (with the wholesale share) behind the rounding. Forecast starts next month (this month's POs are already placed). Estimates for ABC's production planning — actual POs still go through the normal draft → approve flow.</p>
      </section>
    </div>
  );
}
