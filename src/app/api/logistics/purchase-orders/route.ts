import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';

// Create a purchase order with line items.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items : [];
    const lines = items
      .filter((i: any) => i.product_id && Number(i.qty_ordered) > 0)
      .map((i: any) => ({
        product_id: i.product_id,
        qty_ordered: Number(i.qty_ordered),
        unit_cost: i.unit_cost != null && i.unit_cost !== '' ? Number(i.unit_cost) : null,
      }));
    if (lines.length === 0) {
      return NextResponse.json({ error: 'Add at least one line item with a quantity.' }, { status: 400 });
    }
    const total = lines.reduce((s: number, i: any) => s + i.qty_ordered * (i.unit_cost || 0), 0);

    const { data: po, error: poErr } = await supabaseLogistics
      .from('purchase_orders')
      .insert({
        po_number: body.po_number || null,
        supplier_id: body.supplier_id || null,
        destination_location_id: body.destination_location_id || null,
        status: body.status || 'placed',
        currency: body.currency || 'AUD',
        order_date: body.order_date || new Date().toISOString().slice(0, 10),
        expected_date: body.expected_date || null,
        total_cost: total || null,
        notes: body.notes || null,
      })
      .select('id')
      .single();
    if (poErr) throw poErr;

    const { error: itemErr } = await supabaseLogistics
      .from('po_items')
      .insert(lines.map((l: any) => ({ ...l, po_id: po.id })));
    if (itemErr) throw itemErr;

    return NextResponse.json({ ok: true, id: po.id });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
