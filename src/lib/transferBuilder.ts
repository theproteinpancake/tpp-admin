// Suggests + creates internal stock-transfer drafts (e.g. Altona AU → Manchester UK)
// using live per-SKU velocity. Trigger: place the transfer ~90 days before sellout;
// top the destination up to ~180 days of cover, capped by what the origin can spare.
import { supabaseLogistics } from './supabase-logistics';

export const TRIGGER_DAYS = 90;   // build a transfer when destination cover falls below this
export const TARGET_DAYS = 180;   // restock up to this many days of cover
const UK_FALLBACK_FRACTION = 0.2; // if a SKU has no destination velocity yet, assume 20% of origin's rate
const CARTON_ROUND = 12;          // round suggestions to whole cartons

const HS_BY_CATEGORY: Record<string, { hs: string; coo: string }> = {
  mix: { hs: '1901200000', coo: 'AU' },
  syrup: { hs: '2106909285', coo: 'AU' },
  accessory: { hs: '4419900000', coo: 'CN' },
};

export interface RestockLine {
  product_id: string; sku: string; flavour: string | null; size: string; category: string;
  available: number; inbound: number; daily: number; days_cover: number | null;
  origin_available: number; suggested: number; unit_value: number | null; reason: string;
}
export interface RestockSuggestion {
  origin: string; destination: string; lines: RestockLine[];
  total_units: number; total_value: number; trigger_days: number; target_days: number;
}

const sizeLabel = (g: number | null) => (g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`);
const roundCarton = (n: number) => Math.round(n / CARTON_ROUND) * CARTON_ROUND;

export async function suggestRestock(destination = 'MANCHESTER', origin = 'ALTONA'): Promise<RestockSuggestion> {
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
  const lines: RestockLine[] = [];

  for (const r of (destRows ?? []) as any[]) {
    if (r.category !== 'mix') continue; // transfers are finished mix product
    const o = orig.get(r.product_id);
    const originAvail = o?.available ?? 0;
    if (originAvail <= 0) continue; // can't send what Altona doesn't have

    const destDaily = Number(r.avg_daily_units_30d) || Number(r.avg_daily_units_90d) || 0;
    const origDaily = o ? Number(o.avg_daily_units_30d) || Number(o.avg_daily_units_90d) || 0 : 0;
    const daily = destDaily > 0 ? destDaily : origDaily * UK_FALLBACK_FRACTION;
    if (daily <= 0) continue; // no demand signal at all → skip

    const coverUnits = (r.available ?? 0) + (r.inbound ?? 0);
    const daysCover = coverUnits / daily;
    if (daysCover >= TRIGGER_DAYS) continue; // not due yet

    let suggested = roundCarton(Math.max(0, TARGET_DAYS * daily - coverUnits));
    suggested = Math.min(suggested, roundCarton(originAvail));
    if (suggested < CARTON_ROUND) continue;

    lines.push({
      product_id: r.product_id, sku: r.sku, flavour: r.flavour, size: sizeLabel(r.unit_size_g),
      category: r.category, available: r.available ?? 0, inbound: r.inbound ?? 0,
      daily: Math.round(daily * 10) / 10, days_cover: Math.round(daysCover),
      origin_available: originAvail, suggested, unit_value: cogs.get(r.product_id) ?? null,
      reason: `${destination} ${coverUnits} on hand/inbound · ~${(Math.round(daily * 10) / 10)}/day · ${Math.round(daysCover)}d cover${destDaily > 0 ? '' : ' (est. from AU)'}`,
    });
  }

  lines.sort((a, b) => (a.days_cover ?? 0) - (b.days_cover ?? 0));
  const total_units = lines.reduce((s, l) => s + l.suggested, 0);
  const total_value = Math.round(lines.reduce((s, l) => s + l.suggested * (l.unit_value ?? 0), 0) * 100) / 100;
  return { origin, destination, lines, total_units, total_value, trigger_days: TRIGGER_DAYS, target_days: TARGET_DAYS };
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
    currency: 'AUD', total_value: s.total_value, cartons: Math.round(s.total_units / CARTON_ROUND),
    notes: `Auto-built ${s.origin}→${s.destination} restock to ~${s.target_days}d cover. Pick the LONGEST-dated stock so the UK holds maximum shelf life.`,
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
