import { NextRequest, NextResponse } from 'next/server';
import { getConfig, setConfig } from '@/lib/settings';
import { generateSecret, otpauthUrl, verifyTotp } from '@/lib/totp';

// 2FA enrollment (additive, safe): begin → show secret/QR; enable → verify a code to
// turn it on; disable → turn off. Once enabled, login requires the TOTP code.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.action) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  if (b.action === 'begin') {
    const secret = generateSecret();
    await setConfig('twofa_pending_secret', secret);
    const email = (await getConfig('admin_email')) || 'admin@theproteinpancake.co';
    return NextResponse.json({ ok: true, secret, otpauth: otpauthUrl(secret, email) });
  }
  if (b.action === 'enable') {
    const pending = await getConfig('twofa_pending_secret');
    if (!pending) return NextResponse.json({ error: 'Start enrollment first.' }, { status: 400 });
    if (!verifyTotp(pending, String(b.token || ''))) return NextResponse.json({ error: 'Code didn\'t match — try again.' }, { status: 400 });
    await setConfig('twofa_secret', pending);
    await setConfig('twofa_enabled', 'true');
    await setConfig('twofa_pending_secret', '');
    return NextResponse.json({ ok: true });
  }
  if (b.action === 'disable') {
    // require a valid current code to disable (avoids casual switch-off)
    const secret = await getConfig('twofa_secret');
    if (secret && !verifyTotp(secret, String(b.token || ''))) return NextResponse.json({ error: 'Enter a valid current code to disable.' }, { status: 400 });
    await setConfig('twofa_enabled', 'false');
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
