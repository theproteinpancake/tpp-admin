import { NextRequest, NextResponse } from 'next/server';
import { setConfig } from '@/lib/settings';
import { supabaseLogistics } from '@/lib/supabase-logistics';

// Emergency 2FA disable if an authenticator is lost. Guarded by CRON_SECRET.
// /api/auth is middleware-exempt so this works without a session:
//   curl -X POST ".../api/auth/2fa-recovery?email=kate@theproteinpancake.co" -H "x-cron-secret: <CRON_SECRET>"
// Omit email to also clear the legacy global gate.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const given = req.headers.get('x-cron-secret') || url.searchParams.get('secret');
  if (!secret || given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const email = url.searchParams.get('email');
  if (email) {
    await supabaseLogistics.from('app_users').update({ totp_enabled: false }).ilike('email', email);
  } else {
    await supabaseLogistics.from('app_users').update({ totp_enabled: false }).neq('id', '00000000-0000-0000-0000-000000000000');
    await setConfig('twofa_enabled', 'false');
  }
  return NextResponse.json({ ok: true, twofa: 'disabled', scope: email || 'all' });
}
