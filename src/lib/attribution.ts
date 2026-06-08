// Attribution engine — joins click-attributed Shopify orders (per source, new/returning)
// with platform ad spend to produce ROAS / NC ROAS / CPA / NC CPA per channel for any range.
import { supabaseLogistics } from './supabase-logistics';
import { fetchMetaWeek } from './meta'; // (startIso, endExclusiveIso) range insights
import { getAssumptions, derive } from './analytics';

export type Model = 'first' | 'last';
const r2 = (n: number) => Math.round(n * 100) / 100;
const div = (a: number, b: number) => (b ? r2(a / b) : null);
const utcTs = (date: string) => new Date(`${date}T00:00:00+10:00`).toISOString(); // AEST date → UTC instant

export interface AttribRow {
  source: string; spend: number | null; orders: number; revenue: number; nc_orders: number; nc_revenue: number;
  roas: number | null; nc_roas: number | null; cpa: number | null; nc_cpa: number | null;
}

// fromDate inclusive, toDate exclusive — AEST date strings (YYYY-MM-DD)
export async function getAttribution(fromDate: string, toDate: string, model: Model = 'last') {
  const { data } = await supabaseLogistics.rpc('attribution_rollup', { p_from: utcTs(fromDate), p_to: utcTs(toDate), p_model: model });
  const rows = (data ?? []) as any[];
  const bySource = new Map<string, { orders: number; revenue: number; nc_orders: number; nc_revenue: number }>();
  for (const r of rows) bySource.set(r.source, { orders: Number(r.orders) || 0, revenue: Number(r.revenue) || 0, nc_orders: Number(r.nc_orders) || 0, nc_revenue: Number(r.nc_revenue) || 0 });

  // ad spend per channel for the range (AEST dates, matching the dashboard's Meta tile)
  const meta = await fetchMetaWeek(fromDate, toDate).catch(() => null);
  const spendBy: Record<string, number | null> = { meta: meta?.spend ?? null, google: null }; // google dormant until creds

  const order = ['meta', 'google', 'email', 'organic', 'direct', 'other'];
  const labels: Record<string, string> = { meta: 'Meta', google: 'Google Ads', email: 'Email', organic: 'Organic & Social', direct: 'Direct', other: 'Other' };
  const out: AttribRow[] = [];
  for (const src of order) {
    const a = bySource.get(src); if (!a && spendBy[src] == null) continue;
    const o = a || { orders: 0, revenue: 0, nc_orders: 0, nc_revenue: 0 };
    const spend = spendBy[src] ?? null;
    out.push({
      source: labels[src] || src, spend, orders: o.orders, revenue: r2(o.revenue), nc_orders: o.nc_orders, nc_revenue: r2(o.nc_revenue),
      roas: spend != null ? div(o.revenue, spend) : null,
      nc_roas: spend != null ? div(o.nc_revenue, spend) : null,
      cpa: spend != null ? div(spend, o.orders) : null,
      nc_cpa: spend != null ? div(spend, o.nc_orders) : null,
    });
  }
  // any sources not in `order`
  for (const [src, o] of bySource) if (!order.includes(src)) out.push({ source: labels[src] || src, spend: null, orders: o.orders, revenue: r2(o.revenue), nc_orders: o.nc_orders, nc_revenue: r2(o.nc_revenue), roas: null, nc_roas: null, cpa: null, nc_cpa: null });

  const totals = out.reduce((t, r) => ({
    spend: (t.spend || 0) + (r.spend || 0), orders: t.orders + r.orders, revenue: t.revenue + r.revenue,
    nc_orders: t.nc_orders + r.nc_orders, nc_revenue: t.nc_revenue + r.nc_revenue,
  }), { spend: 0, orders: 0, revenue: 0, nc_orders: 0, nc_revenue: 0 });

  return {
    rows: out,
    totals: {
      ...totals, revenue: r2(totals.revenue), nc_revenue: r2(totals.nc_revenue),
      roas: div(totals.revenue, totals.spend), nc_roas: div(totals.nc_revenue, totals.spend),
      cpa: div(totals.spend, totals.orders), nc_cpa: div(totals.spend, totals.nc_orders),
      new_pct: totals.orders ? r2(totals.nc_orders / totals.orders) : null,
      aov: totals.orders ? r2(totals.revenue / totals.orders) : null,
    },
  };
}

// High-level KPI summary for a range (online store via Shopify orders + ad spend + derived profit).
export async function getRangeSummary(fromIso: string, toIso: string, model: Model = 'last') {
  const attr = await getAttribution(fromIso.slice(0, 10), toIso.slice(0, 10), model);
  const a = await getAssumptions();
  // wholesale + shipbob for the range (re-uses sales tables — sum across the date span)
  const [{ data: wh }, { data: sb }] = await Promise.all([
    supabaseLogistics.from('wholesale_orders').select('total').gte('order_date', fromIso.slice(0, 10)).lt('order_date', toIso.slice(0, 10)),
    supabaseLogistics.from('shipment_costs').select('cost,currency').gte('ship_date', fromIso.slice(0, 10)).lt('ship_date', toIso.slice(0, 10)),
  ]);
  const wholesale = (wh ?? []).reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
  const shipbob = (sb ?? []).reduce((s: number, o: any) => s + (/gbp/i.test(o.currency || '') ? (Number(o.cost) || 0) * a.fx_gbp_aud : Number(o.cost) || 0), 0);
  const online = attr.totals.revenue;
  const row = { online_sales: online, amazon_sales: 0, wholesale_invoices: wholesale, gross_profit: online * (1 - a.online_cogs_pct), shipbob_charges: shipbob, meta_spend: attr.rows.find((r) => r.source === 'Meta')?.spend || 0, google_spend: 0, amazon_spend: 0 };
  const d = derive(row, a);
  return { ...attr, profit: { ...d, wholesale: r2(wholesale), shipbob: r2(shipbob) } };
}
