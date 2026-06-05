import { NextRequest, NextResponse } from 'next/server';
import { setConfig } from '@/lib/settings';

// Emergency 2FA disable if an authenticator is lost. Guarded by CRON_SECRET.
// /api/auth is middleware-exempt so this works without a session:
//   curl -X POST .../api/auth/2fa-recovery -H "x-cron-secret: <CRON_SECRET>"
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (!secret || given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  await setConfig('twofa_enabled', 'false');
  return NextResponse.json({ ok: true, twofa: 'disabled' });
}
