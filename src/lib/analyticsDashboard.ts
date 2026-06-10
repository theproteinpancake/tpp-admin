// Dashboard data for an arbitrary date range + automatic previous-period comparison.
// Powers the Triple-Whale-style Analytics page (KPI tiles + channel sections + attribution).
// Net profit uses the SAME formula as the master + reviews: online gross (real COGS) +
// wholesale margin − ad spend − ShipBob − payment fees − wages.
import { supabaseLogistics } from './supabase-logistics';
import { getAttribution, type AttribRow, type Model } from './attribution';
import { fetchMetaWeek } from './meta';
import { getAssumptions, shopifyWeekCOGS } from './analytics';

const r2 = (n: number) => Math.round(n * 100) / 100;
const div = (a: number, b: number) => (b ? r2(a / b) : null);

export interface Period {
  online: number; orders: number; aov: number | null; new_pct: number | null;
  wholesale: number; sales_total: number;
  meta_spend: number | null; meta_roas: number | null; meta_purchases: number; meta_cpa: number | null;
  ad_spend: number; blended_roas: number | null; nc_roas: number | null; mer: number | null;
  cogs: number; cogs_real: boolean; payment_fees: number; wages: number; gross_profit: number; gpm: number | null;
  shipbob: number; shipbob_orders: number; shipbob_estimated: boolean;
  net_profit: number; npm: number | null;
}

// Real COGS for an arbitrary range. Short ranges (≤16 days — covers every preset up to "last
// 14 days" + any single week) hit Shopify live for EXACT line-item costs, matching the master
// to the dollar. Longer ranges use the blended REAL rate from the stored weekly master COGS
// (last ~12 weeks with data) — still sourced, just averaged. Assumption % only as last resort.
// Returns either an exact kg figure (live Shopify) or a RATE to apply to revenue — so it can
// run in PARALLEL with the attribution fetch (it doesn't need the revenue figure up front).
async function rangeCOGS(fromDate: string, toDate: string, assumptionPct: number): Promise<{ exact?: number; rate?: number; real: boolean }> {
  const days = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400_000);
  if (days <= 16) {
    try {
      const c = await shopifyWeekCOGS(fromDate, toDate);
      if (c) return { exact: c.cogs, real: true };
    } catch { /* fall through to blended */ }
  }
  try {
    const { data } = await supabaseLogistics.from('sales_week')
      .select('online_sales, cogs').not('cogs', 'is', null)
      .order('week_start', { ascending: false }).limit(12);
    const rows = (data ?? []) as any[];
    const sales = rows.reduce((s, r) => s + (Number(r.online_sales) || 0), 0);
    const cogs = rows.reduce((s, r) => s + (Number(r.cogs) || 0), 0);
    if (sales > 0 && cogs > 0) return { rate: cogs / sales, real: true };
  } catch { /* fall through to assumption */ }
  return { rate: assumptionPct, real: false };
}

async function computePeriod(fromDate: string, toDate: string, model: Model = 'last'): Promise<{ p: Period; attr: { rows: AttribRow[]; totals: any } }> {
  const a = await getAssumptions();
  const days = Math.max(1, Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400_000));
  const [attr, meta, wh, sb, cogsRes] = await Promise.all([
    getAttribution(fromDate, toDate, model),
    fetchMetaWeek(fromDate, toDate).catch(() => null), // platform-reported spend/roas/purchases/cpa
    supabaseLogistics.from('wholesale_orders').select('total').gte('order_date', fromDate).lt('order_date', toDate),
    supabaseLogistics.from('shipment_costs').select('cost,currency').gte('ship_date', fromDate).lt('ship_date', toDate),
    rangeCOGS(fromDate, toDate, a.online_cogs_pct), // parallel — biggest page-speed win
  ]);
  // Prefer Meta's native incrementality for the Meta row's NC ROAS/CPA (most accurate) — overrides
  // the click-based attribution figure. Falls back to click attribution if incrementality is 0.
  const metaRow = attr.rows.find((r) => /meta/i.test(r.source));
  const haveInc = !!(meta && meta.inc_conversions > 0);
  if (haveInc && metaRow) { metaRow.nc_roas = meta!.nc_roas; metaRow.nc_cpa = meta!.nc_cpa; }
  const nc_roas = haveInc ? meta!.nc_roas : attr.totals.nc_roas;

  const wholesale = (wh.data ?? []).reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
  const sbRows = (sb.data ?? []) as any[];
  const shipbobActual = sbRows.reduce((s, o) => s + (/gbp/i.test(o.currency || '') ? (Number(o.cost) || 0) * a.fx_gbp_aud : Number(o.cost) || 0), 0);
  const online = attr.totals.revenue;
  const orders = attr.totals.orders;
  // ShipBob bills per-shipment a day or two late — estimate cost for orders not yet costed
  // so RECENT ranges don't understate shipping (and inflate profit). Historical ranges get no
  // estimate: their weekend orders legitimately shipped in the NEXT window (cost books by
  // ship_date, same as the master) — estimating there double-counts (~$22 × backlog).
  const recent = Date.parse(toDate) > Date.now() - 3 * 86400_000;
  const uncosted = recent ? Math.max(0, orders - sbRows.length) : 0;
  const shipbobEst = uncosted * (a.shipbob_per_order || 22);
  const shipbob = shipbobActual + shipbobEst;
  const ad_spend = (meta?.spend || 0); // + google when live
  const cogs = cogsRes.exact ?? online * (cogsRes.rate ?? a.online_cogs_pct);
  const cogs_real = cogsRes.real;
  const payment_fees = online * a.payment_fee_pct;
  const wages = (a.wages_per_day || 0) * days;
  const gross_profit = online - cogs;
  // ONE net-profit formula (matches master + weekly/daily reviews): includes wholesale margin.
  const net_profit = gross_profit + wholesale * a.wholesale_margin - ad_spend - shipbob - payment_fees - wages;
  const sales_total = online + wholesale;
  return {
    attr,
    p: {
      online: r2(online), orders, aov: attr.totals.aov, new_pct: attr.totals.new_pct,
      wholesale: r2(wholesale), sales_total: r2(sales_total),
      meta_spend: meta?.spend ?? null, meta_roas: meta?.roas ?? null, meta_purchases: meta?.purchases || 0, meta_cpa: meta?.cpa ?? null,
      ad_spend: r2(ad_spend), blended_roas: div(online, ad_spend), nc_roas, mer: div(ad_spend, online),
      cogs: r2(cogs), cogs_real, payment_fees: r2(payment_fees), wages: r2(wages), gross_profit: r2(gross_profit), gpm: div(gross_profit, online),
      shipbob: r2(shipbob), shipbob_orders: sbRows.length, shipbob_estimated: uncosted > 0,
      net_profit: r2(net_profit), npm: div(net_profit, sales_total),
    },
  };
}

// from/to are AEST date strings (to exclusive). Returns current + previous-period + attribution.
export async function getDashboard(fromDate: string, toDate: string, model: Model = 'last') {
  const days = Math.max(1, Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400_000));
  const prevTo = fromDate;
  const prevFrom = new Date(Date.parse(fromDate) - days * 86400_000).toISOString().slice(0, 10);
  const [cur, prev] = await Promise.all([computePeriod(fromDate, toDate, model), computePeriod(prevFrom, prevTo, model)]);
  return { current: cur.p, previous: prev.p, attribution: cur.attr.rows, attribTotals: cur.attr.totals, range: { from: fromDate, to: toDate, prevFrom, prevTo, days } };
}
