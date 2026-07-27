import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { fetchMetaWeek } from '@/lib/meta';
import { fetchAmazonDaily } from '@/lib/amazonSp';
import { getSalesForecast } from '@/lib/forecast';
import { getTemplateSid } from '@/lib/waTemplates';
import { sendWhatsApp, sendWhatsAppTemplate, allowedNumbers, senderRole } from '@/lib/whatsapp';
import { melbDate, melbLongDate, addDays, dowMon0, melbHour } from '@/lib/tz';
import { getConfig, setConfig } from '@/lib/settings';

export const maxDuration = 120;

// Anomaly watchdog (every ~3h during the day): catches trouble you'd otherwise only see by
// opening dashboards — sales pacing vs forecast, CPA spikes, stockouts arriving before their
// PO. Alerts dedupe per check per day (one ping, not one every 3 hours).

type Issue = { key: string; label: string; detail: string };

async function checks(): Promise<Issue[]> {
  const issues: Issue[] = [];
  const today = melbDate(0);

  // 1. Yesterday vs forecast — alert when a full day lands far under its forecast week share.
  try {
    const fc = await getSalesForecast();
    const y = melbDate(-1);
    const yMon = addDays(y, -dowMon0(y));
    const wk = fc.series.find((p) => p.week === yMon);
    const weekly = wk?.forecast ?? wk?.actual ?? null;
    if (weekly && weekly > 5000) {
      const { data } = await supabaseLogistics.rpc('forecast_weekly_sales', { p_weeks: 2 });
      const cur = ((data ?? []) as any[]).find((w) => w.week_start === yMon);
      // crude day share: revenue so far this week vs expected share by day-of-week elapsed
      const daysElapsed = dowMon0(today) || 7;
      const expected = (weekly / 7) * daysElapsed;
      const actual = Number(cur?.revenue) || 0;
      if (expected > 0 && actual < expected * 0.6) {
        issues.push({ key: `pacing:${today}`, label: 'Sales pacing well under forecast', detail: `Week-to-date $${Math.round(actual).toLocaleString()} vs ~$${Math.round(expected).toLocaleString()} expected by now (forecast $${Math.round(weekly).toLocaleString()}/wk).` });
      }
    }
  } catch { /* best-effort */ }

  // 2. Meta CPA spike — yesterday vs trailing 14d.
  try {
    const [yday, base] = await Promise.all([
      fetchMetaWeek(melbDate(-1), today),
      fetchMetaWeek(melbDate(-15), melbDate(-1)),
    ]);
    if (yday && base && yday.spend > 200 && yday.cpa && base.cpa && yday.cpa > base.cpa * 1.5) {
      issues.push({ key: `cpa:${today}`, label: 'Meta CPA spiked', detail: `Yesterday $${yday.cpa.toFixed(2)} vs $${base.cpa.toFixed(2)} 14-day average on $${Math.round(yday.spend)} spend.` });
    }
  } catch { /* best-effort */ }

  // 3. Stockout before replenishment — primary SKU under 14d cover with NO open PO/transfer units inbound.
  try {
    const { data: rows } = await supabaseLogistics.from('v_stock_current')
      .select('sku, flavour, unit_size_g, location_code, tier, days_of_cover, inbound, available')
      .eq('active', true).eq('tier', 'primary');
    const hot = ((rows ?? []) as any[]).filter((r) => r.days_of_cover != null && r.days_of_cover > 0 && r.days_of_cover <= 14 && (Number(r.inbound) || 0) === 0);
    for (const r of hot.slice(0, 4)) {
      const size = r.unit_size_g >= 1000 ? `${r.unit_size_g / 1000}kg` : `${r.unit_size_g}g`;
      issues.push({ key: `stockout:${r.sku}:${r.location_code}`, label: `${r.flavour} ${size} stocking out (${r.location_code === 'ALTONA' ? 'AU' : 'UK'})`, detail: `${Math.round(r.days_of_cover)}d cover, nothing inbound — needs a PO/transfer now.` });
    }
  } catch { /* best-effort */ }

  // 4. Amazon market health — AU vs UK, complete days only (today excluded). Two triggers:
  // a market that flatlines for 3+ days after having sales, or a week-on-week collapse.
  try {
    const amz = await fetchAmazonDaily(15);
    if (amz) {
      const complete = amz.rows.filter((r) => r.date < today);
      for (const mkt of ['AU', 'UK'] as const) {
        const val = (r: any) => (mkt === 'AU' ? r.au_sales : r.uk_sales_gbp);
        const ords = (r: any) => (mkt === 'AU' ? r.au_orders : r.uk_orders);
        const cur = mkt === 'AU' ? '$' : '£';
        const last7 = complete.slice(-7), prior7 = complete.slice(-14, -7);
        const sum = (rows: any[], f: (r: any) => number) => rows.reduce((a, r) => a + f(r), 0);
        let streak = 0;
        for (let i = complete.length - 1; i >= 0 && val(complete[i]) === 0; i--) streak++;
        const priorOrders = sum(complete.slice(0, complete.length - streak), ords);
        if (streak >= 3 && priorOrders >= 3) {
          // Wording matters: quoting a "7d total" that still contained the LAST sale read as a
          // contradiction ("£0 since 21/07 ... UK £18"). Anchor on the last sale instead, and
          // compare the OTHER market over the same zero stretch.
          const lastSale = complete[complete.length - streak - 1];
          const streakRows = complete.slice(complete.length - streak);
          const otherLabel = mkt === 'AU' ? 'UK' : 'AU';
          const otherVal = (r: any) => (mkt === 'AU' ? r.uk_sales_gbp : r.au_sales);
          const otherCur = mkt === 'AU' ? '£' : '$';
          issues.push({ key: `amazon_zero:${mkt}`, label: `Amazon ${mkt}: no sales for ${streak} days`, detail: `Last ${mkt} sale was ${cur}${Math.round(val(lastSale))} on ${lastSale?.date}; nothing since. ${otherLabel} did ${otherCur}${Math.round(sum(streakRows, otherVal))} over those same ${streak} days. Check ${mkt} listings/Buy Box/stock.` });
        } else if (sum(prior7, val) >= 150 && sum(last7, val) < sum(prior7, val) * 0.4) {
          issues.push({ key: `amazon_drop:${mkt}`, label: `Amazon ${mkt} sales down sharply`, detail: `Last 7d ${cur}${Math.round(sum(last7, val))} vs ${cur}${Math.round(sum(prior7, val))} the week before (−${Math.round((1 - sum(last7, val) / sum(prior7, val)) * 100)}%).` });
        }
      }
    }
  } catch { /* best-effort */ }

  return issues;
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // daytime only (8am–9pm Melbourne) unless forced
  const dry = !!new URL(req.url).searchParams.get('dry');
  const h = melbHour();
  if (!dry && (h < 8 || h > 21)) return NextResponse.json({ ok: true, skipped: 'outside waking hours' });

  const found = await checks();
  // Dedupe: a PERSISTING condition (stockout, Amazon flatline) re-alerts WEEKLY, not daily —
  // Luke: "I don't like being spammed". Point-in-time checks self-date their keys, so they
  // still fire at most once per occurrence day.
  const seenRaw = await getConfig('watchdog_alerted');
  let seen: Record<string, string> = {};
  try { seen = seenRaw ? JSON.parse(seenRaw) : {}; } catch { seen = {}; }
  const today = melbDate(0);
  const weekAgo = melbDate(-7);
  const fresh = found.filter((i) => !seen[i.key] || seen[i.key] <= weekAgo);

  let sent = 0;
  if (fresh.length && !dry) {
    const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
    const sid = await getTemplateSid('tpp_system_alert');
    const what = `Watchdog: ${fresh.map((i) => i.label).join(' · ')}`.slice(0, 550); // the shared template header reads "system check" — label these so they're distinguishable
    const detail = fresh.map((i) => i.detail).join(' ').slice(0, 550);
    for (const to of owners) {
      let ok = false;
      if (sid) ok = await sendWhatsAppTemplate(to, sid, { '1': melbLongDate(), '2': what, '3': detail });
      if (!ok) ok = !!(await sendWhatsApp(to, `🚨 *Watchdog* — ${melbLongDate()}\n\n${fresh.map((i) => `• ${i.label} — ${i.detail}`).join('\n')}`));
      if (ok) sent++;
    }
    fresh.forEach((i) => { seen[i.key] = today; });
    // prune entries old enough to have re-alerted (keep the 7-day dedupe memory)
    for (const k of Object.keys(seen)) if (seen[k] <= weekAgo) delete seen[k];
    await setConfig('watchdog_alerted', JSON.stringify(seen)).catch(() => {});
  }
  return NextResponse.json({ ok: true, found, fresh: fresh.map((i) => i.key), alerted: sent, dry });
}

export const GET = handle;
export const POST = handle;
