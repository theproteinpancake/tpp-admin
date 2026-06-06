import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { newSetupToken } from '@/lib/auth';

const setupLink = (req: NextRequest, email: string, token: string) =>
  `${new URL(req.url).origin}/setup?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

// Staff directory CRUD (dashboard-auth gated by middleware).
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.action) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  if (b.action === 'add') {
    if (!b.email) return NextResponse.json({ error: 'email required' }, { status: 400 });
    const email = String(b.email).toLowerCase().trim();
    const token = newSetupToken();
    const { error } = await supabaseLogistics.from('app_users').insert({
      email, name: b.name || null, role: b.role === 'admin' ? 'admin' : 'staff', active: true, setup_token: token,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, setup_link: setupLink(req, email, token) });
  }
  if (b.action === 'reset_setup') {
    if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const token = newSetupToken();
    const { data, error } = await supabaseLogistics.from('app_users')
      .update({ setup_token: token, password_hash: null, totp_enabled: false }).eq('id', b.id).select('email').maybeSingle() as any;
    if (error || !data) return NextResponse.json({ error: error?.message || 'not found' }, { status: 500 });
    return NextResponse.json({ ok: true, setup_link: setupLink(req, data.email, token) });
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
