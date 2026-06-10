import { NextRequest, NextResponse } from 'next/server';
import { fetchMetaWeek, metaConfigured } from '@/lib/meta';

export const maxDuration = 30;

// Quick check that Meta incrementality is enabled (inc_conversions > 0). ?from&to (AEST dates).
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!metaConfigured()) return NextResponse.json({ error: 'Meta not configured' }, { status: 400 });
  const url = new URL(req.url);
  const from = url.searchParams.get('from') || '2026-06-01';
  const to = url.searchParams.get('to') || '2026-06-08';
  const m = await fetchMetaWeek(from, to).catch((e) => ({ _err: String(e) } as any));
  if (m?._err) return NextResponse.json({ ok: false, error: m._err });
  return NextResponse.json({
    ok: true, range: { from, to },
    spend: m.spend, purchases: m.purchases, cpa: m.cpa, roas: m.roas,
    incremental_conversions: m.inc_conversions, incremental_value: m.inc_value,
    nc_cpa: m.nc_cpa, nc_roas: m.nc_roas,
    incrementality_enabled: m.inc_conversions > 0,
  });
}

export const GET = handle;
export const POST = handle;
