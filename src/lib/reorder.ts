// Reorder recommendation engine — what to order, how much, per site.
import { supabaseLogistics } from './supabase-logistics';
import { POLICY } from './stock';

// supplier lead time (days) until stock lands at the destination
const LEAD_DAYS: Record<string, number> = { ALTONA: 30, MANCHESTER: 75 }; // ABC→Altona; AU→UK pallet

export interface Recommendation {
  product_id: string;
  sku: string;
  flavour: string | null;
  size: string;
  unit_size_g: number | null;
  tier: 'primary' | 'secondary';
  site: string;
  available: number;
  inbound: number;
  daily: number;            // avg daily units
  days_of_cover: number | null;
  recommend_units: number;  // rounded to carton multiple
  cartons: number | null;
  units_per_carton: number | null;
  reason: string;
}

function sizeLabel(g: number | null) { return g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`; }

export async function getReorderRecommendations(site = 'ALTONA'): Promise<Recommendation[]> {
  const [{ data: rows }, { data: products }] = await Promise.all([
    supabaseLogistics.from('v_stock_current')
      .select('product_id,sku,flavour,unit_size_g,tier,location_code,available,inbound,days_of_cover,avg_daily_units_30d,avg_daily_units_7d')
      .eq('active', true).eq('location_code', site),
    supabaseLogistics.from('products').select('id,units_per_carton'),
  ]);
  const upc = new Map((products ?? []).map((p: any) => [p.id, p.units_per_carton]));
  const lead = LEAD_DAYS[site] ?? 30;

  const recs: Recommendation[] = [];
  for (const r of (rows ?? []) as any[]) {
    const daily = Number(r.avg_daily_units_30d) || Number(r.avg_daily_units_7d) || 0;
    if (daily <= 0) continue; // no sales → no auto-recommend
    const tier = (r.tier as 'primary' | 'secondary');
    const target = POLICY[tier].targetDays;
    const safety = POLICY[tier].safetyDays;
    const covered = r.available + r.inbound;
    const coverDays = daily > 0 ? covered / daily : 999;
    // trigger if projected cover (incl inbound) runs below lead + safety
    if (coverDays >= lead + safety) continue;
    // order enough to reach lead + target days of cover
    const targetUnits = daily * (lead + target);
    let need = Math.max(0, Math.ceil(targetUnits - covered));
    const carton = upc.get(r.product_id) || null;
    let cartons: number | null = null;
    if (carton && carton > 0) { cartons = Math.ceil(need / carton); need = cartons * carton; }
    if (need <= 0) continue;
    recs.push({
      product_id: r.product_id, sku: r.sku, flavour: r.flavour, size: sizeLabel(r.unit_size_g),
      unit_size_g: r.unit_size_g, tier, site, available: r.available, inbound: r.inbound,
      daily: +daily.toFixed(2), days_of_cover: r.days_of_cover,
      recommend_units: need, cartons, units_per_carton: carton,
      reason: r.inbound > 0
        ? `${Math.round(coverDays)}d cover incl. ${r.inbound} inbound; below ${lead + safety}d lead+safety`
        : `${r.days_of_cover ?? 0}d cover; ${lead}d lead time`,
    });
  }
  // primary first, then most urgent (lowest cover)
  recs.sort((a, b) =>
    (a.tier === b.tier ? 0 : a.tier === 'primary' ? -1 : 1) ||
    (a.days_of_cover ?? 999) - (b.days_of_cover ?? 999));
  return recs;
}
