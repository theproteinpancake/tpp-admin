import { TrendingUp, AlertTriangle, ExternalLink, Receipt, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { getShippingData, shipbobOrderUrl } from '@/lib/shipping';
import { getBillingData, buildHighlights, SITE_LABEL } from '@/lib/billing';
import ShippingTrendChart from '@/components/stock/ShippingTrendChart';
import InvoiceForm from '@/components/billing/InvoiceForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const money = (n: number, ccy: string) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || 'AUD' }).format(n);
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—');
const fmtMonth = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });

const INV_STATUS: Record<string, { label: string; bg: string }> = {
  unpaid: { label: 'Unpaid', bg: '#d97706' },
  paid: { label: 'Paid', bg: '#059669' },
  disputed: { label: 'Disputed', bg: '#dc2626' },
};

export default async function ShippingPage() {
  const [{ weekly, outliers }, billing] = await Promise.all([getShippingData(), getBillingData()]);
  const { monthly, invoices } = billing;
  const highlights = buildHighlights(monthly, invoices, billing.outliers);
  const months = [...new Set(monthly.map((m) => m.month))].sort().reverse();

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

      {/* ── Billing ── */}
      <section className="mt-10 mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Receipt className="h-5 w-5 text-caramel" />
          <h2 className="text-lg font-semibold text-gray-900">Monthly ShipBob spend</h2>
        </div>
        <div className="mb-5 grid gap-4 sm:grid-cols-2">
          {highlights.map((h) => {
            const up = h.momPct != null && h.momPct > 0;
            return (
              <div key={h.site} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-gray-900">{SITE_LABEL[h.site]}</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-gray-900">{money(h.thisMonth, h.currency)}</span>
                  {h.momPct != null && (
                    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-red-600' : 'text-emerald-600'}`}>
                      {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                      {Math.abs(h.momPct)}% MoM
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400">this month · last month {money(h.lastMonth, h.currency)}</p>
                {h.outlierExposure > 0 && (
                  <p className="mt-2 text-xs font-medium text-red-600">⚠ {money(h.outlierExposure, h.currency)} over-median on {h.outlierCount} flagged order{h.outlierCount === 1 ? '' : 's'} this month</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Month', 'Altona (AUD)', 'Manchester (GBP)'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {months.map((m) => {
                const au = monthly.find((x) => x.month === m && x.site === 'ALTONA');
                const uk = monthly.find((x) => x.month === m && x.site === 'MANCHESTER');
                return (
                  <tr key={m} className="hover:bg-cream/30">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{fmtMonth(m)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {au ? <>{money(au.total, 'AUD')} <span className="text-xs text-gray-400">· {au.shipments} shp · {money(au.avg, 'AUD')}/o</span></> : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {uk ? <>{money(uk.total, 'GBP')} <span className="text-xs text-gray-400">· {uk.shipments} shp · {money(uk.avg, 'GBP')}/o</span></> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-400">Fulfilment spend from per-shipment charges. Storage &amp; receiving fees aren&apos;t exposed by ShipBob&apos;s API — log those invoices below.</p>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-maple" />
            <h2 className="text-lg font-semibold text-gray-900">Invoices</h2>
          </div>
          <InvoiceForm />
        </div>
        {invoices.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
            No invoices logged yet. Use <span className="font-medium">Log invoice</span> to record ShipBob billing-tab invoices (storage, receiving, B2B) and track paid / unpaid / disputed.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Invoice', 'Site', 'Date', 'Period', 'Total', 'Status', 'Notes'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((inv) => {
                  const st = INV_STATUS[inv.status] || INV_STATUS.unpaid;
                  return (
                    <tr key={inv.id} className="hover:bg-cream/30">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{inv.invoice_number || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{inv.site ? SITE_LABEL[inv.site] || inv.site : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{fmtDate(inv.invoice_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{inv.period_start ? `${fmtDate(inv.period_start)}–${fmtDate(inv.period_end)}` : '—'}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">{inv.total_amount != null ? money(inv.total_amount, inv.currency || 'AUD') : '—'}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: st.bg }}>{st.label}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{inv.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
