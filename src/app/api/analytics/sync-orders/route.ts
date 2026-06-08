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
  const since = body.since || new URL(req.url).searchParams.get('since') || new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10);
  const res = await syncOrders(since);
  return NextResponse.json({ ok: !res.error, ...res, since });
}

export const POST = handle;
export const GET = handle;
