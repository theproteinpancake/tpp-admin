import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { getCurrentUser } from '@/lib/auth';
import { generateSecret, otpauthUrl, verifyTotp } from '@/lib/totp';

// Per-user 2FA management for the signed-in user.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!b?.action) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  if (b.action === 'begin') {
    const secret = generateSecret();
    await supabaseLogistics.from('app_users').update({ totp_secret: secret, totp_enabled: false }).eq('id', user.id);
    return NextResponse.json({ ok: true, secret, otpauth: otpauthUrl(secret, user.email) });
  }
  if (b.action === 'enable') {
    if (!user.totp_secret || !verifyTotp(user.totp_secret, String(b.token || ''))) return NextResponse.json({ error: 'Code didn\'t match — try again.' }, { status: 400 });
    await supabaseLogistics.from('app_users').update({ totp_enabled: true }).eq('id', user.id);
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'disable') {
    if (user.totp_secret && !verifyTotp(user.totp_secret, String(b.token || ''))) return NextResponse.json({ error: 'Enter a valid current code to disable.' }, { status: 400 });
    await supabaseLogistics.from('app_users').update({ totp_enabled: false }).eq('id', user.id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
