import { NextRequest, NextResponse } from 'next/server';
import { getDashboard } from '@/lib/analyticsDashboard';
import { weekMetrics } from '@/lib/analyticsBrief';

export const maxDuration = 120;

// Consistency probe: computes the dashboard period AND the master-row metrics for a week and
// reports the deltas — proves the two screens agree. ?week=YYYY-MM-DD (a Monday). Cron-guarded.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const week = url.searchParams.get('week') || '2026-06-01';
  const end = new Date(Date.parse(week + 'T00:00:00Z') + 7 * 86400_000).toISOString().slice(0, 10);
  const [dash, master] = await Promise.all([getDashboard(week, end, 'last'), weekMetrics(week)]);
  const c = dash.current;
  return NextResponse.json({
    ok: true, week,
    master: master ? { online: master.online, total: master.total, net: master.net } : null,
    dashboard: { online: c.online, total: c.sales_total, net: c.net_profit, cogs: c.cogs, cogs_real: c.cogs_real, ad_spend: c.ad_spend, shipbob: c.shipbob, wages: c.wages },
    delta_net: master ? Math.round(Math.abs(master.net - c.net_profit) * 100) / 100 : null,
  });
}

export const GET = handle;
export const POST = handle;
