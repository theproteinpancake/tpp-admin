// Sales review (daily + weekly) — ONE metric set, ONE net-profit formula, ONE format.
// Weekly reads the verified sales_week master row; daily computes the same metrics fresh from
// the same real sources (Shopify orders + COGS, Meta incrementality, attribution, ShipBob,
// wholesale). Net profit = online gross + wholesale margin − ad spend − ShipBob − payment fees
// − wages. Sent via the tpp_sales_review template (delivers any time) with free-form fallback.
import { supabaseLogistics } from './supabase-logistics';
import { getAssumptions, shopifyOrders, shopifyWeekCOGS } from './analytics';
import { fetchMetaWeek, fetchMetaWeekByMarket } from './meta';
import { sendWhatsApp, sendWhatsAppTemplate, allowedNumbers, senderRole, hasOpenSession, verifyRecentDelivery, recentMessagesTo } from './whatsapp';
import { gmailCreateDraft, gmailSendDraft } from './google';
import { getConfig, setConfig } from './settings';
import { getTemplateSid } from './waTemplates';
import { recordProactiveContext } from './stockAgent';
import { melbDate, melbMidnightUtc, dowMon0, addDays } from './tz';
import { fetchAmazonDaily } from './amazonSp';
import { cashBriefLine } from './cashflow';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface MarketMetrics {
  label: string; flag: string;
  online: number; orders: number; aov: number | null; cr: number | null;
  amazon: number; spend: number; roas: number | null; cpa: number | null;
}
export interface ReviewMetrics {
  kind: 'day' | 'week'; period: string;
  online: number; orders: number; aov: number; cr: number | null;
  wholesale: number; amazon: number; amazon_detail?: string | null; total: number;
  roas: number | null; cpa: number | null; nc_roas: number | null; nc_cpa: number | null;
  net: number;
  cost_warning?: string | null;
  markets?: MarketMetrics[];
  // Spend on campaigns that span BOTH markets (e.g. catalog retargeting AU, NZ, UK) and so can't
  // be assigned to either. Disclosed rather than dropped — otherwise the per-market ROAS looks
  // better than reality because some of the spend simply vanished from the split.
  unsplit_spend?: number;
}
const nn = (v: any) => Number(v) || 0;
const d0 = (v: number | null) => v == null ? '—' : (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-AU');
const d2 = (v: number | null) => v == null ? '—' : '$' + Number(v).toFixed(2);
const xx = (v: number | null) => v == null ? '—' : `${Number(v).toFixed(2)}×`;
const pc = (v: number | null) => v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`;
const fmtLong = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const fmtDow = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });

// The team-chat freeform layout (Luke's format). Used in-window + as the template fallback.
export function reviewText(m: ReviewMetrics): string {
  return [
    m.kind === 'week' ? `Here's TPP's week in review 🥞` : `Here's TPP's day in review 🥞`,
    m.period,
    ``,
    `${d0(m.online)} online`,
    `AOV ${d2(m.aov)}`,
    ...(m.cr != null ? [`CR ${pc(m.cr)}`] : []),
    `${m.orders} orders`,
    `${d0(m.wholesale)} wholesale`,
    `${d0(m.amazon)} amazon${m.amazon_detail ? ` (${m.amazon_detail})` : ''}`,
    `Total sales ${d0(m.total)}`,
    ``,
    `ROAS ${xx(m.roas)}`,
    `CPA ${d2(m.cpa)}`,
    `NC ROAS ${xx(m.nc_roas)}`,
    `NC CPA ${d2(m.nc_cpa)}`,
    ``,
    `Net profit ${d0(m.net)}`,
    ...(m.cost_warning ? [m.cost_warning] : []),
    // Per-market split (weekly only). Shopify revenue by billing country, Meta efficiency by
    // campaign geo — the two markets are bought separately, so a blended ROAS hides that UK
    // runs at roughly half AU/NZ's on double the CPM.
    ...(m.markets?.length ? ['', 'By market', ...m.markets.map((k) =>
      `${k.flag} ${k.label} ${d0(k.online)} · ${k.orders} orders · AOV ${d2(k.aov)}`
      + (k.cr != null ? ` · CR ${pc(k.cr)}` : '')
      + (k.roas != null ? ` · ROAS ${xx(k.roas)}` : '')
      + (k.cpa != null ? ` · CPA ${d2(k.cpa)}` : '')),
      ...(m.unsplit_spend ? [`(+ ${d0(m.unsplit_spend)} spend on AU/NZ+UK campaigns, not split)`] : []),
    ] : []),
  ].join('\n');
}

// Single-line variables for the tpp_sales_review WhatsApp template (no newlines allowed in vars).
export function reviewVars(m: ReviewMetrics): Record<string, string> {
  return {
    '1': `${m.kind === 'week' ? 'Week' : 'Daily'} · ${m.period}`,
    '2': `${d0(m.online)} · ${m.orders} orders · AOV ${d2(m.aov)}${m.cr != null ? ` · CR ${pc(m.cr)}` : ''}`,
    '3': `${d0(m.wholesale)} wholesale · ${d0(m.amazon)} amazon${m.amazon_detail ? ` (${m.amazon_detail})` : ''} · ${d0(m.total)} total`,
    '4': `ROAS ${xx(m.roas)} · CPA ${d2(m.cpa)} · NC ROAS ${xx(m.nc_roas)} · NC CPA ${d2(m.nc_cpa)}`
      + (m.markets?.length ? ` · ${m.markets.filter((k) => k.roas != null).map((k) => `${k.label} ${xx(k.roas)}`).join(' · ')}` : ''),
    '5': d0(m.net),
  };
}

/**
 * Per-market breakdown for the weekly review — AU/NZ and UK, our two live markets.
 *
 * Revenue and orders come from the real order rows (billing country), NOT from sales_week, which
 * only stores NZ and UK sub-totals and has no AU line. Ad efficiency comes from Meta at campaign
 * level, bucketed by the market in the campaign name.
 *
 * CR is shown only where it is actually stored (uk_cr): there is no per-market session count for
 * AU, and inventing one would put a number next to a market that nothing measures.
 */
export async function marketBreakdown(weekStart: string): Promise<{ markets: MarketMetrics[]; unsplit_spend: number }> {
  const end = addDays(weekStart, 6);
  const a = await getAssumptions();
  const [{ data: orders }, { data: row }] = await Promise.all([
    supabaseLogistics.from('shopify_order').select('country,total,created_at')
      .gte('created_at', melbMidnightUtc(weekStart))
      .lt('created_at', melbMidnightUtc(addDays(end, 1))),
    supabaseLogistics.from('sales_week').select('uk_cr,amazon_sales_au,amazon_sales_uk').eq('week_start', weekStart).maybeSingle(),
  ]);

  const GROUPS: { key: string; label: string; flag: string; countries: string[] }[] = [
    { key: 'AUNZ', label: 'AU/NZ', flag: '🇦🇺', countries: ['AU', 'NZ'] },
    { key: 'UK', label: 'UK', flag: '🇬🇧', countries: ['GB', 'UK'] },
  ];

  let meta: Awaited<ReturnType<typeof fetchMetaWeekByMarket>> = null;
  try { meta = await fetchMetaWeekByMarket(weekStart, addDays(end, 1)); } catch { /* efficiency is optional; sales still report */ }

  const markets = GROUPS.map((g) => {
    const mine = (orders ?? []).filter((o: any) => g.countries.includes(String(o.country || '').toUpperCase()));
    const online = mine.reduce((sum: number, o: any) => sum + nn(o.total), 0);
    const mk = meta ? (meta as any)[g.key] : null;
    const amazon = g.key === 'UK'
      ? nn(row?.amazon_sales_uk) * (a.fx_gbp_aud || 1)   // stored in GBP
      : nn(row?.amazon_sales_au);
    return {
      label: g.label, flag: g.flag,
      online: r2(online), orders: mine.length,
      aov: mine.length ? r2(online / mine.length) : null,
      cr: g.key === 'UK' && row?.uk_cr != null ? nn(row.uk_cr) : null,
      amazon: r2(amazon),
      spend: mk ? mk.spend : 0,
      roas: mk?.roas ?? null,
      cpa: mk?.cpa ?? null,
    };
  });
  return { markets, unsplit_spend: meta ? r2((meta as any).OTHER?.spend || 0) : 0 };
}

// Weekly metrics from the verified master row.
export async function weekMetrics(weekStart: string): Promise<ReviewMetrics | null> {
  const a = await getAssumptions();
  const { data: r } = await supabaseLogistics.from('sales_week').select('*').eq('week_start', weekStart).maybeSingle();
  if (!r) return null;
  const online = nn(r.online_sales), wholesale = nn(r.wholesale_invoices);
  // A week with hundreds of orders and $0 fulfilment cost is a broken pipeline, not a free
  // week: on 10-16 Aug the ShipBob cost sync had died (legacy API cut-off) and the review
  // announced net profit $9,048 when the real figure was $1,397. Surface it, loudly.
  const shipbobMissing = nn(r.orders) > 20 && nn(r.shipbob_charges) <= 0;
  // amazon_sales is a DERIVED total and is null on the stored row — AU and UK are the stored
  // fields (UK in GBP). Reading the null column is why the review said "$0 amazon (AU $619 ·
  // UK $211)": the detail read the real fields while the headline and the sales total didn't.
  const amazon = nn(r.amazon_sales_au) + nn(r.amazon_sales_uk) * (a.fx_gbp_aud || 1);
  const adSpend = nn(r.meta_spend) + nn(r.google_spend) + nn(r.amazon_spend);
  const net = nn(r.gross_profit) + wholesale * a.wholesale_margin - adSpend - nn(r.shipbob_charges) - online * a.payment_fee_pct - (a.wages_per_day || 0) * 7;
  const end = addDays(weekStart, 6);
  return {
    kind: 'week', period: `${fmtLong(weekStart)} – ${fmtLong(end)}`,
    online, orders: nn(r.orders), aov: nn(r.aov), cr: r.cr != null ? nn(r.cr) : null,
    wholesale, amazon, total: online + wholesale + amazon,
    amazon_detail: (r.amazon_sales_au != null || r.amazon_sales_uk != null) ? `AU ${d0(nn(r.amazon_sales_au))} · UK £${Math.round(nn(r.amazon_sales_uk)).toLocaleString('en-AU')}` : null,
    roas: r.meta_roas != null ? nn(r.meta_roas) : null, cpa: r.meta_cpa != null ? nn(r.meta_cpa) : null,
    nc_roas: r.meta_nc_roas != null ? nn(r.meta_nc_roas) : null, nc_cpa: r.meta_nc_cpa != null ? nn(r.meta_nc_cpa) : null,
    net,
    cost_warning: shipbobMissing ? '⚠️ ShipBob fulfilment costs are MISSING for this week (sync issue) — net profit is overstated by roughly the week\'s shipping bill. Treat the profit figure as broken until the cost sync is fixed.' : null,
    ...(await marketBreakdown(weekStart).then((b) => ({ markets: b.markets, unsplit_spend: b.unsplit_spend })).catch(() => ({}))),
  };
}

// Daily metrics computed fresh from the same real sources (CR omitted — no daily sessions source).
export async function dayMetrics(date: string): Promise<ReviewMetrics> {
  const a = await getAssumptions();
  const next = addDays(date, 1);
  const fromTs = melbMidnightUtc(date);
  const toTs = melbMidnightUtc(next);
  const daysBack = Math.max(2, Math.ceil((Date.now() - new Date(date + 'T00:00:00').getTime()) / 86400_000) + 1);
  const [shop, cogsRes, meta, sb, wh, roll, amz] = await Promise.all([
    shopifyOrders(date, next).catch(() => null),
    shopifyWeekCOGS(date, next).catch(() => null),
    fetchMetaWeek(date, next).catch(() => null),
    supabaseLogistics.from('shipment_costs').select('cost,currency').gte('ship_date', date).lt('ship_date', next),
    supabaseLogistics.from('wholesale_orders').select('total').gte('order_date', date).lt('order_date', next),
    Promise.resolve(supabaseLogistics.rpc('attribution_rollup', { p_from: fromTs, p_to: toTs, p_model: 'last' })).then((r: any) => r.data).catch(() => null),
    fetchAmazonDaily(Math.min(daysBack, 30)).catch(() => null),
  ]);
  const online = nn(shop?.online_sales);
  const cogs = cogsRes?.cogs != null ? cogsRes.cogs : online * a.online_cogs_pct;
  const wholesale = (wh.data ?? []).reduce((s: number, o: any) => s + nn(o.total), 0);
  const shipbob = (sb.data ?? []).reduce((s: number, o: any) => s + (/gbp/i.test(o.currency || '') ? nn(o.cost) * a.fx_gbp_aud : nn(o.cost)), 0);
  const m = ((roll ?? []) as any[]).find((x) => x.source === 'meta');
  const ncRev = m ? nn(m.nc_revenue) : 0, ncOrd = m ? nn(m.nc_orders) : 0;
  const adSpend = nn(meta?.spend);
  // Amazon for THIS calendar day (Melbourne) — the report runs for yesterday, so the day is
  // complete by send time (was hardcoded 0 before; a $209 Saturday reported as $0 amazon).
  const amzRow = amz?.rows.find((x) => x.date === date);
  const amazon = amzRow ? r2(amzRow.au_sales + amzRow.uk_sales_gbp * a.fx_gbp_aud) : 0;
  const amazon_detail = amzRow && (amzRow.au_sales > 0 || amzRow.uk_sales_gbp > 0)
    ? `AU ${d0(amzRow.au_sales)}${amzRow.uk_sales_gbp > 0 ? ` · UK £${amzRow.uk_sales_gbp}` : ' · UK £0'}`
    : null;
  const net = (online - cogs) + wholesale * a.wholesale_margin - adSpend - shipbob - online * a.payment_fee_pct - (a.wages_per_day || 0);
  return {
    kind: 'day', period: fmtDow(date),
    online, orders: nn(shop?.orders), aov: nn(shop?.aov), cr: null,
    wholesale, amazon, amazon_detail, total: online + wholesale + amazon,
    roas: meta?.roas ?? null, cpa: meta?.cpa ?? null,
    // Prefer Meta incrementality for NC (most accurate); fall back to click attribution.
    nc_roas: meta && meta.inc_conversions > 0 ? meta.nc_roas : (adSpend ? r2(ncRev / adSpend) : null),
    nc_cpa: meta && meta.inc_conversions > 0 ? meta.nc_cpa : (ncOrd ? r2(adSpend / ncOrd) : null),
    net,
  };
}

// SAFETY NET (runs on the 15-min followups cron): if a sales review went out in the last few
// hours and EVERY copy died inside WhatsApp (Meta kills accepted sends async: 63049 marketing
// cap, 63016 out-of-session, incl. runs cut off by the 60s runtime cap before their own email
// fallback), email the review body so the owner still gets the numbers. Once per day.
export async function repairReviewDelivery(): Promise<{ repaired: boolean; reason?: string }> {
  const today = melbDate(0);
  const doneKey = `review_email_fallback:${today}`; // shared with the in-ladder email fallback
  if (await getConfig(doneKey)) return { repaired: false, reason: 'review already emailed today' };
  const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
  const isReview = (b: string) => /day in review|week in review|TPP account report|TPP sales review/i.test(b);
  for (const to of owners) {
    const msgs = (await recentMessagesTo(to, 15)).filter((m) => isReview(m.body) && Date.now() - new Date(m.date).getTime() < 4 * 3600_000);
    if (!msgs.length) continue;                                       // nothing sent recently
    if (msgs.some((m) => !['undelivered', 'failed'].includes(m.status))) continue; // at least one copy alive (or still pending)
    const body = msgs.find((m) => m.body.length > 80)?.body || msgs[0].body;
    try {
      const adminEmail = (await getConfig('admin_email')) || 'luke@theproteinpancake.co';
      await setConfig(doneKey, new Date().toISOString()); // claim before sending — never duplicate
      const draftId = await gmailCreateDraft(adminEmail, 'TPP sales review — WhatsApp delivery blocked', `${body}\n\n(Emailed because every WhatsApp copy was refused — Meta template/session limits. Numbers are also on the dashboard.)`);
      await gmailSendDraft(draftId);
      return { repaired: true };
    } catch (e) { return { repaired: false, reason: String(e).slice(0, 120) }; }
  }
  return { repaired: false };
}

// The copy-paste week-in-review (used by /api/whatsapp/week-in-review).
export async function buildWeekInReview(weekStart: string): Promise<string> {
  const m = await weekMetrics(weekStart);
  return m ? reviewText(m) : `No data for the week of ${weekStart} yet.`;
}

// Send the daily (yesterday) or weekly (last completed Mon–Sun) sales review to the owner(s),
// via the approved template (delivers any time) with a free-form fallback when in-window.
export async function sendSalesReview(kind: 'daily' | 'weekly'): Promise<{ sent: number; kind: string; text: string }> {
  let m: ReviewMetrics | null;
  if (kind === 'weekly') {
    const today = melbDate(0);
    const lastMon = addDays(today, -dowMon0(today) - 7);
    m = await weekMetrics(lastMon);
  } else {
    m = await dayMetrics(melbDate(-1));
  }
  if (!m) return { sent: 0, kind, text: 'no data' };
  // owner extras: weekly target tracking + the cash position line (owner-only recipients anyway)
  let extra = '';
  if (kind === 'weekly') {
    const a = await getAssumptions();
    if (a.weekly_target_sales) extra += `\n\nTarget: sales ${m.total >= a.weekly_target_sales ? '✅' : '⚠️'} $${Math.round(m.total).toLocaleString('en-AU')}/$${a.weekly_target_sales.toLocaleString('en-AU')} · profit ${m.net >= (a.weekly_target_np || 0) ? '✅' : '⚠️'} $${Math.round(m.net).toLocaleString('en-AU')}/$${(a.weekly_target_np || 0).toLocaleString('en-AU')}`;
    const cash = await cashBriefLine();
    if (cash) extra += `\n💰 ${cash}`;
  }
  const text = reviewText(m) + extra;
  const vars = reviewVars(m);
  if (extra) vars['5'] = `${vars['5']} · ${extra.replace(/\n+/g, ' · ').replace(/ · +/g, ' · ').trim()}`.slice(0, 550);
  // Template preference: tpp_daily_report (utility-worded — Meta re-categorised the original
  // tpp_sales_review as MARKETING, whose per-user cap silently drops sends, error 63049),
  // falling back to the old template until the new one is approved.
  const sid = (await getTemplateSid('tpp_daily_report')) || (await getTemplateSid('tpp_sales_review'));
  const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
  let sent = 0;
  const delivery: string[] = [];
  for (const to of owners) {
    // VERIFIED LADDER: Twilio accepts sends Meta later kills silently (63049 marketing cap /
    // 63016 out-of-session), so each channel is checked for ACTUAL delivery before trusting it.
    // In-session: free-form first (no caps). Out-of-session: template first. Email = the
    // never-fails last resort so the owner is never left without their numbers again.
    const inSession = await hasOpenSession(to).catch(() => false);
    const channels: (() => Promise<boolean | string>)[] = inSession
      ? [() => sendWhatsApp(to, text), ...(sid ? [() => sendWhatsAppTemplate(to, sid!, vars)] : [])]
      : [...(sid ? [() => sendWhatsAppTemplate(to, sid!, vars)] : []), () => sendWhatsApp(to, text)];
    let ok = false;
    for (const attempt of channels) {
      if (!(await attempt())) continue;
      await new Promise((r) => setTimeout(r, 12_000)); // Meta surfaces 63016/63049 within seconds; runtime is capped at 60s so waits must be short
      const v = await verifyRecentDelivery(to, 20_000);
      if (v.ok) { ok = true; break; }
      delivery.push(`${to}: dropped (${v.status}${v.error_code ? ` ${v.error_code}` : ''}) — trying next channel`);
    }
    if (!ok) {
      // WhatsApp fully blocked → email the review so the numbers still arrive. ONCE per day
      // across every path (this fallback + the repair sweep share the guard key): overlapping
      // invocations each emailed on 11 Jul — the 60s runtime "kill" only cuts the connection,
      // the function keeps running, so two test runs both completed their ladders.
      const guardKey = `review_email_fallback:${melbDate(0)}`;
      if (await getConfig(guardKey)) {
        delivery.push(`${to}: WhatsApp blocked — review already emailed today, not duplicating`);
        ok = true;
      } else {
        try {
          await setConfig(guardKey, new Date().toISOString()); // claim BEFORE sending — a dupe email is worse than a rare miss
          const adminEmail = (await getConfig('admin_email')) || 'luke@theproteinpancake.co';
          const draftId = await gmailCreateDraft(adminEmail, `TPP ${kind} sales review — WhatsApp delivery blocked`, `${text}\n\n(Sent by email because WhatsApp refused delivery — likely Meta's per-user template cap. The numbers are also on the dashboard.)`);
          await gmailSendDraft(draftId);
          delivery.push(`${to}: WhatsApp blocked — emailed ${adminEmail} instead`);
          ok = true;
        } catch (e) { delivery.push(`${to}: WhatsApp AND email failed: ${String(e).slice(0, 100)}`); }
      }
    }
    if (ok) { sent++; await recordProactiveContext(to, `This is the ${kind.toUpperCase()} SALES REVIEW I just sent. If the user replies about it, respond about THESE numbers:\n${text}`).catch(() => {}); }
  }
  return { sent, kind, text, ...(delivery.length ? { delivery } : {}) };
}
