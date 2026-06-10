import { NextRequest, NextResponse } from 'next/server';
import { buildWholesaleBrief, sendWholesaleBrief } from '@/lib/wholesaleBrief';
import { recordJobRun } from '@/lib/settings';

export const maxDuration = 60;

// Kate's daily wholesale brief. ?dry=1 renders without sending. Cron-secret guarded.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (new URL(req.url).searchParams.get('dry')) {
    const { vars, text } = await buildWholesaleBrief();
    return NextResponse.json({ ok: true, dry: true, text, vars });
  }
  const res = await sendWholesaleBrief();
  if (res.sent > 0) await recordJobRun('wholesale-brief');
  return NextResponse.json({ ok: true, ...res });
}

export const GET = handle;
export const POST = handle;
