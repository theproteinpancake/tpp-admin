import { NextRequest, NextResponse } from 'next/server';
import { runScour } from '@/lib/gmailScour';

export const maxDuration = 120;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const res = await runScour();
  return NextResponse.json({ ok: true, ...res });
}

export const POST = handle;
export const GET = handle;
