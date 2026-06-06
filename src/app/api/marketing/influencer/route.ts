import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';

const FIELDS = new Set(['status', 'post_type', 'region', 'notes', 'flavour_sent']);

// Inline edits on the Influencers dashboard (dashboard-auth gated by middleware).
export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.id || !b?.field || !FIELDS.has(b.field)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const { error } = await supabaseLogistics.from('influencers')
    .update({ [b.field]: b.value ?? null, updated_at: new Date().toISOString() }).eq('id', b.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
