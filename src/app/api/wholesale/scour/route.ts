import { NextRequest, NextResponse } from 'next/server';
import { runWholesalePoScour } from '@/lib/wholesaleScour';
import { recordJobRun } from '@/lib/settings';

export const maxDuration = 120;

// Hourly wholesale PO scour. Cron passes the auth cookie (middleware) + x-cron-secret.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const res = await runWholesalePoScour();
  if (!res.error) await recordJobRun('wholesale-scour');
  return NextResponse.json({ ok: true, ...res });
}

export const POST = handle;
export const GET = handle;
