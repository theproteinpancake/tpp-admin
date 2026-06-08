import { NextRequest, NextResponse } from 'next/server';
import { autofillWeek, mondayOf } from '@/lib/analytics';

export const maxDuration = 120;

// Auto-fill the API-owned fields for a specific week, or the last N weeks (default 4).
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret');
  // browser calls pass the auth cookie (middleware); cron passes the secret
  if (given && secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch { /* GET or empty */ }
  const url = new URL(req.url);
  const weekParam = body.week || url.searchParams.get('week');
  const n = Number(body.weeks || url.searchParams.get('weeks') || 4);

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const weeks: string[] = [];
  if (weekParam) {
    weeks.push(iso(mondayOf(new Date(weekParam + 'T00:00:00'))));
  } else {
    const thisMon = mondayOf(new Date());
    for (let i = 0; i < Math.min(Math.max(n, 1), 12); i++) weeks.push(iso(new Date(thisMon.getTime() - i * 7 * 86400_000)));
  }
  const results = [];
  for (const w of weeks) results.push(await autofillWeek(w).catch((e) => ({ week_start: w, error: String(e).slice(0, 160) })));
  return NextResponse.json({ ok: true, results });
}

export const POST = handle;
export const GET = handle;
