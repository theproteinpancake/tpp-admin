// Agent analytics briefings: a 7am daily snapshot (yesterday) and a Monday week-in-review,
// each with a short Claude-written insight (what moved + the biggest lever). Sent on WhatsApp.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { getAttribution } from './attribution';
import { getAssumptions, shopifyOrders, shopifyWeekCOGS } from './analytics';
import { fetchMetaWeek } from './meta';
import { sendWhatsApp, sendWhatsAppTemplate, allowedNumbers, senderRole } from './whatsapp';
import { getTemplateSid } from './waTemplates';
import { recordProactiveContext } from './stockAgent';

const AEST_OFFSET = '+10:00';
const money = (n: number | null | undefined) => n == null ? '—' : 'A$' + Math.round(n).toLocaleString('en-AU');
const pct = (n: number | null | undefined) => n == null ? '—' : `${(n * 100).toFixed(1)}%`;
const x = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(2)}×`;
const r2 = (n: number) => Math.round(n * 100) / 100;

// YYYY-MM-DD for (today + offsetDays) in AEST
function aestDate(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86400_000 + 10 * 3600_000);
  return now.toISOString().slice(0, 10);
}
const dayBounds = (date: string) => ({ from: new Date(`${date}T00:00:00${AEST_OFFSET}`).toISOString(), to: new Date(`${date}T00:00:00${AEST_OFFSET}`).toISOString() });
const niceDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

async function shipbobFor(dateFrom: string, dateTo: string, fx: number) {
  const { data } = await supabaseLogistics.from('shipment_costs').select('cost,currency').gte('ship_date', dateFrom).lt('ship_date', dateTo);
  return (data ?? []).reduce((s: number, o: any) => s + (/gbp/i.test(o.currency || '') ? (Number(o.cost) || 0) * fx : Number(o.cost) || 0), 0);
}

// Snapshot for a [fromDate, toDate) window (date strings, AEST).
async function snapshot(fromDate: string, toDate: string) {
  const a = await getAssumptions();
  const attr = await getAttribution(fromDate, toDate, 'last');
  const shipbob = await shipbobFor(fromDate, toDate, a.fx_gbp_aud);
  const t = attr.totals;
  const meta = attr.rows.find((r) => r.source === 'Meta');
  const online = t.revenue;
  const gp = online * (1 - a.online_cogs_pct);
  const adSpend = t.spend || 0;
  const np = gp - adSpend - shipbob - online * a.payment_fee_pct;
  return {
    online: r2(online), orders: t.orders, aov: t.aov, new_pct: t.new_pct,
    ad_spend: r2(adSpend), blended_roas: t.roas, np: r2(np), npm: online ? r2(np / online) : null,
    meta_spend: meta?.spend ?? null, meta_roas: meta?.roas ?? null, nc_roas: t.nc_roas,
    rows: attr.rows, shipbob: r2(shipbob),
  };
}

function delta(cur: number | null, prev: number | null): string {
  if (cur == null || prev == null || prev === 0) return '';
  const c = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return ` (${c >= 0 ? '▲' : '▼'}${Math.abs(c)}%)`;
}

async function insight(cur: any, prev: any, period: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return '';
  try {
    const client = new Anthropic({ apiKey: key });
    const channels = cur.rows.map((r: any) => `${r.source}: rev ${money(r.revenue)}, spend ${r.spend != null ? money(r.spend) : '-'}, ROAS ${x(r.roas)}, NC-ROAS ${x(r.nc_roas)}`).join('; ');
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 220,
      system: `You are TPP's sharp e-commerce analyst. In 2-3 short sentences, explain what drove ${period}'s result vs the prior ${period} and name the single biggest lever to improve net profit now. Be specific with numbers, no fluff, no preamble. Plain text for WhatsApp.`,
      messages: [{ role: 'user', content: `THIS ${period}: sales ${money(cur.online)}, net profit ${money(cur.np)} (${pct(cur.npm)}), orders ${cur.orders}, AOV ${money(cur.aov)}, new-customer ${pct(cur.new_pct)}, ad spend ${money(cur.ad_spend)}, blended ROAS ${x(cur.blended_roas)}.\nPREVIOUS ${period}: sales ${money(prev.online)}, net profit ${money(prev.np)}, orders ${prev.orders}, AOV ${money(prev.aov)}, ad spend ${money(prev.ad_spend)}, blended ROAS ${x(prev.blended_roas)}.\nChannels this ${period}: ${channels}.` }],
    });
    return resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim();
  } catch { return ''; }
}

export async function buildDailyBrief(): Promise<string> {
  const y = aestDate(-1), today = aestDate(0), prior = aestDate(-2);
  const [cur, prev] = await Promise.all([snapshot(y, today), snapshot(prior, y)]);
  const ins = await insight(cur, prev, 'day');
  const top = [...cur.rows].filter((r) => r.spend != null).sort((a, b) => (b.revenue) - (a.revenue))[0];
  return [
    `📊 *Daily snapshot* — ${niceDate(y)}`,
    `Sales ${money(cur.online)}${delta(cur.online, prev.online)}`,
    `Net profit ${money(cur.np)} · ${pct(cur.npm)} margin${delta(cur.np, prev.np)}`,
    `Orders ${cur.orders}${delta(cur.orders, prev.orders)} · AOV ${money(cur.aov)} · New ${pct(cur.new_pct)}`,
    `Ad spend ${money(cur.ad_spend)} · Blended ROAS ${x(cur.blended_roas)} · NC-ROAS ${x(cur.nc_roas)}`,
    top ? `Top paid channel: ${top.source} ${money(top.revenue)} @ ${x(top.roas)} ROAS` : '',
    ins ? `\n💡 ${ins}` : '',
    `\n_Full detail → Analytics tab_`,
  ].filter(Boolean).join('\n');
}

export async function buildWeeklyBrief(): Promise<string> {
  // last full Mon–Sun
  const todayAest = aestDate(0);
  const dow = (new Date(todayAest + 'T00:00:00').getDay() + 6) % 7; // Mon=0
  const thisMon = aestDate(-dow);
  const lastMon = aestDate(-dow - 7);
  const weekBefore = aestDate(-dow - 14);
  const [cur, prev] = await Promise.all([snapshot(lastMon, thisMon), snapshot(weekBefore, lastMon)]);
  const ins = await insight(cur, prev, 'week');
  const chRows = cur.rows.map((r: any) => `• ${r.source}: ${money(r.revenue)}${r.spend != null ? ` · ${x(r.roas)} ROAS · ${x(r.nc_roas)} NC` : ''}`).join('\n');
  return [
    `🗓️ *Week in review* — ${niceDate(lastMon)} to ${niceDate(aestDate(-dow - 1))}`,
    `Sales ${money(cur.online)}${delta(cur.online, prev.online)}`,
    `Net profit ${money(cur.np)} · ${pct(cur.npm)} margin${delta(cur.np, prev.np)}`,
    `Orders ${cur.orders}${delta(cur.orders, prev.orders)} · AOV ${money(cur.aov)} · New ${pct(cur.new_pct)}`,
    `Ad spend ${money(cur.ad_spend)} · Blended ROAS ${x(cur.blended_roas)} · NC-ROAS ${x(cur.nc_roas)}`,
    `\n*By channel:*\n${chRows}`,
    ins ? `\n💡 ${ins}` : '',
    `\n_Full breakdown → Analytics tab_`,
  ].filter(Boolean).join('\n');
}

// ---- Sales review (daily + weekly) — ONE metric set, ONE net-profit formula, ONE format ----
// Weekly reads the verified sales_week master row; daily computes the same metrics fresh from
// the same real sources (Shopify orders + COGS, Meta, attribution, ShipBob, wholesale). Net
// profit = online gross + wholesale margin − ad spend − ShipBob − payment fees − wages.
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
  const end = new Date(Date.parse(weekStart + 'T00:00:00Z') + 6 * 86400_000).toISOString().slice(0, 10);
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
  const next = new Date(Date.parse(date + 'T00:00:00Z') + 86400_000).toISOString().slice(0, 10);
  const fromTs = new Date(`${date}T00:00:00+10:00`).toISOString();
  const toTs = new Date(`${next}T00:00:00+10:00`).toISOString();
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
    nc_roas: adSpend ? r2(ncRev / adSpend) : null, nc_cpa: ncOrd ? r2(adSpend / ncOrd) : null,
    net,
  };
}

// Back-compat: the copy-paste week-in-review (used by /api/whatsapp/week-in-review).
export async function buildWeekInReview(weekStart: string): Promise<string> {
  const m = await weekMetrics(weekStart);
  return m ? reviewText(m) : `No data for the week of ${weekStart} yet.`;
}

// Send the daily (yesterday) or weekly (last completed Mon–Sun) sales review to the owner(s),
// via the approved template (delivers any time) with a free-form fallback when in-window.
export async function sendSalesReview(kind: 'daily' | 'weekly'): Promise<{ sent: number; kind: string; text: string }> {
  let m: ReviewMetrics | null;
  if (kind === 'weekly') {
    const todayAest = aestDate(0);
    const dow = (new Date(todayAest + 'T00:00:00Z').getUTCDay() + 6) % 7;
    const lastMon = aestDate(-dow - 7);
    m = await weekMetrics(lastMon);
  } else {
    m = await dayMetrics(aestDate(-1));
  }
  if (!m) return { sent: 0, kind, text: 'no data' };
  const text = reviewText(m);
  const vars = reviewVars(m);
  const sid = await getTemplateSid('tpp_sales_review');
  const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
  let sent = 0;
  for (const to of owners) {
    let ok = false;
    if (sid) ok = await sendWhatsAppTemplate(to, sid, vars);
    if (!ok) ok = await sendWhatsApp(to, text);
    if (ok) { sent++; await recordProactiveContext(to, `This is the ${kind.toUpperCase()} SALES REVIEW I just sent. If the user replies about it, respond about THESE numbers:\n${text}`).catch(() => {}); }
  }
  return { sent, kind, text };
}

export async function sendAnalyticsBrief(kind: 'daily' | 'weekly'): Promise<{ sent: number }> {
  const body = kind === 'weekly' ? await buildWeeklyBrief() : await buildDailyBrief();
  const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
  let sent = 0;
  for (const to of owners) { if (await sendWhatsApp(to, body)) sent++; }
  return { sent };
}
