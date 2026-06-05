// Suggests + creates internal stock-transfer drafts (e.g. Altona AU → Manchester UK)
// using live per-SKU velocity. Trigger: place the transfer ~90 days before sellout;
// top the destination up to ~180 days of cover, capped by what the origin can spare.
import { supabaseLogistics } from './supabase-logistics';

export const TRIGGER_DAYS = 90;   // build a transfer when destination cover falls below this
export const TARGET_DAYS = 180;   // restock up to this many days of cover
const UK_FALLBACK_FRACTION = 0.2; // if a SKU has no destination velocity yet, assume 20% of origin's rate

// UK roll-out strategy (2026-06): UK transfers are 520g MEDIUM bags only (simplest to
// ship). 320g = AU wholesale only; 1kg dropped from UK. Syrup/accessories are added
// manually as the odd extra, not auto-built.
const UK_SIZE_G = 520;

// Export shipping cartons: units per carton (ABC carton specs).
const SHIP_CARTON: Record<number, number> = { 520: 12, 1000: 8 };
const cartonUnits = (g: number) => SHIP_CARTON[g] ?? 12;

// Pallet capacity for 520g cartons (23×23×33cm): 15 cases/layer × 5 layers = 75 cases
// = 900 units (~468 kg product, ~530 kg gross) at ~134cm. A 6th layer (~1,080 units)
// is possible if the carrier allows ~155-160cm — confirm weight with Maersk first.
// Override via env if needed.
export const CARTONS_PER_PALLET = Number(process.env.CARTONS_PER_PALLET) || 75;
export const MAX_KG_PER_PALLET = Number(process.env.MAX_KG_PER_PALLET) || 480;

const HS_BY_CATEGORY: Record<string, { hs: string; coo: string }> = {
  mix: { hs: '1901200000', coo: 'AU' },
  syrup: { hs: '2106909285', coo: 'AU' },
  accessory: { hs: '4419900000', coo: 'CN' },
};

export interface RestockLine {
  product_id: string; sku: string; flavour: string | null; size: string; unit_size_g: number; category: string;
  available: number; inbound: number; daily: number; days_cover: number | null;
  origin_available: number; suggested: number; cartons: number; unit_value: number | null; reason: string;
}
export interface RestockSuggestion {
  origin: string; destination: string; lines: RestockLine[];
  total_units: number; total_value: number; cartons: number; pallets: number;
  cartons_per_pallet: number; total_kg: number; trigger_days: number; target_days: number;
}

const sizeLabel = (g: number | null) => (g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`);

// Build a UK restock that (1) covers demand to target cover, then (2) MAXIMISES the
// pallet(s) by topping up best sellers (by velocity), even ones already inbound.
// 320g bags are excluded (AU wholesale only). opts.pallets forces a pallet count.
export async function suggestRestock(
  destination = 'MANCHESTER', origin = 'ALTONA', opts: { pallets?: number } = {},
): Promise<RestockSuggestion> {
  const [{ data: destRows }, { data: origRows }, { data: products }] = await Promise.all([
    supabaseLogistics.from('v_stock_current')
      .select('product_id,sku,flavour,unit_size_g,category,available,inbound,avg_daily_units_30d,avg_daily_units_90d,days_of_cover')
      .eq('location_code', destination).eq('active', true),
    supabaseLogistics.from('v_stock_current')
      .select('product_id,available,avg_daily_units_30d,avg_daily_units_90d')
      .eq('location_code', origin).eq('active', true),
    supabaseLogistics.from('products').select('id,cogs'),
  ]);

  const orig = new Map((origRows ?? []).map((r: any) => [r.product_id, r]));
  const cogs = new Map((products ?? []).map((p: any) => [p.id, p.cogs]));

  interface Cand {
    r: any; cu: number; daily: number; destDaily: number; coverUnits: number;
    daysCover: number; originAvail: number; allocated: number;
  }
  const cands: Cand[] = [];
  for (const r of (destRows ?? []) as any[]) {
    if (r.category !== 'mix') continue;       // auto-build is finished mix product
    if (r.unit_size_g !== UK_SIZE_G) continue; // UK = 520g medium bags only (no 320g/1kg)
    const o = orig.get(r.product_id);
    const originAvail = o?.available ?? 0;
    if (originAvail <= 0) continue;           // can't send what Altona doesn't have

    const destDaily = Number(r.avg_daily_units_30d) || Number(r.avg_daily_units_90d) || 0;
    const origDaily = o ? Number(o.avg_daily_units_30d) || Number(o.avg_daily_units_90d) || 0 : 0;
    const daily = destDaily > 0 ? destDaily : origDaily * UK_FALLBACK_FRACTION;
    if (daily <= 0) continue;                 // no demand signal at all → skip

    const cu = cartonUnits(r.unit_size_g);
    const coverUnits = (r.available ?? 0) + (r.inbound ?? 0);
    cands.push({ r, cu, daily, destDaily, coverUnits, daysCover: coverUnits / daily, originAvail, allocated: 0 });
  }

  // helpers (carton-rounded, origin-capped)
  const roomUnits = (c: Cand) => Math.floor(c.originAvail / c.cu) * c.cu - c.allocated;
  const cartonsUsed = () => cands.reduce((s, c) => s + c.allocated / c.cu, 0);
  const kgUsed = () => cands.reduce((s, c) => s + c.allocated * (c.r.unit_size_g / 1000), 0);

  // Pass A — cover demand to TARGET_DAYS (capped by Altona stock)
  for (const c of cands) {
    const need = Math.max(0, TARGET_DAYS * c.daily - c.coverUnits);
    c.allocated = Math.min(Math.round(need / c.cu) * c.cu, Math.floor(c.originAvail / c.cu) * c.cu);
  }

  // capacity: at least 1 pallet, or enough pallets to hold the cover, or what's requested
  const needCartons = Math.ceil(cartonsUsed());
  const pallets = Math.max(opts.pallets ?? 1, Math.ceil(needCartons / CARTONS_PER_PALLET) || 1);
  const capCartons = pallets * CARTONS_PER_PALLET;
  const capKg = pallets * MAX_KG_PER_PALLET;

  // Pass B — fill remaining pallet space with best sellers (velocity-weighted),
  // including ones already covered by inbound. Stops on carton OR weight cap, or
  // when no origin stock remains.
  let guard = 0;
  while (cartonsUsed() < capCartons - 1e-6 && guard < 100000) {
    guard++;
    let pick: Cand | null = null; let best = -1;
    for (const c of cands) {
      if (roomUnits(c) < c.cu) continue;
      if (kgUsed() + c.cu * (c.r.unit_size_g / 1000) > capKg) continue;
      const score = c.daily / (1 + c.allocated / c.cu); // favour best sellers, decay as added
      if (score > best) { best = score; pick = c; }
    }
    if (!pick) break;
    pick.allocated += pick.cu;
  }

  const lines: RestockLine[] = cands.filter((c) => c.allocated > 0).map((c) => {
    const covered = TARGET_DAYS * c.daily - c.coverUnits <= 0;
    return {
      product_id: c.r.product_id, sku: c.r.sku, flavour: c.r.flavour, size: sizeLabel(c.r.unit_size_g),
      unit_size_g: c.r.unit_size_g, category: c.r.category, available: c.r.available ?? 0, inbound: c.r.inbound ?? 0,
      daily: Math.round(c.daily * 10) / 10, days_cover: Math.round(c.daysCover),
      origin_available: c.originAvail, suggested: c.allocated, cartons: c.allocated / c.cu,
      unit_value: cogs.get(c.r.product_id) ?? null,
      reason: `UK ${c.coverUnits} on hand/inbound · ~${Math.round(c.daily * 10) / 10}/day · ${Math.round(c.daysCover)}d cover${c.destDaily > 0 ? '' : ' (est. from AU)'}${covered ? ' · best-seller top-up' : ''}`,
    };
  });

  // best sellers first, then most-urgent cover
  lines.sort((a, b) => b.daily - a.daily || (a.days_cover ?? 0) - (b.days_cover ?? 0));
  const total_units = lines.reduce((s, l) => s + l.suggested, 0);
  const total_value = Math.round(lines.reduce((s, l) => s + l.suggested * (l.unit_value ?? 0), 0) * 100) / 100;
  const total_kg = Math.round(lines.reduce((s, l) => s + l.suggested * (l.unit_size_g / 1000), 0));
  const cartons = Math.round(lines.reduce((s, l) => s + l.cartons, 0));
  return {
    origin, destination, lines, total_units, total_value, cartons, pallets,
    cartons_per_pallet: CARTONS_PER_PALLET, total_kg, trigger_days: TRIGGER_DAYS, target_days: TARGET_DAYS,
  };
}

async function nextReference(): Promise<string> {
  const { data } = await supabaseLogistics.from('internal_transfers').select('reference');
  let max = 0;
  for (const r of (data ?? []) as any[]) {
    const m = /^INTERNAL(\d+)$/.exec(r.reference || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `INTERNAL${max + 1}`;
}

// Create a DRAFT transfer from a suggestion (or an explicit set of lines). Not committed/sent.
export async function createDraftTransfer(s: RestockSuggestion): Promise<{ reference: string; units: number; value: number } | { error: string }> {
  if (!s.lines.length) return { error: 'Nothing to restock — destination is within target cover.' };
  const [{ data: locs }] = await Promise.all([
    supabaseLogistics.from('locations').select('id,code').in('code', [s.origin, s.destination]),
  ]);
  const originId = (locs ?? []).find((l: any) => l.code === s.origin)?.id;
  const destId = (locs ?? []).find((l: any) => l.code === s.destination)?.id;
  const reference = await nextReference();

  const { data: t, error } = await supabaseLogistics.from('internal_transfers').insert({
    reference, origin_location_id: originId, destination_location_id: destId, status: 'draft',
    currency: 'AUD', total_value: s.total_value, cartons: s.cartons,
    notes: `Auto-built ${s.origin}→${s.destination} restock: cover to ~${s.target_days}d + best-seller top-up, maximising ${s.pallets} pallet(s) (${s.cartons} cartons / ~${s.total_kg}kg). 520g medium bags only (75 cartons = 900 units/pallet). Add syrup/accessories manually if needed. Pick the LONGEST-dated stock so the UK holds maximum shelf life.`,
  }).select('id').single();
  if (error || !t) return { error: error?.message || 'Failed to create transfer' };

  const items = s.lines.map((l) => {
    const meta = HS_BY_CATEGORY[l.category] || HS_BY_CATEGORY.mix;
    return { transfer_id: t.id, product_id: l.product_id, qty: l.suggested, unit_value: l.unit_value, hs_code: meta.hs, coo: meta.coo };
  });
  const { error: ie } = await supabaseLogistics.from('internal_transfer_items').insert(items);
  if (ie) return { error: ie.message };
  return { reference, units: s.total_units, value: s.total_value };
}
