// Sales review (daily + weekly) — ONE metric set, ONE net-profit formula, ONE format.
// Weekly reads the verified sales_week master row; daily computes the same metrics fresh from
// the same real sources (Shopify orders + COGS, Meta incrementality, attribution, ShipBob,
// wholesale). Net profit = online gross + wholesale margin − ad spend − ShipBob − payment fees
// − wages. Sent via the tpp_sales_review template (delivers any time) with free-form fallback.
import { supabaseLogistics } from './supabase-logistics';
import { getAssumptions, shopifyOrders, shopifyWeekCOGS } from './analytics';
import { fetchMetaWeek } from './meta';
import { sendWhatsApp, sendWhatsAppTemplate, allowedNumbers, senderRole, hasOpenSession, verifyRecentDelivery, recentMessagesTo } from './whatsapp';
import { gmailCreateDraft, gmailSendDraft } from './google';
import { getConfig, setConfig } from './settings';
import { getTemplateSid } from './waTemplates';
import { recordProactiveContext } from './stockAgent';
import { melbDate, melbMidnightUtc, dowMon0, addDays } from './tz';
import { cashBriefLine } from './cashflow';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ReviewMetrics {
  kind: 'day' | 'week'; period: string;
  online: number; orders: number; aov: number; cr: number | null;
  wholesale: number; amazon: number; total: number;
  roas: number | null; cpa: number | null; nc_roas: number | null; nc_cpa: number | null;
  net: number;
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
    `${d0(m.amazon)} amazon`,
    `Total sales ${d0(m.total)}`,
    ``,
    `ROAS ${xx(m.roas)}`,
    `CPA ${d2(m.cpa)}`,
    `NC ROAS ${xx(m.nc_roas)}`,
    `NC CPA ${d2(m.nc_cpa)}`,
    ``,
    `Net profit ${d0(m.net)}`,
  ].join('\n');
}

// Single-line variables for the tpp_sales_review WhatsApp template (no newlines allowed in vars).
export function reviewVars(m: ReviewMetrics): Record<string, string> {
  return {
    '1': `${m.kind === 'week' ? 'Week' : 'Daily'} · ${m.period}`,
    '2': `${d0(m.online)} · ${m.orders} orders · AOV ${d2(m.aov)}${m.cr != null ? ` · CR ${pc(m.cr)}` : ''}`,
    '3': `${d0(m.wholesale)} wholesale · ${d0(m.total)} total`,
    '4': `ROAS ${xx(m.roas)} · CPA ${d2(m.cpa)} · NC ROAS ${xx(m.nc_roas)} · NC CPA ${d2(m.nc_cpa)}`,
    '5': d0(m.net),
  };
}

// Weekly metrics from the verified master row.
export async function weekMetrics(weekStart: string): Promise<ReviewMetrics | null> {
  const a = await getAssumptions();
  const { data: r } = await supabaseLogistics.from('sales_week').select('*').eq('week_start', weekStart).maybeSingle();
  if (!r) return null;
  const online = nn(r.online_sales), wholesale = nn(r.wholesale_invoices), amazon = nn(r.amazon_sales);
  const adSpend = nn(r.meta_spend) + nn(r.google_spend) + nn(r.amazon_spend);
  const net = nn(r.gross_profit) + wholesale * a.wholesale_margin - adSpend - nn(r.shipbob_charges) - online * a.payment_fee_pct - (a.wages_per_day || 0) * 7;
  const end = addDays(weekStart, 6);
  return {
    kind: 'week', period: `${fmtLong(weekStart)} – ${fmtLong(end)}`,
    online, orders: nn(r.orders), aov: nn(r.aov), cr: r.cr != null ? nn(r.cr) : null,
    wholesale, amazon, total: online + wholesale + amazon,
    roas: r.meta_roas != null ? nn(r.meta_roas) : null, cpa: r.meta_cpa != null ? nn(r.meta_cpa) : null,
    nc_roas: r.meta_nc_roas != null ? nn(r.meta_nc_roas) : null, nc_cpa: r.meta_nc_cpa != null ? nn(r.meta_nc_cpa) : null,
    net,
  };
}

// Daily metrics computed fresh from the same real sources (CR omitted — no daily sessions source).
export async function dayMetrics(date: string): Promise<ReviewMetrics> {
  const a = await getAssumptions();
  const next = addDays(date, 1);
  const fromTs = melbMidnightUtc(date);
  const toTs = melbMidnightUtc(next);
  const [shop, cogsRes, meta, sb, wh, roll] = await Promise.all([
    shopifyOrders(date, next).catch(() => null),
    shopifyWeekCOGS(date, next).catch(() => null),
    fetchMetaWeek(date, next).catch(() => null),
    supabaseLogistics.from('shipment_costs').select('cost,currency').gte('ship_date', date).lt('ship_date', next),
    supabaseLogistics.from('wholesale_orders').select('total').gte('order_date', date).lt('order_date', next),
    Promise.resolve(supabaseLogistics.rpc('attribution_rollup', { p_from: fromTs, p_to: toTs, p_model: 'last' })).then((r: any) => r.data).catch(() => null),
  ]);
  const online = nn(shop?.online_sales);
  const cogs = cogsRes?.cogs != null ? cogsRes.cogs : online * a.online_cogs_pct;
  const wholesale = (wh.data ?? []).reduce((s: number, o: any) => s + nn(o.total), 0);
  const shipbob = (sb.data ?? []).reduce((s: number, o: any) => s + (/gbp/i.test(o.currency || '') ? nn(o.cost) * a.fx_gbp_aud : nn(o.cost)), 0);
  const m = ((roll ?? []) as any[]).find((x) => x.source === 'meta');
  const ncRev = m ? nn(m.nc_revenue) : 0, ncOrd = m ? nn(m.nc_orders) : 0;
  const adSpend = nn(meta?.spend);
  const net = (online - cogs) + wholesale * a.wholesale_margin - adSpend - shipbob - online * a.payment_fee_pct - (a.wages_per_day || 0);
  return {
    kind: 'day', period: fmtDow(date),
    online, orders: nn(shop?.orders), aov: nn(shop?.aov), cr: null,
    wholesale, amazon: 0, total: online + wholesale,
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
    const channels: (() => Promise<boolean>)[] = inSession
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
