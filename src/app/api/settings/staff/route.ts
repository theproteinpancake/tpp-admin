import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { newSetupToken, getCurrentUser, isOwner, ALL_SECTIONS } from '@/lib/auth';

const VALID_ROLES = ['owner', 'wholesale', 'marketing', 'logistics', 'staff', 'admin'];
const normRole = (r: unknown) => (typeof r === 'string' && VALID_ROLES.includes(r) ? r : 'staff');
const normSections = (s: unknown): string[] | null => {
  if (!Array.isArray(s)) return null;
  const v = s.filter((x): x is string => typeof x === 'string' && (ALL_SECTIONS as readonly string[]).includes(x));
  return v.length ? v : [];
};

const setupLink = (req: NextRequest, email: string, token: string) =>
  `${new URL(req.url).origin}/setup?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

// Staff directory CRUD — OWNER ONLY (middleware gates auth; this gates the role).
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!isOwner(me)) return NextResponse.json({ error: 'Owner access required' }, { status: 403 });

  const b = await req.json().catch(() => null);
  if (!b?.action) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  if (b.action === 'add') {
    if (!b.email) return NextResponse.json({ error: 'email required' }, { status: 400 });
    const email = String(b.email).toLowerCase().trim();
    const token = newSetupToken();
    const { error } = await supabaseLogistics.from('app_users').insert({
      email, name: b.name || null, role: normRole(b.role), sections: normSections(b.sections), active: true, setup_token: token,
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
    if (b.role) patch.role = normRole(b.role);
    if ('sections' in b) patch.sections = normSections(b.sections);
    if (typeof b.active === 'boolean') patch.active = b.active;
    if (typeof b.name === 'string') patch.name = b.name;
    const { error } = await supabaseLogistics.from('app_users').update(patch).eq('id', b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'remove') {
    if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    if (me.id === b.id) return NextResponse.json({ error: 'You can\'t remove your own account' }, { status: 400 });
    const { error } = await supabaseLogistics.from('app_users').delete().eq('id', b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
