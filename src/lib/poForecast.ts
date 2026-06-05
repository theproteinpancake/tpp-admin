// 3-month rolling ABC purchase-order schedule. For each Altona mix SKU, projects the
// date you must PLACE the order (so it lands before safety stock, given ABC's lead time)
// and buckets it by month — "what to order, and when" over the next ~90 days.
import { supabaseLogistics } from './supabase-logistics';
import { POLICY } from './stock';

const LEAD_DAYS = 30;     // ABC → Altona
const HORIZON_DAYS = 95;  // ~3 months

const sizeLabel = (g: number | null) => (g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`);

export interface ForecastItem {
  product_id: string; sku: string; flavour: string | null; size: string; tier: 'primary' | 'secondary';
  units: number; cartons: number | null; cover_days: number; order_by: string; days_until: number;
}
export interface ForecastMonth { key: string; label: string; items: ForecastItem[]; units: number; }

export async function getPoForecast(site = 'ALTONA', nowMs?: number): Promise<{ months: ForecastMonth[]; horizon_days: number }> {
  const [{ data: rows }, { data: products }] = await Promise.all([
    supabaseLogistics.from('v_stock_current')
      .select('product_id,sku,flavour,unit_size_g,tier,category,available,inbound,avg_daily_units_30d,avg_daily_units_90d')
      .eq('active', true).eq('location_code', site),
    supabaseLogistics.from('products').select('id,units_per_carton'),
  ]);
  const upc = new Map((products ?? []).map((p: any) => [p.id, p.units_per_carton]));
  const now = nowMs ?? Date.now();
  const items: ForecastItem[] = [];

  for (const r of (rows ?? []) as any[]) {
    if (r.category !== 'mix') continue; // ABC produces the mix range
    const daily = Number(r.avg_daily_units_30d) || Number(r.avg_daily_units_90d) || 0;
    if (daily <= 0) continue;
    const tier = (r.tier as 'primary' | 'secondary') || 'secondary';
    const target = POLICY[tier].targetDays;
    const safety = POLICY[tier].safetyDays;
    const covered = (r.available ?? 0) + (r.inbound ?? 0);
    const coverDays = covered / daily;
    // place the order this many days from now so stock arrives before it dips below safety
    const orderByDays = Math.max(0, Math.round(coverDays - safety - LEAD_DAYS));
    if (orderByDays > HORIZON_DAYS) continue;
    // order enough to reach lead + target cover
    let units = Math.max(0, Math.ceil(daily * (LEAD_DAYS + target) - covered));
    const carton = upc.get(r.product_id) || null;
    let cartons: number | null = null;
    if (carton && carton > 0) { cartons = Math.ceil(units / carton); units = cartons * carton; }
    if (units <= 0) continue;
    const orderBy = new Date(now + orderByDays * 86400_000).toISOString().slice(0, 10);
    items.push({
      product_id: r.product_id, sku: r.sku, flavour: r.flavour, size: sizeLabel(r.unit_size_g),
      tier, units, cartons, cover_days: Math.round(coverDays), order_by: orderBy, days_until: orderByDays,
    });
  }

  const byMonth = new Map<string, ForecastItem[]>();
  for (const it of items) {
    const k = it.order_by.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push(it);
  }
  const months: ForecastMonth[] = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, its]) => ({
    key,
    label: new Date(key + '-01T00:00:00').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }),
    items: its.sort((a, b) => a.days_until - b.days_until || (a.flavour ?? '').localeCompare(b.flavour ?? '')),
    units: its.reduce((s, i) => s + i.units, 0),
  }));
  return { months, horizon_days: HORIZON_DAYS };
}
