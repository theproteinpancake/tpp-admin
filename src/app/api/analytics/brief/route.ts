import { NextRequest, NextResponse } from 'next/server';
import { sendAnalyticsBrief, buildDailyBrief, buildWeeklyBrief } from '@/lib/analyticsBrief';

export const maxDuration = 120;

// 7am cron hits this with no type → Monday gives the week-in-review, otherwise the daily snapshot.
// ?preview=1 returns the text without sending (for testing).
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret');
  if (given && secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;

  // AEST weekday: Monday → weekly
  const aestDow = new Date(Date.now() + 10 * 3600_000).getUTCDay(); // 1 = Monday
  const type = (sp.get('type') as 'daily' | 'weekly' | null) || (aestDow === 1 ? 'weekly' : 'daily');

  if (sp.get('preview')) {
    const text = type === 'weekly' ? await buildWeeklyBrief() : await buildDailyBrief();
    return NextResponse.json({ type, text });
  }
  const res = await sendAnalyticsBrief(type);
  return NextResponse.json({ ok: true, type, ...res });
}

export const POST = handle;
export const GET = handle;
