import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';

// Staff directory CRUD (dashboard-auth gated by middleware).
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.action) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  if (b.action === 'add') {
    if (!b.email) return NextResponse.json({ error: 'email required' }, { status: 400 });
    const { error } = await supabaseLogistics.from('app_users').insert({
      email: String(b.email).toLowerCase().trim(), name: b.name || null, role: b.role === 'admin' ? 'admin' : 'staff', active: true,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'update') {
    if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const patch: any = {};
    if (b.role) patch.role = b.role === 'admin' ? 'admin' : 'staff';
    if (typeof b.active === 'boolean') patch.active = b.active;
    if (typeof b.name === 'string') patch.name = b.name;
    const { error } = await supabaseLogistics.from('app_users').update(patch).eq('id', b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'remove') {
    if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const { error } = await supabaseLogistics.from('app_users').delete().eq('id', b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
