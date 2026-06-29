// ShipBob side of an AU→UK pallet transfer: a B2B order out of Altona to the Manchester FC,
// received by a Manchester WRO. UK stock sits ~2.5 months at sea, so we deliberately pick the
// LONGEST-dated lots (avoid short best-befores), preferring a single lot that covers the qty.
// This module is PREVIEW-ONLY for now — it computes the plan + lot allocation, creates nothing.
import { supabaseLogistics } from './supabase-logistics';
import { getTransfer, transferUnits } from './transfers';
import { IMPORTER } from './transferConstants';
import { createWRO, getWROLabels } from './shipbob';

const FC_ID: Record<string, number> = { ALTONA: 28, MANCHESTER: 32 };
// UK transit is ~75 days; flag any chosen lot expiring within ~5 months as too short for the journey.
const SHORT_DATE_DAYS = 150;

export interface LotPick { lot_number: string; expiration_date: string; qty: number; short: boolean }
export interface TransferLinePlan {
  sku: string; label: string; needed: number; allocated: number;
  lots: LotPick[]; shortfall: number; warnings: string[];
}

interface RawLot { lot_number: string; expiration_date: string; qty: number }

// Pull a SKU's lots at one FC from ShipBob, newest-best-before first.
async function lotsForInventory(site: string, inventoryId: number): Promise<RawLot[]> {
  const token = process.env[site === 'MANCHESTER' ? 'SHIPBOB_API_TOKEN_UK' : 'SHIPBOB_API_TOKEN'];
  if (!token) return [];
  const fc = FC_ID[site];
  const res = await fetch(`https://api.shipbob.com/1.0/inventory/${inventoryId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const inv = await res.json();
  const out: RawLot[] = [];
  for (const l of (inv.fulfillable_quantity_by_lot ?? []) as any[]) {
    if (!l.lot_number || !l.expiration_date) continue;
    const atFc = (l.fulfillable_quantity_by_fulfillment_center ?? []).find((f: any) => f.id === fc);
    const qty = Number(atFc?.fulfillable_quantity ?? l.fulfillable_quantity) || 0;
    if (qty > 0) out.push({ lot_number: l.lot_number, expiration_date: String(l.expiration_date).slice(0, 10), qty });
  }
  return out.sort((a, b) => b.expiration_date.localeCompare(a.expiration_date)); // longest date first
}

// Choose lots for `needed` units: prefer ONE lot (longest-dated) that covers it; else take from
// the longest-dated lots in turn. Flags short-dated picks + any shortfall.
function selectLots(lots: RawLot[], needed: number): { lots: LotPick[]; allocated: number; shortfall: number } {
  const today = new Date().toISOString().slice(0, 10);
  const shortCutoff = new Date(Date.now() + SHORT_DATE_DAYS * 864e5).toISOString().slice(0, 10);
  const mark = (l: RawLot, qty: number): LotPick => ({ lot_number: l.lot_number, expiration_date: l.expiration_date, qty, short: l.expiration_date < shortCutoff });

  // 1) single lot that covers it → the longest-dated such lot (lots already sorted desc)
  const single = lots.find((l) => l.qty >= needed && l.expiration_date >= today);
  if (single) return { lots: [mark(single, needed)], allocated: needed, shortfall: 0 };

  // 2) otherwise greedily fill from the longest-dated lots
  const picks: LotPick[] = [];
  let remaining = needed;
  for (const l of lots) {
    if (remaining <= 0) break;
    const take = Math.min(l.qty, remaining);
    picks.push(mark(l, take));
    remaining -= take;
  }
  return { lots: picks, allocated: needed - remaining, shortfall: Math.max(0, remaining) };
}

// Lightweight up-front date check for a PROPOSED manifest (used at draft time so short-dated
// SKUs are caught before the transfer + CI are created). Per SKU: the best (longest) best-before
// available for the qty, whether the best available is still short-dated, and any shortfall.
export async function lotDateCheck(lines: { sku: string; units: number }[]): Promise<Record<string, { best_before: string | null; short: boolean; shortfall: number }>> {
  const { data: pls } = await supabaseLogistics.from('product_locations')
    .select('shipbob_inventory_id, active, products(sku), location:location_id(code)');
  const invBy = (sku: string) => (pls ?? []).find((p: any) => p.products?.sku === sku && (p.location?.code || '').toUpperCase() === 'ALTONA' && p.active)?.shipbob_inventory_id;
  const out: Record<string, { best_before: string | null; short: boolean; shortfall: number }> = {};
  for (const l of lines) {
    const inv = invBy(l.sku);
    if (!inv) { out[l.sku] = { best_before: null, short: false, shortfall: l.units }; continue; }
    const lots = await lotsForInventory('ALTONA', Number(inv));
    const sel = selectLots(lots, l.units);
    out[l.sku] = { best_before: sel.lots[0]?.expiration_date ?? null, short: sel.lots.some((x) => x.short), shortfall: sel.shortfall };
  }
  return out;
}

export interface TransferShipbobPreview {
  reference: string; total_units: number;
  au_order: { from: string; to: string; recipient: string[]; lines: TransferLinePlan[] };
  uk_wro: { site: string; lines: { sku: string; qty: number }[] };
  warnings: string[];
  ready: boolean;
  place_in_shipbob: { where: string; steps: string[] };
}

// Build the full preview for a transfer (no ShipBob writes).
export async function previewTransferShipbob(reference: string): Promise<TransferShipbobPreview | { error: string }> {
  const t = await getTransfer(reference);
  if (!t) return { error: `No transfer found with reference ${reference}.` };
  if (!t.lines?.length) return { error: `Transfer ${reference} has no lines.` };

  // sku → inventory id per location (Altona = source, Manchester = WRO target)
  const { data: pls } = await supabaseLogistics
    .from('product_locations')
    .select('shipbob_inventory_id, active, products(sku), location:location_id(code)');
  const invBy = (sku: string, code: string) => (pls ?? []).find((p: any) => p.products?.sku === sku && (p.location?.code || '').toUpperCase() === code && p.active)?.shipbob_inventory_id;

  const warnings: string[] = [];
  const lines: TransferLinePlan[] = [];
  for (const l of t.lines) {
    const altInv = invBy(l.sku, 'ALTONA');
    if (!altInv) { lines.push({ sku: l.sku, label: `${l.flavour || l.name || l.sku}`, needed: l.qty, allocated: 0, lots: [], shortfall: l.qty, warnings: ['no Altona ShipBob inventory id'] }); warnings.push(`${l.sku}: not mapped to Altona ShipBob inventory.`); continue; }
    const lots = await lotsForInventory('ALTONA', Number(altInv));
    const sel = selectLots(lots, l.qty);
    const lw: string[] = [];
    if (sel.shortfall > 0) { lw.push(`short ${sel.shortfall} units at Altona`); warnings.push(`${l.sku}: only ${sel.allocated}/${l.qty} available at Altona.`); }
    if (sel.lots.some((x) => x.short)) { lw.push('contains a short-dated lot'); warnings.push(`${l.sku}: best available lot is short-dated (<${Math.round(SHORT_DATE_DAYS / 30)}mo) — review before sending to the UK.`); }
    if (!invBy(l.sku, 'MANCHESTER')) warnings.push(`${l.sku}: not mapped to Manchester ShipBob inventory (WRO line will fail).`);
    lines.push({ sku: l.sku, label: `${l.flavour || l.name || l.sku}`, needed: l.qty, allocated: sel.allocated, lots: sel.lots, shortfall: sel.shortfall, warnings: lw });
  }

  return {
    reference,
    total_units: transferUnits(t),
    au_order: {
      from: 'ShipBob Altona (AU)', to: 'ShipBob Manchester (UK)',
      recipient: [IMPORTER.name, ...IMPORTER.addr],
      lines,
    },
    uk_wro: { site: 'MANCHESTER', lines: lines.map((l) => ({ sku: l.sku, qty: l.allocated })) },
    warnings,
    ready: warnings.length === 0,
    // ShipBob B2B orders are a separate freight flow (no API yet) — give the exact UI recipe so
    // placing it is mechanical and the long-dated lots get selected correctly.
    place_in_shipbob: {
      where: 'ShipBob Altona → Orders → Create order → Add single order',
      steps: [
        'Ship to: BUSINESS',
        'Recipient: "The Protein Pancake ShipBob, Inc." (saved Manchester contact — Unit P6, Heywood, OL10 2TT)',
        'Shipping method: FREIGHT (it\'s a pallet)',
        'Payment: UPLOAD YOUR OWN (Maersk handles the freight)',
        'Packing instructions: attach the Commercial Invoice + Packing List (instructions can be left blank)',
        'Add items + SELECT THE LOTS shown above for each SKU (longest-dated — do NOT accept ShipBob\'s default FEFO short-dated pick)',
      ],
    },
  };
}

// Generate the UK (Manchester) receiving WRO from the AU order's units + lots + best-befores.
// The WRO's label then gets attached to the AU B2B order before the pallet leaves AU, so
// Manchester can receive it on arrival. Idempotent: returns the existing WRO if already made.
export async function createTransferWro(reference: string, auOrderRef?: string):
  Promise<{ wro_id: number; status: string; already_existed?: boolean; lines: { sku: string; qty: number; lots: LotPick[] }[]; label_path: string; warnings: string[] } | { error: string }> {
  const t = await getTransfer(reference);
  if (!t) return { error: `No transfer found with reference ${reference}.` };
  if (t.shipbob_wro_id) return { wro_id: Number(t.shipbob_wro_id), status: t.shipbob_wro_status || 'AwaitingArrival', already_existed: true, lines: [], label_path: `/api/transfers/${reference}/wro-label`, warnings: [`WRO ${t.shipbob_wro_id} already exists for ${reference}.`] };

  const preview = await previewTransferShipbob(reference);
  if ('error' in preview) return preview;

  // Manchester inventory ids per SKU (the WRO is created at the destination FC)
  const { data: pls } = await supabaseLogistics.from('product_locations')
    .select('shipbob_inventory_id, active, products(sku), location:location_id(code)');
  const manInv = (sku: string) => (pls ?? []).find((p: any) => p.products?.sku === sku && (p.location?.code || '').toUpperCase() === 'MANCHESTER' && p.active)?.shipbob_inventory_id;

  const items: { inventory_id: number; quantity: number; lot_number: string; expiration_date: string }[] = [];
  const warnings = [...preview.warnings];
  const lines: { sku: string; qty: number; lots: LotPick[] }[] = [];
  for (const l of preview.au_order.lines) {
    const inv = manInv(l.sku);
    if (!inv) { warnings.push(`${l.sku}: no Manchester inventory id — can't add to WRO.`); continue; }
    for (const lot of l.lots) items.push({ inventory_id: Number(inv), quantity: lot.qty, lot_number: lot.lot_number, expiration_date: lot.expiration_date });
    lines.push({ sku: l.sku, qty: l.allocated, lots: l.lots });
  }
  if (!items.length) return { error: 'No lines could be mapped to Manchester inventory — WRO not created.' };

  const today = new Date().toISOString().slice(0, 10);
  const eta = t.eta && t.eta > today ? t.eta : new Date(Date.now() + 75 * 864e5).toISOString().slice(0, 10);
  let wro;
  try {
    wro = await createWRO({ site: 'MANCHESTER', expected_arrival_date: eta, tracking_ref: t.bl_ref || reference, purchase_order_number: auOrderRef || t.shipbob_order_ref || reference, package_type: 'Pallet', items });
  } catch (e) { return { error: `Manchester WRO create failed: ${String(e).slice(0, 160)}` }; }

  await supabaseLogistics.from('internal_transfers')
    .update({ shipbob_wro_id: String(wro.id), shipbob_wro_status: wro.status, ...(auOrderRef ? { shipbob_order_ref: auOrderRef } : {}) })
    .eq('reference', reference).then(() => {}, () => {});

  const label = await getWROLabels('MANCHESTER', wro.id).catch(() => null);
  if (!label) warnings.push('WRO created but its label PDF isn\'t available yet — re-fetch the label link shortly.');
  return { wro_id: wro.id, status: wro.status, lines, label_path: `/api/transfers/${reference}/wro-label`, warnings };
}
