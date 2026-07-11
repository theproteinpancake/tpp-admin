import { NextRequest, NextResponse } from 'next/server';
import { sendSalesReview, dayMetrics, weekMetrics, reviewText, reviewVars } from '@/lib/analyticsBrief';
import { melbDate, dowMon0, addDays } from '@/lib/tz';
import { recordJobRun } from '@/lib/settings';

export const maxDuration = 300; // verified-delivery ladder waits ~40s per channel attempt

// Owner sales review. Daily every day; Mondays ALSO send the weekly wrap as a second message
// (Luke wants the daily rhythm unbroken — the weekly used to REPLACE Monday's daily).
// Two messages, not one combined: template vars are single-line/length-capped, so a combined
// send turns the weekly half into an unreadable crammed line.
// ?type=daily|weekly overrides. ?dry=1 renders without sending. Cron-secret guarded.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const today = melbDate(0);
  const dow = dowMon0(today); // Mon=0
  const explicit = url.searchParams.get('type') as 'daily' | 'weekly' | null;
  const kinds: ('daily' | 'weekly')[] = explicit ? [explicit] : (dow === 0 ? ['daily', 'weekly'] : ['daily']);

  if (url.searchParams.get('dry')) {
    const renders = [];
    for (const kind of kinds) {
      const m = kind === 'weekly' ? await weekMetrics(addDays(today, -dow - 7)) : await dayMetrics(melbDate(-1));
      renders.push({ kind, text: m ? reviewText(m) : 'no data', vars: m ? reviewVars(m) : null });
    }
    return NextResponse.json({ ok: true, dry: true, renders });
  }

  const results = [];
  for (const kind of kinds) results.push(await sendSalesReview(kind));
  if (results.some((r) => r.sent > 0)) await recordJobRun('sales-review');
  return NextResponse.json({ ok: true, results });
}

export const GET = handle;
export const POST = handle;
