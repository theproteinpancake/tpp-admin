import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

// TEMP read-only: list ShipBob channels (+scopes) per site to diagnose the order 403.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const tokens: Record<string, string | undefined> = {
    ALTONA: process.env.SHIPBOB_API_TOKEN, MANCHESTER: process.env.SHIPBOB_API_TOKEN_UK,
  };
  const out: any = {};
  for (const [site, token] of Object.entries(tokens)) {
    if (!token) { out[site] = { error: 'no token' }; continue; }
    try {
      const res = await fetch('https://api.shipbob.com/1.0/channel', { headers: { Authorization: `Bearer ${token}` } });
      const text = await res.text();
      out[site] = res.ok ? JSON.parse(text) : { status: res.status, body: text.slice(0, 300) };
    } catch (e) { out[site] = { error: String(e).slice(0, 200) }; }
  }
  return NextResponse.json(out);
}
export const POST = handle;
export const GET = handle;
