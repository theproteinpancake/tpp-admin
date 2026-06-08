// Agent analytics briefings: a 7am daily snapshot (yesterday) and a Monday week-in-review,
// each with a short Claude-written insight (what moved + the biggest lever). Sent on WhatsApp.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { getAttribution } from './attribution';
import { getAssumptions } from './analytics';
import { sendWhatsApp, allowedNumbers, senderRole } from './whatsapp';

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

export async function sendAnalyticsBrief(kind: 'daily' | 'weekly'): Promise<{ sent: number }> {
  const body = kind === 'weekly' ? await buildWeeklyBrief() : await buildDailyBrief();
  const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
  let sent = 0;
  for (const to of owners) { if (await sendWhatsApp(to, body)) sent++; }
  return { sent };
}
