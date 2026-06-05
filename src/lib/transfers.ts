// Internal-transfer data access.
import { supabaseLogistics } from './supabase-logistics';

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

function mapTransfer(t: any): Transfer {
  return {
    id: t.id, reference: t.reference, status: t.status, ship_date: t.ship_date, eta: t.eta,
    carrier: t.carrier, bl_ref: t.bl_ref, shipment_ref: t.shipment_ref, container_ref: t.container_ref,
    currency: t.currency, total_value: t.total_value, cartons: t.cartons, gross_kg: t.gross_kg,
    notes: t.notes, origin_code: t.origin?.code ?? null, destination_code: t.destination?.code ?? null,
    lines: (t.items ?? []).map((i: any): TransferLine => ({
      product_id: i.product_id, sku: i.product?.sku ?? '', name: i.product?.name ?? '',
      flavour: i.product?.flavour ?? null, unit_size_g: i.product?.unit_size_g ?? null,
      category: i.product?.category ?? 'mix', qty: i.qty, qty_received: i.qty_received,
      unit_value: i.unit_value, hs_code: i.hs_code, coo: i.coo,
    })).sort((a: TransferLine, b: TransferLine) => (a.flavour ?? a.name).localeCompare(b.flavour ?? b.name)),
  };
}

export const transferUnits = (t: Transfer) => t.lines.reduce((s, l) => s + l.qty, 0);
export const transferValue = (t: Transfer) =>
  t.total_value ?? t.lines.reduce((s, l) => s + l.qty * (l.unit_value ?? 0), 0);
