import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { getUserByEmail, hashPassword, passwordPolicyError } from '@/lib/auth';
import { generateSecret, otpauthUrl, verifyTotp } from '@/lib/totp';

// First-time account setup via the invite token: set own password, then enrol 2FA.
// /api/auth is middleware-exempt so this works pre-login.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.action || !b?.email || !b?.setup_token) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const user = await getUserByEmail(String(b.email));
  if (!user || !user.setup_token || user.setup_token !== b.setup_token) {
    return NextResponse.json({ error: 'This setup link is invalid or already used.' }, { status: 401 });
  }

  if (b.action === 'set_password') {
    const policyError = passwordPolicyError(String(b.password || ''));
    if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
    const secret = generateSecret();
    await supabaseLogistics.from('app_users').update({ password_hash: hashPassword(String(b.password)), password_changed_at: new Date().toISOString(), totp_secret: secret, totp_enabled: false }).eq('id', user.id);
    return NextResponse.json({ ok: true, secret, otpauth: otpauthUrl(secret, user.email) });
  }

  if (b.action === 'enable_2fa') {
    if (!user.totp_secret || !verifyTotp(user.totp_secret, String(b.token || ''))) {
      return NextResponse.json({ error: 'Code didn\'t match — try again.' }, { status: 400 });
    }
    await supabaseLogistics.from('app_users').update({ totp_enabled: true, setup_token: null }).eq('id', user.id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
