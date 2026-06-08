import Link from 'next/link';
import { BarChart3, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { getDashboard, type Period } from '@/lib/analyticsDashboard';
import DateRange from '@/components/analytics/DateRange';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const money = (n: number | null | undefined) => n == null ? '—' : 'A$' + Math.round(n).toLocaleString('en-AU');
const money2 = (n: number | null | undefined) => n == null ? '—' : 'A$' + n.toFixed(2);
const pct = (n: number | null | undefined) => n == null ? '—' : `${(n * 100).toFixed(1)}%`;
const x = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(2)}×`;
const num = (n: number | null | undefined) => n == null ? '—' : Math.round(n).toLocaleString('en-AU');
const aestToday = () => new Date(Date.now() + 10 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10);

function Delta({ cur, prev, invert }: { cur: number | null | undefined; prev: number | null | undefined; invert?: boolean }) {
  if (cur == null || prev == null || prev === 0) return null;
  const c = (cur - prev) / Math.abs(prev);
  const up = c >= 0; const good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${good ? 'text-emerald-600' : 'text-red-600'}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(Math.round(c * 100))}%
    </span>
  );
}

function Tile({ label, value, cur, prev, invert }: { label: string; value: string; cur?: number | null; prev?: number | null; invert?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <div className="mt-1 flex items-baseline justify-between gap-1">
        <span className="text-lg font-bold text-caramel sm:text-xl">{value}</span>
        <Delta cur={cur} prev={prev} invert={invert} />
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-caramel">{icon && <span>{icon}</span>}{title}</h2>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; model?: string }> }) {
  const sp = await searchParams;
  const t = aestToday();
  const from = sp.from || addDays(t, -6);
  const to = sp.to || addDays(t, 1); // exclusive
  const model = sp.model === 'first' ? 'first' : 'last';
  const { current: c, previous: p, attribution } = await getDashboard(from, to, model);
  const metaRow = attribution.find((r) => r.source === 'Meta');
  const qs = (m: string) => `/analytics?from=${from}&to=${to}&model=${m}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="h-6 w-6 text-caramel" />
          <h1 className="text-xl font-bold text-caramel sm:text-2xl">Analytics</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-gray-200 text-xs">
            <Link href={qs('first')} className={`px-2.5 py-2 font-medium ${model === 'first' ? 'bg-caramel text-white' : 'bg-white text-caramel hover:bg-cream'}`}>First click</Link>
            <Link href={qs('last')} className={`px-2.5 py-2 font-medium ${model === 'last' ? 'bg-caramel text-white' : 'bg-white text-caramel hover:bg-cream'}`}>Last click</Link>
          </div>
          <DateRange from={from} to={to} />
        </div>
      </div>

      <div className="space-y-6">
        {/* Summary */}
        <Section title="Summary" icon="📊">
          <Tile label="Sales total" value={money(c.sales_total)} cur={c.sales_total} prev={p.sales_total} />
          <Tile label="Net profit" value={money(c.net_profit)} cur={c.net_profit} prev={p.net_profit} />
          <Tile label="Net margin" value={pct(c.npm)} cur={c.npm} prev={p.npm} />
          <Tile label="Blended ROAS" value={x(c.blended_roas)} cur={c.blended_roas} prev={p.blended_roas} />
          <Tile label="NC-ROAS" value={x(c.nc_roas)} cur={c.nc_roas} prev={p.nc_roas} />
          <Tile label="MER" value={pct(c.mer)} cur={c.mer} prev={p.mer} invert />
          <Tile label="AOV" value={money2(c.aov)} cur={c.aov} prev={p.aov} />
          <Tile label="New customer %" value={pct(c.new_pct)} cur={c.new_pct} prev={p.new_pct} />
        </Section>

        {/* Store */}
        <Section title="Store" icon="🛍️">
          <Tile label="Online sales" value={money(c.online)} cur={c.online} prev={p.online} />
          <Tile label="Orders" value={num(c.orders)} cur={c.orders} prev={p.orders} />
          <Tile label="AOV" value={money2(c.aov)} cur={c.aov} prev={p.aov} />
          <Tile label="Wholesale" value={money(c.wholesale)} cur={c.wholesale} prev={p.wholesale} />
        </Section>

        {/* Meta */}
        <Section title="Meta Ads" icon="🔵">
          <Tile label="Spend" value={money(c.meta_spend)} cur={c.meta_spend} prev={p.meta_spend} invert />
          <Tile label="ROAS" value={x(c.meta_roas)} cur={c.meta_roas} prev={p.meta_roas} />
          <Tile label="Purchases" value={num(c.meta_purchases)} cur={c.meta_purchases} prev={p.meta_purchases} />
          <Tile label="CPA" value={money2(c.meta_cpa)} cur={c.meta_cpa} prev={p.meta_cpa} invert />
          <Tile label="NC-ROAS (attr.)" value={x(metaRow?.nc_roas)} />
          <Tile label="NC-CPA (attr.)" value={money2(metaRow?.nc_cpa)} />
        </Section>

        {/* Google + Amazon (pending connection) */}
        <Section title="Google Ads" icon="🟡">
          <Tile label="Spend" value="—" />
          <Tile label="ROAS" value="—" />
          <Tile label="Conversions" value="—" />
          <Tile label="Status" value="Pending API" />
        </Section>

        {/* ShipBob */}
        <Section title="ShipBob" icon="📦">
          <Tile label="Fulfilment cost" value={money(c.shipbob)} cur={c.shipbob} prev={p.shipbob} invert />
          <Tile label="Orders shipped" value={num(c.shipbob_orders)} cur={c.shipbob_orders} prev={p.shipbob_orders} />
          <Tile label="Avg cost / order" value={money2(c.shipbob_orders ? c.shipbob / c.shipbob_orders : null)} />
          <Tile label="Ship / sales" value={pct(c.sales_total ? c.shipbob / c.sales_total : null)} invert />
        </Section>

        {/* Expenses */}
        <Section title="Expenses" icon="🧾">
          <Tile label="COGS (est.)" value={money(c.cogs)} cur={c.cogs} prev={p.cogs} invert />
          <Tile label="Shipping (ShipBob)" value={money(c.shipbob)} cur={c.shipbob} prev={p.shipbob} invert />
          <Tile label="Payment fees" value={money(c.payment_fees)} cur={c.payment_fees} prev={p.payment_fees} invert />
          <Tile label="Ad spend" value={money(c.ad_spend)} cur={c.ad_spend} prev={p.ad_spend} invert />
        </Section>

        {/* Profit */}
        <Section title="Profit" icon="💰">
          <Tile label="Gross profit" value={money(c.gross_profit)} cur={c.gross_profit} prev={p.gross_profit} />
          <Tile label="GPM" value={pct(c.gpm)} cur={c.gpm} prev={p.gpm} />
          <Tile label="Net profit" value={money(c.net_profit)} cur={c.net_profit} prev={p.net_profit} />
          <Tile label="Net margin" value={pct(c.npm)} cur={c.npm} prev={p.npm} />
        </Section>

        {/* Attribution */}
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-caramel">↗ Attribution <span className="text-[10px] font-normal text-gray-400">({model === 'first' ? 'first' : 'last'}-click)</span></h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-200 text-right text-[10px] uppercase tracking-wide text-gray-400">
                  <th className="px-2 py-1.5 text-left font-semibold">Source</th>
                  <th className="px-2 py-1.5 font-semibold">Spend</th>
                  <th className="px-2 py-1.5 font-semibold">Orders</th>
                  <th className="px-2 py-1.5 font-semibold">Revenue</th>
                  <th className="px-2 py-1.5 font-semibold">ROAS</th>
                  <th className="px-2 py-1.5 font-semibold">NC-ROAS</th>
                  <th className="px-2 py-1.5 font-semibold">CPA</th>
                  <th className="px-2 py-1.5 font-semibold">NC-CPA</th>
                </tr>
              </thead>
              <tbody>
                {attribution.map((r) => (
                  <tr key={r.source} className="border-b border-gray-100 text-right last:border-0 hover:bg-cream/40">
                    <td className="px-2 py-2 text-left font-medium text-caramel">{r.source}</td>
                    <td className="px-2 py-2 text-gray-600">{r.spend != null ? money(r.spend) : '—'}</td>
                    <td className="px-2 py-2 text-gray-600">{num(r.orders)}</td>
                    <td className="px-2 py-2 font-semibold text-caramel">{money(r.revenue)}</td>
                    <td className="px-2 py-2 text-gray-600">{x(r.roas)}</td>
                    <td className="px-2 py-2 text-gray-600">{x(r.nc_roas)}</td>
                    <td className="px-2 py-2 text-gray-600">{money2(r.cpa)}</td>
                    <td className="px-2 py-2 text-gray-600">{money2(r.nc_cpa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className="text-[11px] text-gray-400">Click-based last-touch attribution from Shopify customer journeys + new/returning. ROAS/NC-ROAS use Meta spend (Google/Amazon pending). COGS, payment-fee &amp; margin assumptions are editable.</p>
      </div>
    </div>
  );
}
