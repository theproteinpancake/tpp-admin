// Sales & Data Master — weekly analytics. Auto-fills the API-owned fields (Shopify online
// sales/orders/AOV/shipping + regional, ShipBob fulfilment charges, Xero wholesale invoices)
// and computes the derived profit metrics. Ad-platform fields stay manual until Meta/Google
// APIs are wired (Phase 2).
import { supabaseLogistics } from './supabase-logistics';
import { fetchMetaWeek, metaConfigured } from './meta';
import { getShopifyToken, SHOPIFY_SHOP } from './shopifyToken';

const SHOP = SHOPIFY_SHOP;
const API = '2024-10';

export interface Assumptions { wholesale_margin: number; online_cogs_pct: number; payment_fee_pct: number; fx_gbp_aud: number; weekly_target_sales: number; weekly_target_np: number; employees: number; wages_per_day: number; shipbob_per_order: number; }
// online_cogs_pct is only a FALLBACK now — real per-week COGS from Shopify drives gross
// profit when available. 0.33 ≈ the observed ~67% GPM.
const DEFAULT_ASSUMPTIONS: Assumptions = { wholesale_margin: 0.38, online_cogs_pct: 0.33, payment_fee_pct: 0.03, fx_gbp_aud: 1.95, weekly_target_sales: 40000, weekly_target_np: 4000, employees: 4, wages_per_day: 371, shipbob_per_order: 22 };

export async function getAssumptions(): Promise<Assumptions> {
  const { data } = await supabaseLogistics.from('app_config').select('value').eq('key', 'analytics_assumptions').maybeSingle();
  try { return { ...DEFAULT_ASSUMPTIONS, ...(typeof data?.value === 'string' ? JSON.parse(data!.value as string) : (data?.value || {})) }; }
  catch { return DEFAULT_ASSUMPTIONS; }
}

// Monday 00:00 (local) for a given date; ISO date string helpers
export function mondayOf(d: Date): Date { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function weekRange(weekStart: string) { const s = new Date(weekStart + 'T00:00:00'); const e = new Date(s.getTime() + 7 * 86400_000); return { start: s, end: e, startIso: iso(s), endIso: iso(e) }; }

// ---- Shopify: aggregate paid orders created in [start,end) ----
export async function shopifyOrders(startIso: string, endIso: string) {
  const token = await getShopifyToken();
  const base = `https://${SHOP}/admin/api/${API}/orders.json`;
  let url = `${base}?status=any&financial_status=paid&created_at_min=${startIso}T00:00:00Z&created_at_max=${endIso}T00:00:00Z&limit=250&fields=id,total_price,subtotal_price,total_discounts,shipping_lines,shipping_address,created_at`;
  const orders: any[] = [];
  for (let i = 0; i < 20 && url; i++) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 120)}`);
    const j = await res.json();
    orders.push(...(j.orders || []));
    const link = res.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : '';
  }
  const num = (v: any) => Number(v) || 0;
  const ship = (o: any) => (o.shipping_lines || []).reduce((s: number, l: any) => s + num(l.price), 0);
  const region = (o: any) => (o.shipping_address?.country_code || '').toUpperCase();
  const totalSales = orders.reduce((s, o) => s + num(o.total_price), 0);
  const shippingCharged = orders.reduce((s, o) => s + ship(o), 0);
  const reg = (code: string) => { const rs = orders.filter((o) => region(o) === code); const sales = rs.reduce((s, o) => s + num(o.total_price), 0); return { orders: rs.length, sales, aov: rs.length ? sales / rs.length : 0 }; };
  const nz = reg('NZ'); const uk = reg('GB');
  return {
    online_sales: round2(totalSales), orders: orders.length, aov: orders.length ? round2(totalSales / orders.length) : 0,
    shipping_charged: round2(shippingCharged),
    orders_nz: nz.orders, nz_aov: round2(nz.aov), orders_uk: uk.orders, uk_aov: round2(uk.aov),
  };
}

// ---- Shopify COGS: real cost of goods for paid orders created in [start,end) ----
// Builds a variant→unit-cost map (from Shopify's cost-per-item) then sums quantity×cost
// across the week's order line items. Returns AUD COGS + how many units lacked a cost
// (so the caller can fall back to the % assumption if coverage is poor).
let _variantCost: { at: number; map: Map<string, number> } | null = null;
async function variantCostMap(token: string): Promise<Map<string, number>> {
  if (_variantCost && Date.now() - _variantCost.at < 3600_000) return _variantCost.map;
  const url = `https://${SHOP}/admin/api/${API}/graphql.json`;
  const Q = `query($cursor:String){ productVariants(first:250, after:$cursor){ pageInfo{ hasNextPage endCursor } nodes{ id inventoryItem{ unitCost{ amount } } } } }`;
  const map = new Map<string, number>();
  let cursor: string | null = null;
  for (let page = 0; page < 40; page++) {
    const res: Response = await fetch(url, { method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: Q, variables: { cursor } }) });
    const j: any = await res.json();
    const conn = j.data?.productVariants;
    for (const v of (conn?.nodes || [])) { const c = v.inventoryItem?.unitCost?.amount; if (c != null) map.set(v.id, Number(c) || 0); }
    if (!conn?.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  _variantCost = { at: Date.now(), map };
  return map;
}

export async function shopifyWeekCOGS(startIso: string, endIso: string): Promise<{ cogs: number; units: number; missing_units: number } | null> {
  const token = await getShopifyToken();
  const costMap = await variantCostMap(token);
  if (!costMap.size) throw new Error('no variant unit-costs returned (is cost-per-item set + read_inventory scope granted?)');
  const url = `https://${SHOP}/admin/api/${API}/graphql.json`;
  const q = `created_at:>=${startIso}T00:00:00Z created_at:<${endIso}T00:00:00Z financial_status:paid`;
  const Q = `query($cursor:String,$q:String){ orders(first:50, after:$cursor, query:$q, sortKey:CREATED_AT){ pageInfo{ hasNextPage endCursor } nodes{ lineItems(first:20){ nodes{ quantity variant{ id } } } } } }`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let cursor: string | null = null, cogs = 0, units = 0, missing = 0;
  for (let page = 0; page < 60; page++) {
    let j: any = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const res: Response = await fetch(url, { method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: Q, variables: { cursor, q } }) });
      j = await res.json();
      const throttled = Array.isArray(j.errors) && j.errors.some((e: any) => e.extensions?.code === 'THROTTLED');
      if (!throttled) break;
      await sleep(2500 * (attempt + 1));
    }
    if (j.errors) throw new Error('shopify orders query: ' + JSON.stringify(j.errors).slice(0, 200));
    const ts = j.extensions?.cost?.throttleStatus;
    if (ts && ts.currentlyAvailable < 400) await sleep(Math.min(3000, ((400 - ts.currentlyAvailable) / (ts.restoreRate || 100)) * 1000));
    const conn = j.data?.orders;
    for (const o of (conn?.nodes || [])) for (const li of (o.lineItems?.nodes || [])) {
      const qty = Number(li.quantity) || 0; const id = li.variant?.id;
      if (id && costMap.has(id)) { cogs += qty * (costMap.get(id) as number); units += qty; }
      else missing += qty;
    }
    if (!conn?.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return { cogs: round2(cogs), units, missing_units: missing };
}

// ---- ShipBob: sum fulfilment cost for shipments dated in the week (GBP→AUD) ----
async function shipbobCharges(startIso: string, endIso: string, fx: number) {
  const { data } = await supabaseLogistics.from('shipment_costs').select('cost, currency').gte('ship_date', startIso).lt('ship_date', endIso);
  let total = 0;
  for (const r of (data ?? []) as any[]) { const c = Number(r.cost) || 0; total += /gbp/i.test(r.currency || '') ? c * fx : c; }
  return round2(total);
}

// ---- Xero/Wholesale: sum invoice totals dated in the week ----
async function wholesaleTotal(startIso: string, endIso: string) {
  const { data } = await supabaseLogistics.from('wholesale_orders').select('total').gte('order_date', startIso).lt('order_date', endIso);
  return round2((data ?? []).reduce((s: number, o: any) => s + (Number(o.total) || 0), 0));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Auto-fill a week's API-owned fields (never overwrites user-locked fields).
export async function autofillWeek(weekStart: string) {
  const { startIso, endIso } = weekRange(weekStart);
  const a = await getAssumptions();
  const [shop, sb, wh, meta, existing] = await Promise.all([
    shopifyOrders(startIso, endIso).catch((e) => ({ _err: String(e) } as any)),
    shipbobCharges(startIso, endIso, a.fx_gbp_aud).catch(() => null),
    wholesaleTotal(startIso, endIso).catch(() => null),
    metaConfigured() ? fetchMetaWeek(startIso, endIso).catch((e) => ({ _err: String(e) } as any)) : Promise.resolve(null),
    supabaseLogistics.from('sales_week').select('locked, cogs').eq('week_start', weekStart).maybeSingle(),
  ]);
  const locked: string[] = (existing.data?.locked as string[]) || [];
  const row: Record<string, unknown> = { week_start: weekStart, auto_filled_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const set = (k: string, v: unknown) => { if (v != null && !locked.includes(k)) row[k] = v; };
  if (shop && !shop._err) {
    set('online_sales', shop.online_sales); set('orders', shop.orders); set('aov', shop.aov);
    set('shipping_charged', shop.shipping_charged);
    set('orders_nz', shop.orders_nz); set('nz_aov', shop.nz_aov); set('orders_uk', shop.orders_uk); set('uk_aov', shop.uk_aov);
    // Gross profit from REAL Shopify COGS when we have it (kept fresh by /api/analytics/backfill-cogs);
    // fall back to the % assumption only when no real cost is stored yet.
    const storedCogs = existing.data?.cogs != null ? Number(existing.data.cogs) : null;
    set('gross_profit', round2(storedCogs != null ? shop.online_sales - storedCogs : shop.online_sales * (1 - a.online_cogs_pct)));
  }
  if (sb != null) set('shipbob_charges', sb);
  if (wh != null) set('wholesale_invoices', wh);
  if (meta && !meta._err) {
    set('meta_spend', meta.spend); set('meta_roas', meta.roas); set('meta_purchases', meta.purchases); set('meta_cpa', meta.cpa);
    // NC ROAS/CPA from our attribution engine (new-customer Meta revenue/orders ÷ spend)
    if (meta.spend) {
      try {
        const fromTs = new Date(`${startIso}T00:00:00+10:00`).toISOString();
        const toTs = new Date(`${endIso}T00:00:00+10:00`).toISOString();
        const { data: roll } = await supabaseLogistics.rpc('attribution_rollup', { p_from: fromTs, p_to: toTs, p_model: 'last' });
        const m = ((roll ?? []) as any[]).find((r) => r.source === 'meta');
        if (m) {
          const ncRev = Number(m.nc_revenue) || 0, ncOrd = Number(m.nc_orders) || 0;
          set('meta_nc_roas', round2(ncRev / meta.spend));
          set('meta_nc_cpa', ncOrd ? round2(meta.spend / ncOrd) : null);
        }
      } catch { /* attribution best-effort */ }
    }
  }
  await supabaseLogistics.from('sales_week').upsert(row, { onConflict: 'week_start' });
  return { week_start: weekStart, shopify: shop?._err ? `error: ${shop._err}` : 'ok', shipbob: sb, wholesale: wh, meta: meta?._err ? `error: ${meta._err}` : (meta ? 'ok' : 'not configured') };
}

// Derived profit metrics for a stored row.
export function derive(r: any, a: Assumptions) {
  const n = (v: any) => Number(v) || 0;
  const sales_total = n(r.online_sales) + n(r.amazon_sales) + n(r.wholesale_invoices);
  const total_ad_spend = n(r.meta_spend) + n(r.google_spend) + n(r.amazon_spend);
  const gross_profit = n(r.gross_profit);
  const wholesale_np = n(r.wholesale_invoices) * a.wholesale_margin;
  const wages = (a.wages_per_day || 0) * 7;
  // ONE net-profit formula (same as the week-in-review): online gross + wholesale margin
  // − ad spend − ShipBob − payment fees − wages.
  const online_np = gross_profit - total_ad_spend - n(r.shipbob_charges) - n(r.online_sales) * a.payment_fee_pct;
  const net_profit = online_np + wholesale_np - wages;
  return {
    sales_total: round2(sales_total),
    total_ad_spend: round2(total_ad_spend),
    blended_roas: total_ad_spend ? round2(sales_total / total_ad_spend) : null,
    mer: sales_total ? round2(total_ad_spend / sales_total) : null,
    gpm: n(r.online_sales) ? round2(gross_profit / n(r.online_sales)) : null,
    wholesale_np: round2(wholesale_np),
    online_np: round2(online_np),
    net_profit: round2(net_profit),
    npm: sales_total ? round2(net_profit / sales_total) : null,
    shipping_ratio: sales_total ? round2(n(r.shipbob_charges) / sales_total) : null,
    cr: r.cr != null ? n(r.cr) : null,
  };
}

export async function listWeeks(limit = 16) {
  const a = await getAssumptions();
  const { data } = await supabaseLogistics.from('sales_week').select('*').order('week_start', { ascending: false }).limit(limit);
  const rows = (data ?? []) as any[];
  return { assumptions: a, weeks: rows.map((r) => ({ ...r, derived: derive(r, a) })) };
}

// Every Monday of a year (ascending), joined with data; missing/future weeks are blank.
export async function getMasterYear(year: number) {
  const a = await getAssumptions();
  const start = `${year}-01-01`, end = `${year + 1}-01-01`;
  const { data } = await supabaseLogistics.from('sales_week').select('*').gte('week_start', start).lt('week_start', end);
  const byWk = new Map((data ?? []).map((r: any) => [r.week_start, r]));
  // first Monday on/after Jan 1
  const jan1 = new Date(`${year}-01-01T00:00:00`);
  const dow = jan1.getDay(); // 0 Sun..6 Sat
  const firstMon = new Date(jan1.getTime() + ((1 - dow + 7) % 7) * 86400_000);
  const weeks: any[] = [];
  for (let d = new Date(firstMon); d.getFullYear() === year; d = new Date(d.getTime() + 7 * 86400_000)) {
    const ws = d.toISOString().slice(0, 10);
    const r = byWk.get(ws);
    weeks.push(r ? { ...r, derived: derive(r, a) } : { week_start: ws, derived: {} });
  }
  // available years for tabs
  const { data: earliest } = await supabaseLogistics.from('sales_week').select('week_start').order('week_start', { ascending: true }).limit(1).maybeSingle();
  const minYear = earliest ? Number((earliest.week_start as string).slice(0, 4)) : year;
  const years: number[] = [];
  for (let y = new Date().getFullYear(); y >= minYear; y--) years.push(y);
  return { assumptions: a, weeks, year, years };
}
