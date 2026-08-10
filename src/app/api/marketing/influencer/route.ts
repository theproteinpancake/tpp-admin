import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';

const FIELDS = new Set(['status', 'post_type', 'region', 'notes', 'flavour_sent', 'handle', 'email', 'name']);

// Manual row creation — for gifts Kate processes by hand in ShipBob (or sends outside ShipBob
// entirely), so the dashboard stays the one complete record. The agent's automated sends insert
// from marketing.ts with the same shape.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const name = String(b?.name || '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  const region = ['AU', 'UK', 'NZ', 'USA', 'OTHER'].includes(b?.region) ? b.region : 'AU';
  const row = {
    name,
    handle: String(b?.handle || '').replace(/^@/, '').trim() || null,
    email: String(b?.email || '').trim() || null,
    followers: Number(b?.followers) > 0 ? Math.round(Number(b.followers)) : null,
    flavour_sent: String(b?.flavour_sent || '').trim() || null,
    region,
    sent_from: region === 'UK' ? 'MANCHESTER' : 'ALTONA',
    date_initiated: /^\d{4}-\d{2}-\d{2}$/.test(b?.date_initiated || '') ? b.date_initiated : new Date().toISOString().slice(0, 10),
    status: ['order_processing', 'shipped', 'delivered', 'completed'].includes(b?.status) ? b.status : 'shipped',
    post_type: ['None', 'Reel', 'Reel + Story', 'Story'].includes(b?.post_type) ? b.post_type : 'None',
    tracking_number: String(b?.tracking_number || '').trim() || null,
    shipbob_order_id: String(b?.shipbob_order_id || '').trim() || null,
    cost_cogs: Number(b?.cost_cogs) > 0 ? Number(b.cost_cogs) : null,
    cost_currency: region === 'UK' ? 'GBP' : 'AUD',
    notes: String(b?.notes || '').trim() || null,
    order_summary: 'Added manually via dashboard',
  };
  const { data, error } = await supabaseLogistics.from('influencers').insert(row).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data?.id });
}

// Inline edits on the Influencers dashboard (dashboard-auth gated by middleware).
export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.id || !b?.field || !FIELDS.has(b.field)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { error } = await supabaseLogistics.from('influencers')
    .update({ [b.field]: b.value ?? null, updated_at: new Date().toISOString() }).eq('id', b.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await supabaseLogistics.from('influencers').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
