import { NextResponse } from 'next/server';

// Manual trigger for the ShipBob snapshot Edge Function (also runs daily via cron).
export const maxDuration = 60;

export async function POST() {
  const url = process.env.LOGISTICS_SUPABASE_URL;
  const key = process.env.LOGISTICS_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'Logistics env not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(`${url}/functions/v1/shipbob-snapshot`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: 'sync failed', data }, { status: 502 });
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
