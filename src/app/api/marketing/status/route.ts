import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';

// Update an influencer/collab status (and collab samples_received) from the dashboard.
// Dashboard auth is enforced by middleware.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.table || !body?.id) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const table = body.table === 'collabs' ? 'collabs' : body.table === 'influencers' ? 'influencers' : null;
  if (!table) return NextResponse.json({ error: 'bad table' }, { status: 400 });
  const patch: any = { updated_at: new Date().toISOString() };
  if (typeof body.status === 'string') patch.status = body.status;
  if (table === 'collabs' && typeof body.samples_received === 'boolean') patch.samples_received = body.samples_received;
  const { error } = await supabaseLogistics.from(table).update(patch).eq('id', body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
