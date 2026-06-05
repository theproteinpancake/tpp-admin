import { NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { xeroGet, getConnection } from '@/lib/xero';

export const maxDuration = 60;

// Xero JSON dates can be ISO or "/Date(ms+0000)/"
function xeroDate(s: unknown): string | null {
  if (!s || typeof s !== 'string') return null;
  const m = /\/Date\((\d+)/.exec(s);
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Xero AUTHORISED PO = open/outstanding (= inbound for us)
const STATUS_MAP: Record<string, string> = {
  DRAFT: 'draft', SUBMITTED: 'placed', AUTHORISED: 'placed', BILLED: 'received', DELETED: 'cancelled',
};

export async function POST() {
  try {
    if (!(await getConnection())) {
      return NextResponse.json({ error: 'Xero not connected' }, { status: 400 });
    }
    // reference maps
    const { data: products } = await supabaseLogistics.from('products').select('id, sku');
    const idBySku = new Map((products ?? []).map((p: any) => [p.sku, p.id]));
    const { data: suppliers } = await supabaseLogistics.from('suppliers').select('id, name');
    const supByName = new Map((suppliers ?? []).map((s: any) => [s.name.toLowerCase(), s.id]));
    const { data: altona } = await supabaseLogistics.from('locations').select('id').eq('code', 'ALTONA').single();

    // existing local statuses — so a re-sync never downgrades a PO we've already
    // reconciled (received/cancelled) back to 'placed' just because Xero still
    // lists it as AUTHORISED. Local reconciliation is the source of truth here.
    const { data: existing } = await supabaseLogistics.from('purchase_orders').select('xero_po_id, status');
    const CLOSED = new Set(['received', 'cancelled']);
    const localStatus = new Map((existing ?? []).map((p: any) => [p.xero_po_id, p.status]));

    // pull approved (and submitted) POs
    const data = await xeroGet('/PurchaseOrders?Status=AUTHORISED');
    const pos = data.PurchaseOrders ?? [];

    let upserted = 0, linesMapped = 0, linesSkipped = 0;
    for (const po of pos) {
      const total = Number(po.Total) || null;
      const prior = localStatus.get(po.PurchaseOrderID);
      // keep a locally-reconciled close; otherwise map from Xero's status
      const status = prior && CLOSED.has(prior) ? prior : (STATUS_MAP[po.Status] || 'placed');
      const row = {
        xero_po_id: po.PurchaseOrderID,
        po_number: po.PurchaseOrderNumber || null,
        reference: po.Reference || null,
        supplier_id: supByName.get((po.Contact?.Name || '').toLowerCase()) || null,
        destination_location_id: altona?.id || null,
        status,
        xero_status: po.Status || null,
        currency: po.CurrencyCode || 'AUD',
        order_date: xeroDate(po.Date),
        expected_date: xeroDate(po.DeliveryDate),
        total_cost: total,
        source: 'xero',
        updated_at: new Date().toISOString(),
      };
      const { data: saved, error } = await supabaseLogistics
        .from('purchase_orders').upsert(row, { onConflict: 'xero_po_id' }).select('id').single();
      if (error || !saved) continue;
      upserted++;

      // replace line items
      await supabaseLogistics.from('po_items').delete().eq('po_id', saved.id);
      const items = (po.LineItems ?? [])
        .map((li: any) => {
          const pid = idBySku.get((li.ItemCode || '').trim());
          if (!pid) { linesSkipped++; return null; }
          linesMapped++;
          return {
            po_id: saved.id, product_id: pid,
            qty_ordered: Math.round(Number(li.Quantity) || 0),
            qty_received: 0,
            unit_cost: Number(li.UnitAmount) || null,
          };
        })
        .filter(Boolean);
      if (items.length) await supabaseLogistics.from('po_items').insert(items);
    }

    return NextResponse.json({ ok: true, pos_synced: upserted, lines_mapped: linesMapped, lines_skipped: linesSkipped });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
