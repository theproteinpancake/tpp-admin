// Sales & Data Master — weekly analytics. Auto-fills the API-owned fields (Shopify online
// sales/orders/AOV/shipping + regional, ShipBob fulfilment charges, Xero wholesale invoices)
// and computes the derived profit metrics. Ad-platform fields stay manual until Meta/Google
// APIs are wired (Phase 2).
import { supabaseLogistics } from './supabase-logistics';
import { fetchMetaWeek, metaConfigured } from './meta';

const SHOP = process.env.SHOPIFY_STORE_DOMAIN || 'theproteinpancake.myshopify.com';
const SHOP_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
const API = '2024-10';

export interface Assumptions { wholesale_margin: number; online_cogs_pct: number; payment_fee_pct: number; fx_gbp_aud: number; weekly_target_sales: number; weekly_target_np: number; employees: number; }
const DEFAULT_ASSUMPTIONS: Assumptions = { wholesale_margin: 0.38, online_cogs_pct: 0.40, payment_fee_pct: 0.03, fx_gbp_aud: 1.95, weekly_target_sales: 40000, weekly_target_np: 4000, employees: 4 };

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
async function shopifyOrders(startIso: string, endIso: string) {
  if (!SHOP_TOKEN) return null;
  const base = `https://${SHOP}/admin/api/${API}/orders.json`;
  let url = `${base}?status=any&financial_status=paid&created_at_min=${startIso}T00:00:00Z&created_at_max=${endIso}T00:00:00Z&limit=250&fields=id,total_price,subtotal_price,total_discounts,shipping_lines,shipping_address,created_at`;
  const orders: any[] = [];
  for (let i = 0; i < 20 && url; i++) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': SHOP_TOKEN } });
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
    supabaseLogistics.from('sales_week').select('locked').eq('week_start', weekStart).maybeSingle(),
  ]);
  const locked: string[] = (existing.data?.locked as string[]) || [];
  const row: Record<string, unknown> = { week_start: weekStart, auto_filled_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const set = (k: string, v: unknown) => { if (v != null && !locked.includes(k)) row[k] = v; };
  if (shop && !shop._err) {
    set('online_sales', shop.online_sales); set('orders', shop.orders); set('aov', shop.aov);
    set('shipping_charged', shop.shipping_charged);
    set('orders_nz', shop.orders_nz); set('nz_aov', shop.nz_aov); set('orders_uk', shop.orders_uk); set('uk_aov', shop.uk_aov);
    set('gross_profit', round2(shop.online_sales * (1 - a.online_cogs_pct)));
  }
  if (sb != null) set('shipbob_charges', sb);
  if (wh != null) set('wholesale_invoices', wh);
  if (meta && !meta._err) {
    set('meta_spend', meta.spend); set('meta_roas', meta.roas); set('meta_purchases', meta.purchases); set('meta_cpa', meta.cpa);
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
  const online_np = gross_profit - total_ad_spend - n(r.shipbob_charges) - n(r.online_sales) * a.payment_fee_pct;
  const net_profit = online_np + wholesale_np;
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
