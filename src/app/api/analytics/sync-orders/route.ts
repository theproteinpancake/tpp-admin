import { NextRequest, NextResponse } from 'next/server';
import { syncOrders } from '@/lib/shopifyOrders';

export const maxDuration = 300;

// Sync Shopify orders (with attribution) since a date (default 120 days back).
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret');
  if (given && secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const sp = new URL(req.url).searchParams;
  const since = body.since || sp.get('since') || new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10);
  const until = body.until || sp.get('until') || undefined;
  const res = await syncOrders(since, until);
  return NextResponse.json({ ok: !res.error, ...res, since, until });
}

export const POST = handle;
export const GET = handle;
