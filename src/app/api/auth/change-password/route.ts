import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { getCurrentUser, verifyPassword, hashPassword, passwordPolicyError } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const b = await req.json().catch(() => null);
  const policyError = passwordPolicyError(String(b?.new || ''));
  if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
  // if they already have a password, require the current one
  if (user.password_hash && !verifyPassword(String(b.current || ''), user.password_hash)) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
  }
  await supabaseLogistics.from('app_users').update({ password_hash: hashPassword(String(b.new)), password_changed_at: new Date().toISOString() }).eq('id', user.id);
  return NextResponse.json({ ok: true });
}
