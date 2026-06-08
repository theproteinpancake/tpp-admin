// Dashboard data for an arbitrary date range + automatic previous-period comparison.
// Powers the Triple-Whale-style Analytics page (KPI tiles + channel sections + attribution).
import { supabaseLogistics } from './supabase-logistics';
import { getAttribution, type AttribRow } from './attribution';
import { fetchMetaWeek } from './meta';
import { getAssumptions } from './analytics';

const r2 = (n: number) => Math.round(n * 100) / 100;
const div = (a: number, b: number) => (b ? r2(a / b) : null);
const AEST = '+10:00';
const utc = (date: string) => new Date(`${date}T00:00:00${AEST}`).toISOString();

export interface Period {
  online: number; orders: number; aov: number | null; new_pct: number | null;
  wholesale: number; sales_total: number;
  meta_spend: number | null; meta_roas: number | null; meta_purchases: number; meta_cpa: number | null;
  ad_spend: number; blended_roas: number | null; nc_roas: number | null; mer: number | null;
  cogs: number; payment_fees: number; gross_profit: number; gpm: number | null;
  shipbob: number; shipbob_orders: number;
  net_profit: number; npm: number | null;
}

async function computePeriod(fromDate: string, toDate: string): Promise<{ p: Period; attr: { rows: AttribRow[]; totals: any } }> {
  const a = await getAssumptions();
  const [attr, meta, wh, sb] = await Promise.all([
    getAttribution(utc(fromDate), utc(toDate), 'last'),
    fetchMetaWeek(fromDate, toDate).catch(() => null), // platform-reported spend/roas/purchases/cpa
    supabaseLogistics.from('wholesale_orders').select('total').gte('order_date', fromDate).lt('order_date', toDate),
    supabaseLogistics.from('shipment_costs').select('cost,currency').gte('ship_date', fromDate).lt('ship_date', toDate),
  ]);
  const wholesale = (wh.data ?? []).reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
  const sbRows = (sb.data ?? []) as any[];
  const shipbob = sbRows.reduce((s, o) => s + (/gbp/i.test(o.currency || '') ? (Number(o.cost) || 0) * a.fx_gbp_aud : Number(o.cost) || 0), 0);
  const online = attr.totals.revenue;
  const orders = attr.totals.orders;
  const ad_spend = (meta?.spend || 0); // + google when live
  const cogs = online * a.online_cogs_pct;
  const payment_fees = online * a.payment_fee_pct;
  const gross_profit = online - cogs;
  const net_profit = gross_profit - ad_spend - shipbob - payment_fees;
  const sales_total = online + wholesale;
  return {
    attr,
    p: {
      online: r2(online), orders, aov: attr.totals.aov, new_pct: attr.totals.new_pct,
      wholesale: r2(wholesale), sales_total: r2(sales_total),
      meta_spend: meta?.spend ?? null, meta_roas: meta?.roas ?? null, meta_purchases: meta?.purchases || 0, meta_cpa: meta?.cpa ?? null,
      ad_spend: r2(ad_spend), blended_roas: div(online, ad_spend), nc_roas: attr.totals.nc_roas, mer: div(ad_spend, online),
      cogs: r2(cogs), payment_fees: r2(payment_fees), gross_profit: r2(gross_profit), gpm: div(gross_profit, online),
      shipbob: r2(shipbob), shipbob_orders: sbRows.length,
      net_profit: r2(net_profit), npm: div(net_profit, online),
    },
  };
}

// from/to are AEST date strings (to exclusive). Returns current + previous-period + attribution.
export async function getDashboard(fromDate: string, toDate: string) {
  const days = Math.max(1, Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400_000));
  const prevTo = fromDate;
  const prevFrom = new Date(Date.parse(fromDate) - days * 86400_000).toISOString().slice(0, 10);
  const [cur, prev] = await Promise.all([computePeriod(fromDate, toDate), computePeriod(prevFrom, prevTo)]);
  return { current: cur.p, previous: prev.p, attribution: cur.attr.rows, attribTotals: cur.attr.totals, range: { from: fromDate, to: toDate, prevFrom, prevTo, days } };
}
