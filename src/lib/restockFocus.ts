// The daily "restock focus": ONE ranked list across EVERY SKU class we watch — finished goods
// (mix/syrup/accessories, both sites), ABC pouches + SRP cartons, ShipBob shipping cartons and
// insert cards (both sites).
//
// Luke's brief (Aug 2026): "keep up with every SKU possible in the most minimal amount of
// messaging — so I can focus on restocking 1-3 SKUs at a time." So this returns AT MOST THREE
// items, most urgent first, and a count of what else is flagged but not shown. The rest surface
// on later days as the top ones get fixed. It rides the existing 9am brief as one short message
// — never its own notification stream.
import { supabaseLogistics } from './supabase-logistics';
import { getPouchTracking, getShipperTracking } from './packaging';

export interface FocusItem {
  label: string;      // what + where, e.g. "Maple Syrup single (MSS) — Altona"
  state: string;      // the number that matters, e.g. "0 left, selling 3.6/day"
  action: string;     // the one next step, e.g. "order from Pakco (60d lead)"
  score: number;      // pseudo days-to-trouble; lower = more urgent
  daily?: number;     // tiebreak: at equal urgency, the faster seller matters more
}

const CATEGORY_ACTION: Record<string, string> = {
  mix: 'draft an ABC PO',
  syrup: 'order from the syrup supplier (long lead — 60d)',
  accessory: 'reorder from the accessories supplier (60d lead)',
};

export async function getRestockFocus(): Promise<{ items: FocusItem[]; more: number }> {
  const candidates: FocusItem[] = [];

  // 1) Finished goods at both sites. 80g stays opt-in (Luke's standing rule); inactive skipped.
  const { data: stock } = await supabaseLogistics.from('v_stock_current')
    .select('sku, name, flavour, unit_size_g, category, location_code, available, inbound, avg_daily_units_30d, avg_daily_units_90d')
    .eq('active', true);
  for (const r of (stock ?? []) as any[]) {
    if (Number(r.unit_size_g) === 80) continue;
    const daily = Math.max(Number(r.avg_daily_units_30d) || 0, Number(r.avg_daily_units_90d) || 0);
    if (daily <= 0.05) continue;                    // not moving — nothing to keep up with
    const avail = Number(r.available) || 0;
    const inbound = Number(r.inbound) || 0;
    const cover = avail / daily;
    // Inbound softens urgency but doesn't clear it — a delayed ABC run is exactly how Luke
    // keeps selling out, so inbound-covered SKUs still rank, just later.
    const score = cover + (inbound > 0 ? 21 : 0);
    if (cover > 21) continue;
    const where = r.location_code === 'MANCHESTER' ? 'UK' : 'AU';
    candidates.push({
      label: `${r.flavour ? `${r.flavour} ${r.unit_size_g >= 1000 ? `${r.unit_size_g / 1000}kg` : `${r.unit_size_g}g`}` : r.name} (${r.sku}) — ${where}`,
      state: avail <= 0
        ? `OUT OF STOCK, selling ${daily.toFixed(1)}/day${inbound ? `, ${inbound} inbound` : ', nothing inbound'}`
        : `${avail} left ≈ ${Math.round(cover)} days${inbound ? `, ${inbound} inbound` : ''}`,
      action: CATEGORY_ACTION[r.category] || 'reorder',
      score, daily,
    });
  }

  // 2) ABC empty pouches (order_now = inside the China lead time).
  try {
    const pouches = await getPouchTracking();
    for (const p of pouches) {
      if (p.status !== 'order_now' || p.days_cover == null) continue;
      candidates.push({
        label: `${p.flavour} ${p.size} EMPTY POUCHES — ABC`,
        state: `${p.remaining} left ≈ ${p.days_cover} days packing`,
        action: 'order pouches from China Packaging (60d lead)',
        score: Number(p.days_cover),
      });
    }
  } catch { /* pouch view is best-effort here */ }

  // 3) ShipBob cartons + insert cards, both sites (live levels).
  try {
    const ship = await getShipperTracking();
    for (const s of ship) {
      if (s.status !== 'order_now' || s.fulfillable == null) continue;
      const rp = s.reorder_point || 1;
      candidates.push({
        label: `${s.name}${s.site === 'MANCHESTER' ? '' : ''}`,
        state: s.fulfillable <= 0 ? 'OUT — orders ship without it' : `${s.fulfillable} left (reorder at ${rp})`,
        // Cards come from the printer; boxes from VISY (AU) / CBS (UK).
        action: s.type === 'insert' ? 'reorder cards from the printer' : s.site === 'MANCHESTER' ? 'reorder boxes via CBS Packaging' : 'order from VISY (21d lead)',
        score: (s.fulfillable / rp) * 10,   // 0 stock → 0; at reorder point → 10 pseudo-days
      });
    }
  } catch { /* shipper view is best-effort here */ }

  candidates.sort((a, b) => a.score - b.score || (b.daily || 0) - (a.daily || 0));
  return { items: candidates.slice(0, 3), more: Math.max(0, candidates.length - 3) };
}

/** One compact WhatsApp block, or null when nothing needs restocking. */
export function focusText(f: { items: FocusItem[]; more: number }): string | null {
  if (!f.items.length) return null;
  return [
    `🎯 *Restock focus today*`,
    ...f.items.map((i, n) => `${n + 1}. *${i.label}* — ${i.state} → ${i.action}`),
    ...(f.more > 0 ? [`(+${f.more} more flagged — they'll surface as these clear)`] : []),
  ].join('\n');
}
