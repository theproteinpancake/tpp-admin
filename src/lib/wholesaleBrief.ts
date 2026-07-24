// Kate's daily wholesale brief — yesterday + last-week sales, who to chase for a PO, 320g stock,
// and a marketing line. Sent via the tpp_wholesale_brief template (delivers any time) with a
// free-form fallback. Single-line packed variables (WhatsApp templates can't hold line breaks).
import { supabaseLogistics } from './supabase-logistics';
import { getWholesaleDashboard } from './wholesale';
import { listCollabs, likelyToPost } from './marketing';
import { getTemplateSid } from './waTemplates';
import { sendWhatsApp, sendWhatsAppTemplate, KATE_NUMBER } from './whatsapp';

const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);
const DAY = 86400_000;

export async function buildWholesaleBrief(): Promise<{ vars: Record<string, string>; text: string }> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());
  const longDate = new Date(today + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const fmtD = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const yStr = new Date(Date.parse(today + 'T00:00:00Z') - DAY).toISOString().slice(0, 10);
  const todayD = new Date(today + 'T00:00:00Z');
  const dow = (todayD.getUTCDay() + 6) % 7;
  const thisMon = new Date(todayD.getTime() - dow * DAY);
  const lastMonStr = new Date(thisMon.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const thisMonStr = thisMon.toISOString().slice(0, 10);
  const lastSunStr = new Date(thisMon.getTime() - DAY).toISOString().slice(0, 10);

  const [{ data: yOrders }, { data: lwOrders }, w] = await Promise.all([
    supabaseLogistics.from('wholesale_orders').select('total').eq('order_date', yStr),
    supabaseLogistics.from('wholesale_orders').select('total').gte('order_date', lastMonStr).lt('order_date', thisMonStr),
    getWholesaleDashboard().catch(() => null),
  ]);
  const ySum = (yOrders ?? []).reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
  const yN = (yOrders ?? []).length;
  const lwSum = (lwOrders ?? []).reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
  const month = w ? w.totals.month : 0;

  const salesLine = `Yesterday ${money(ySum)} (${yN} order${yN === 1 ? '' : 's'}) · Last week (${fmtD(lastMonStr)}–${fmtD(lastSunStr)}) ${money(lwSum)} · Month ${money(month)}`;
  const due = (w?.due ?? []).slice(0, 6).map((c: any) => `${c.name} (${c.overdue_days >= 0 ? `${c.overdue_days}d overdue` : `due ${Math.abs(c.overdue_days)}d`})`);
  const stock = (w?.stock ?? []).map((s: any) => `${s.flavour} ${s.available} (${s.days_cover != null ? `${s.days_cover}d` : '—'}${s.days_cover != null && s.days_cover <= 45 ? ' 🔴' : ''})`);

  const collabs = (await listCollabs().catch(() => [])) as any[];
  const nextCollab = collabs.filter((c) => c.due_date && c.due_date >= today && c.status !== 'completed' && c.status !== 'cancelled').sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const likely = (await likelyToPost(3).catch(() => [])) as any[];
  const mk: string[] = [];
  if (nextCollab) mk.push(`Next collab: ${nextCollab.partner_name} ${nextCollab.due_date}`);
  if (likely.length) mk.push(`Likely to post: ${likely.map((i) => i.name).join(', ')}`);

  const vars = {
    '1': longDate, '2': salesLine,
    '3': due.length ? due.join(' · ') : 'none due right now ✅',
    '4': stock.length ? stock.join(' · ') : '—',
    '5': mk.length ? mk.join(' · ') : 'nothing scheduled',
  };
  const text = [
    `🛒 *Wholesale brief* — ${longDate}`, `Morning Kate! ☀️`, ``,
    `💵 *Sales*`, salesLine, ``,
    `📞 *Expect / chase a PO from*`, ...(due.length ? due.map((d) => `• ${d}`) : ['• none due right now ✅']), ``,
    `🥞 *320g stock — Altona*`, ...(stock.length ? stock.map((s) => `• ${s}`) : ['• —']), ``,
    `🤝 *Marketing*`, vars['5'], ``,
    `Forward me a PO, an influencer's details or a collab chat and I'll handle it. 💪`,
  ].join('\n');
  return { vars, text };
}

export async function sendWholesaleBrief(): Promise<{ sent: number; text: string }> {
  const { vars, text } = await buildWholesaleBrief();
  const sid = await getTemplateSid('tpp_wholesale_brief');
  let ok = false;
  if (sid) ok = await sendWhatsAppTemplate(KATE_NUMBER, sid, vars);
  if (!ok) ok = !!(await sendWhatsApp(KATE_NUMBER, text));
  return { sent: ok ? 1 : 0, text };
}
