// Internal-transfer data access.
import { supabaseLogistics } from './supabase-logistics';
import { declaredValue, hsFor, originFor } from './transferConstants';

export interface TransferLine {
  product_id: string; sku: string; name: string; flavour: string | null;
  unit_size_g: number | null; category: string; qty: number; qty_received: number;
  unit_value: number | null; hs_code: string | null; coo: string | null;
}
export interface Transfer {
  id: string; reference: string; status: string; ship_date: string | null; eta: string | null;
  carrier: string | null; bl_ref: string | null; shipment_ref: string | null; container_ref: string | null;
  currency: string | null; total_value: number | null; cartons: number | null; gross_kg: number | null;
  notes: string | null; origin_code: string | null; destination_code: string | null;
  shipbob_wro_id: string | null; shipbob_wro_status: string | null; shipbob_order_ref: string | null;
  lines: TransferLine[];
}

export async function listTransfers(): Promise<Transfer[]> {
  const { data } = await supabaseLogistics
    .from('internal_transfers')
    .select('*, origin:origin_location_id(code), destination:destination_location_id(code), items:internal_transfer_items(*, product:product_id(sku,name,flavour,unit_size_g,category))')
    .order('created_at', { ascending: false });
  return (data ?? []).map(mapTransfer);
}

export async function getTransfer(reference: string): Promise<Transfer | null> {
  const { data } = await supabaseLogistics
    .from('internal_transfers')
    .select('*, origin:origin_location_id(code), destination:destination_location_id(code), items:internal_transfer_items(*, product:product_id(sku,name,flavour,unit_size_g,category))')
    .eq('reference', reference)
    .maybeSingle();
  return data ? mapTransfer(data) : null;
}

// Replace a transfer's manifest from chat (e.g. after seeing short-dated stock, drop/adjust lines).
// `lines` is the FULL desired set [{sku, units}]; recomputes cartons (12 units/520g carton) + value.
// Docs (CI/Packing List) then regenerate from these lines. Draft transfers only.
export async function updateTransferLines(reference: string, lines: { sku: string; units: number }[]):
  Promise<{ ok: true; units: number; cartons: number; lines: number } | { error: string }> {
  const t = await getTransfer(reference);
  if (!t) return { error: `No transfer found with reference ${reference}.` };
  if (t.status !== 'draft') return { error: `${reference} is "${t.status}", not a draft — amend the manifest before it ships, or update its status first.` };
  const want = lines.map((l) => ({ sku: l.sku.toUpperCase().trim(), units: Math.round(Number(l.units) || 0) })).filter((l) => l.sku && l.units > 0);
  if (!want.length) return { error: 'No valid lines provided.' };

  const { data: prods } = await supabaseLogistics.from('products').select('id, sku, category').in('sku', want.map((l) => l.sku));
  const bySku = new Map((prods ?? []).map((p: any) => [p.sku, p]));
  const unknown = want.filter((l) => !bySku.has(l.sku)).map((l) => l.sku);
  if (unknown.length) return { error: `Unknown SKU(s): ${unknown.join(', ')}.` };

  const items = want.map((l) => {
    const p: any = bySku.get(l.sku);
    const cat = p.category || 'mix';
    return { transfer_id: t.id, product_id: p.id, qty: l.units, unit_value: declaredValue(l.sku), hs_code: hsFor(cat, l.sku), coo: originFor(l.sku) };
  });
  const totalUnits = items.reduce((s, i) => s + i.qty, 0);
  const cartons = items.reduce((s, i) => s + Math.ceil(i.qty / 12), 0); // 520g: 12 units/carton
  const totalValue = Math.round(items.reduce((s, i) => s + i.qty * (i.unit_value ?? 0), 0) * 100) / 100;

  await supabaseLogistics.from('internal_transfer_items').delete().eq('transfer_id', t.id);
  const { error } = await supabaseLogistics.from('internal_transfer_items').insert(items);
  if (error) return { error: error.message };
  await supabaseLogistics.from('internal_transfers').update({ cartons, total_value: totalValue }).eq('id', t.id);
  return { ok: true, units: totalUnits, cartons, lines: items.length };
}

function mapTransfer(t: any): Transfer {
  return {
    id: t.id, reference: t.reference, status: t.status, ship_date: t.ship_date, eta: t.eta,
    carrier: t.carrier, bl_ref: t.bl_ref, shipment_ref: t.shipment_ref, container_ref: t.container_ref,
    currency: t.currency, total_value: t.total_value, cartons: t.cartons, gross_kg: t.gross_kg,
    notes: t.notes, origin_code: t.origin?.code ?? null, destination_code: t.destination?.code ?? null,
    shipbob_wro_id: t.shipbob_wro_id ?? null, shipbob_wro_status: t.shipbob_wro_status ?? null, shipbob_order_ref: t.shipbob_order_ref ?? null,
    lines: (t.items ?? []).map((i: any): TransferLine => ({
      product_id: i.product_id, sku: i.product?.sku ?? '', name: i.product?.name ?? '',
      flavour: i.product?.flavour ?? null, unit_size_g: i.product?.unit_size_g ?? null,
      category: i.product?.category ?? 'mix', qty: i.qty, qty_received: i.qty_received,
      unit_value: i.unit_value, hs_code: i.hs_code, coo: i.coo,
    })).sort((a: TransferLine, b: TransferLine) => (a.flavour ?? a.name).localeCompare(b.flavour ?? b.name)),
  };
}

export const TRANSFER_STATUSES = ['draft', 'in_transit', 'customs', 'arrived', 'received', 'cancelled'] as const;
export type TransferStatus = typeof TRANSFER_STATUSES[number];

// Update a transfer's status. 'received' should ONLY be set once ShipBob has actually
// received the goods into inventory (confirmed via the ShipBob receiving email or WRO
// completion) — never on the basis of an ETA or "arrived in country".
export async function setTransferStatus(reference: string, status: TransferStatus):
  Promise<{ ok: true; reference: string; status: string } | { error: string }> {
  if (!TRANSFER_STATUSES.includes(status)) return { error: `Invalid status "${status}".` };
  const { data, error } = await supabaseLogistics.from('internal_transfers')
    .update({ status }).eq('reference', reference).select('reference').maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: `No transfer found matching "${reference}".` };
  return { ok: true, reference, status };
}

export const transferUnits = (t: Transfer) => t.lines.reduce((s, l) => s + l.qty, 0);
export const transferValue = (t: Transfer) =>
  t.total_value ?? t.lines.reduce((s, l) => s + l.qty * (l.unit_value ?? 0), 0);
