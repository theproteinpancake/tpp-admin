import { NextRequest, NextResponse } from 'next/server';
import { sendSalesReview, dayMetrics, weekMetrics, reviewText, reviewVars } from '@/lib/analyticsBrief';
import { melbDate, dowMon0, addDays } from '@/lib/tz';
import { recordJobRun } from '@/lib/settings';

export const maxDuration = 120;

// Owner sales review. Defaults to weekly on Mondays (Melbourne time), daily otherwise.
// ?type=daily|weekly overrides. ?dry=1 renders without sending. Cron-secret guarded.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const today = melbDate(0);
  const dow = dowMon0(today); // Mon=0
  const kind = (url.searchParams.get('type') as 'daily' | 'weekly' | null) || (dow === 0 ? 'weekly' : 'daily');

  if (url.searchParams.get('dry')) {
    let m;
    if (kind === 'weekly') m = await weekMetrics(addDays(today, -dow - 7));
    else m = await dayMetrics(melbDate(-1));
    return NextResponse.json({ ok: true, dry: true, kind, text: m ? reviewText(m) : 'no data', vars: m ? reviewVars(m) : null });
  }

  const res = await sendSalesReview(kind);
  if (res.sent > 0) await recordJobRun('sales-review');
  return NextResponse.json({ ok: true, ...res });
}

export const GET = handle;
export const POST = handle;
