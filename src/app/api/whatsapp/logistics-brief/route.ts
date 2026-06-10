import { NextRequest, NextResponse } from 'next/server';
import { buildLogisticsBrief, sendLogisticsBrief } from '@/lib/logisticsBrief';
import { recordJobRun } from '@/lib/settings';

export const maxDuration = 60;

// Restructured 9am logistics brief. ?dry=1 renders without sending. Cron-secret guarded.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (new URL(req.url).searchParams.get('dry')) {
    const { vars, text } = await buildLogisticsBrief();
    return NextResponse.json({ ok: true, dry: true, text, vars });
  }
  const res = await sendLogisticsBrief();
  if (res.sent > 0) await recordJobRun('logistics-brief');
  return NextResponse.json({ ok: true, ...res });
}

export const GET = handle;
export const POST = handle;
