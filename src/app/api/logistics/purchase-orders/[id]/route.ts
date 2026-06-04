import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';

// Update a PO: change status, or receive all outstanding units.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const today = new Date().toISOString().slice(0, 10);

    if (body.receiveAll) {
      const { data: items } = await supabaseLogistics
        .from('po_items').select('id, qty_ordered').eq('po_id', id);
      for (const it of items ?? []) {
        await supabaseLogistics.from('po_items').update({ qty_received: it.qty_ordered }).eq('id', it.id);
      }
      await supabaseLogistics.from('purchase_orders')
        .update({ status: 'received', received_date: today, updated_at: today }).eq('id', id);
      return NextResponse.json({ ok: true, received: true });
    }

    if (body.status) {
      const patch: Record<string, unknown> = { status: body.status, updated_at: today };
      if (body.status === 'received') patch.received_date = today;
      await supabaseLogistics.from('purchase_orders').update(patch).eq('id', id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await supabaseLogistics.from('purchase_orders').delete().eq('id', id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
