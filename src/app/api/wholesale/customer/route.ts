import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';

const DAY = 86400_000;

// Dashboard actions on the "due to reorder" list. Dashboard auth via middleware.
// action 'not_stocked' → drop from wholesale (survives re-sync via manually_excluded).
// action 'mark_ordered' → snooze the nudge until ~next cycle (last order + avg interval).
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.id || !body?.action) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  if (body.action === 'not_stocked') {
    const { error } = await supabaseLogistics.from('wholesale_customers')
      .update({ manually_excluded: true, is_wholesale: false, updated_at: new Date().toISOString() }).eq('id', body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'mark_ordered') {
    const { data: c } = await supabaseLogistics.from('wholesale_customers')
      .select('avg_interval_days').eq('id', body.id).maybeSingle() as any;
    const orderDate = body.order_date || new Date().toISOString().slice(0, 10);
    const interval = Number(c?.avg_interval_days) || 30;
    const until = new Date(new Date(orderDate + 'T00:00:00').getTime() + interval * DAY).toISOString().slice(0, 10);
    const { error } = await supabaseLogistics.from('wholesale_customers')
      .update({ reorder_dismissed_until: until, updated_at: new Date().toISOString() }).eq('id', body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, snoozed_until: until });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
