import { NextRequest, NextResponse } from 'next/server';
import { sendSalesReview, dayMetrics, weekMetrics, reviewText, reviewVars } from '@/lib/analyticsBrief';

export const maxDuration = 120;

// Owner sales review. Defaults to weekly on Mondays (AEST), daily otherwise. ?type=daily|weekly
// overrides. ?dry=1 renders text + template variables without sending. Cron-secret guarded.
const aestDate = (off = 0) => new Date(Date.now() + off * 86400_000 + 10 * 3600_000).toISOString().slice(0, 10);

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const aestDow = new Date(aestDate(0) + 'T00:00:00Z').getUTCDay(); // 1 = Monday
  const kind = (url.searchParams.get('type') as 'daily' | 'weekly' | null) || (aestDow === 1 ? 'weekly' : 'daily');

  if (url.searchParams.get('dry')) {
    let m;
    if (kind === 'weekly') { const dow = (aestDow + 6) % 7; m = await weekMetrics(aestDate(-dow - 7)); }
    else m = await dayMetrics(aestDate(-1));
    return NextResponse.json({ ok: true, dry: true, kind, text: m ? reviewText(m) : 'no data', vars: m ? reviewVars(m) : null });
  }

  const res = await sendSalesReview(kind);
  return NextResponse.json({ ok: true, ...res });
}

export const GET = handle;
export const POST = handle;
