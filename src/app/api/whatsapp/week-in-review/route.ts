import { NextRequest, NextResponse } from 'next/server';
import { buildWeekInReview } from '@/lib/analyticsBrief';
import { melbDate, dowMon0, addDays } from '@/lib/tz';
import { sendWhatsApp, allowedNumbers, senderRole } from '@/lib/whatsapp';

export const maxDuration = 30;

// Last completed Mon–Sun week start (Melbourne time, DST-safe), as a YYYY-MM-DD Monday.
function lastCompletedMonday(): string {
  const today = melbDate(0);
  return addDays(today, -dowMon0(today) - 7);
}

// Copy-paste week-in-review for the owner. ?week=YYYY-MM-DD picks a week (defaults to last
// completed); ?dry=1 returns the text without sending.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const week = url.searchParams.get('week') || lastCompletedMonday();
  const body = await buildWeekInReview(week);

  if (url.searchParams.get('dry')) return NextResponse.json({ ok: true, dry: true, week, preview: body });

  const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
  let sent = 0;
  for (const to of owners) { if (await sendWhatsApp(to, body)) sent++; }
  return NextResponse.json({ ok: true, week, sent, recipients: owners.length, preview: body });
}

export const GET = handle;
export const POST = handle;
