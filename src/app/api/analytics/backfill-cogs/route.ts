import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { shopifyWeekCOGS, weekRange, mondayOf } from '@/lib/analytics';

export const maxDuration = 300;

// Compute REAL Shopify COGS per week (variant cost × units sold) and store it on sales_week
// (cogs + gross_profit = online_sales − cogs). ?dry=1 previews without storing. Target a
// single week with ?week=YYYY-MM-DD, or a span with ?weeks=N&offset=M (most recent first).
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const dry = !!url.searchParams.get('dry');
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const weeks: string[] = [];
  const weekParam = url.searchParams.get('week');
  if (weekParam) weeks.push(iso(mondayOf(new Date(weekParam + 'T00:00:00'))));
  else {
    const n = Math.min(Math.max(Number(url.searchParams.get('weeks') || 1), 1), 6);
    const offset = Number(url.searchParams.get('offset') || 0);
    const thisMon = mondayOf(new Date());
    for (let i = 0; i < n; i++) weeks.push(iso(new Date(thisMon.getTime() - (i + offset) * 7 * 86400_000)));
  }

  const results: any[] = [];
  for (const ws of weeks) {
    const { startIso, endIso } = weekRange(ws);
    const { data: row } = await supabaseLogistics.from('sales_week').select('online_sales, locked').eq('week_start', ws).maybeSingle();
    const online = Number(row?.online_sales) || 0;
    const c = await shopifyWeekCOGS(startIso, endIso).catch((e) => ({ _err: String(e) } as any));
    if (!c || (c as any)._err) { results.push({ week: ws, error: (c as any)?._err || 'cogs fetch failed' }); continue; }
    const gpm = online ? (online - c.cogs) / online : null;
    const out: any = { week: ws, online, cogs: c.cogs, gross_profit: Math.round((online - c.cogs) * 100) / 100, gpm: gpm != null ? `${(gpm * 100).toFixed(1)}%` : null, units: c.units, missing_units: c.missing_units };
    const locked: string[] = (row?.locked as string[]) || [];
    if (!dry && online && !locked.includes('gross_profit')) {
      await supabaseLogistics.from('sales_week').update({ cogs: c.cogs, gross_profit: out.gross_profit, updated_at: new Date().toISOString() }).eq('week_start', ws);
      out.stored = true;
    }
    results.push(out);
  }
  return NextResponse.json({ ok: true, dry, results });
}

export const GET = handle;
export const POST = handle;
