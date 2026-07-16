// ABC purchase-order builder. Orders are placed ONE FLAVOUR at a time and total a
// multiple of 500kg of product, split across that flavour's sizes by live demand.
// 320g bags are wholesale, packed in Shelf-Ready Cartons of 4 — PO is in total units,
// but ShipBob counts them as cartons (units ÷ 4).
import { supabaseLogistics } from './supabase-logistics';

const LEAD_DAYS = 30;          // ABC → Altona
const TARGET_TOTAL_DAYS = 90;  // aim to cover ~3 months (incl. lead) of demand
const TRIGGER_DAYS = 45;       // a size is "due" below this cover
const BATCH_KG = 500;          // orders round to multiples of this

export const cartonSize = (g: number) => (g === 320 ? 4 : 1); // 320g wholesale = box of 4
const bagKg = (g: number) => g / 1000;
const sizeLabel = (g: number) => (g >= 1000 ? `${g / 1000}kg` : `${g}g`);

export interface POLine {
  product_id: string; sku: string; size: string; unit_size_g: number;
  units: number; cartons: number | null; kg: number;
}
export interface FlavourProposal {
  flavour: string; order_kg: number; total_units: number; total_kg: number;
  lines: POLine[]; due: boolean; reason: string;
}

function buildProposal(flavour: string, sizes: any[], force: boolean, forceKg?: number): FlavourProposal | null {
  let totalDeficitKg = 0;
  let due = false;
  const needs = sizes.map((s) => {
    // UNITS TRAP: for 320g SKUs, ShipBob tracks the 4-pack CARTON — so the snapshot
    // 'available' and the shipment-derived velocity arrive in CARTONS, while POs and the
    // blend-kg math here run in POUCHES. Convert both (inbound comes from po_items and is
    // already pouches). Unconverted, BMS demand was 4× understated: a 1T Buttermilk split
    // allocated 84 pouches (27kg) where real velocity supports ~300.
    const csu = cartonSize(s.unit_size_g);
    const daily = (Number(s.avg_daily_units_30d) || Number(s.avg_daily_units_90d) || 0) * csu;
    const covered = (s.available || 0) * csu + (s.inbound || 0);
    const cover = daily > 0 ? covered / daily : 999;
    if (cover < TRIGGER_DAYS) due = true;
    const deficitUnits = Math.max(0, daily * TARGET_TOTAL_DAYS - covered);
    const deficitKg = deficitUnits * bagKg(s.unit_size_g);
    totalDeficitKg += deficitKg;
    return { ...s, daily, deficitKg };
  });
  if (!due && !force) return null;

  // weight the split by each size's demand: deficit if any, else its velocity (so a
  // forced order still splits sensibly across the sizes that actually sell)
  let weights = needs.map((n) => n.deficitKg);
  if (weights.every((w) => w <= 0)) weights = needs.map((n) => n.daily * bagKg(n.unit_size_g));
  const wTotal = weights.reduce((a, b) => a + b, 0) || 1;

  // honour an explicit size if the user asked for one (e.g. "500kg"); else round the
  // demand deficit up to the next clean 500kg multiple.
  const order_kg = forceKg && forceKg > 0
    ? forceKg
    : Math.max(BATCH_KG, Math.ceil((totalDeficitKg || BATCH_KG) / BATCH_KG) * BATCH_KG);
  const forced = !!(forceKg && forceKg > 0);
  const lines: POLine[] = [];
  needs.forEach((n, i) => {
    const share = weights[i] / wTotal;
    if (share <= 0) return;
    const kg = order_kg * share;
    const cs = cartonSize(n.unit_size_g);
    let units = Math.round(kg / bagKg(n.unit_size_g));
    if (cs > 1) units = Math.max(cs, Math.round(units / cs) * cs); // 320g → whole cartons of 4
    if (units <= 0) return;
    lines.push({
      product_id: n.product_id, sku: n.sku, size: sizeLabel(n.unit_size_g), unit_size_g: n.unit_size_g,
      units, cartons: cs > 1 ? units / cs : null, kg: Math.round(units * bagKg(n.unit_size_g)),
    });
  });
  if (!lines.length) return null;
  const total_units = lines.reduce((a, l) => a + l.units, 0);
  const total_kg = lines.reduce((a, l) => a + l.kg, 0);
  return {
    flavour, order_kg, total_units, total_kg, lines, due,
    reason: forced
      ? `${order_kg}kg order (your specified size), split across sizes by demand`
      : `~${Math.round(totalDeficitKg)}kg demand to ${TARGET_TOTAL_DAYS}-day cover → ${order_kg}kg order`,
  };
}

async function flavourSizes(site: string) {
  const { data } = await supabaseLogistics.from('v_stock_current')
    .select('product_id,sku,flavour,unit_size_g,available,inbound,avg_daily_units_30d,avg_daily_units_90d,days_of_cover')
    .eq('active', true).eq('location_code', site).eq('category', 'mix');
  const byFlavour = new Map<string, any[]>();
  for (const r of (data ?? []) as any[]) {
    if (!r.flavour) continue;
    if (!byFlavour.has(r.flavour)) byFlavour.set(r.flavour, []);
    byFlavour.get(r.flavour)!.push(r);
  }
  return byFlavour;
}

// All flavours currently due, as 500kg-rounded per-flavour PO proposals.
export async function proposeFlavourPOs(site = 'ALTONA'): Promise<FlavourProposal[]> {
  const byFlavour = await flavourSizes(site);
  const out: FlavourProposal[] = [];
  for (const [flavour, sizes] of byFlavour) {
    const p = buildProposal(flavour, sizes, false);
    if (p) out.push(p);
  }
  return out.sort((a, b) => b.total_kg - a.total_kg);
}

// A specific flavour on demand (even if not strictly "due") — for "draft a Buttermilk PO".
// Pass orderKg to pin an exact size (e.g. 500) instead of auto-rounding to demand.
export async function proposeOneFlavour(flavour: string, site = 'ALTONA', orderKg?: number): Promise<FlavourProposal | null> {
  const byFlavour = await flavourSizes(site);
  const key = [...byFlavour.keys()].find((f) => f.toLowerCase() === flavour.toLowerCase().trim());
  if (!key) return null;
  return buildProposal(key, byFlavour.get(key)!, true, orderKg);
}
