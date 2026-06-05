import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { computeStatus } from '@/lib/stock';
import { OPEN_STATUSES } from '@/lib/po-types';
import { allowedNumbers, sendWhatsApp, senderRole } from '@/lib/whatsapp';
import { getActionCenter } from '@/lib/actionCenter';
import { getWholesaleDashboard } from '@/lib/wholesale';
import { listCollabs, likelyToPost } from '@/lib/marketing';
import { setConfig } from '@/lib/settings';

export const maxDuration = 60;

const SEV_ICON: Record<string, string> = { critical: '🔴', warning: '🟠', info: '🔵' };

function sizeLabel(g: number | null) { return g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`; }

async function buildBriefing(): Promise<string> {
  const { data: rows } = await supabaseLogistics.from('v_stock_current')
    .select('sku,flavour,size_code,unit_size_g,tier,location_code,available,inbound,days_of_cover')
    .eq('active', true);
  const { data: pos } = await supabaseLogistics.from('purchase_orders').select('status');

  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`📦 *TPP stock briefing* — ${today}`];

  // Lead with the proactive action list — what needs you today (NUMBERED so you can
  // reply "1, 3 done" or "8 — provisioned Manildra" to clear / annotate items)
  const actions = await getActionCenter().catch(() => []);
  if (actions.length) {
    lines.push(`\n*🧠 Needs you today:*`);
    actions.forEach((a, i) => lines.push(`*${i + 1}.* ${SEV_ICON[a.severity] || '•'} ${a.title} — ${a.detail}`));
    lines.push(`_Reply with the numbers you've handled (e.g. “1, 3 done” or “8 — provisioned Manildra, underway”) to clear them, or ask me to action one._`);
    // save the numbered mapping so replies can resolve a number → item key
    await setConfig('last_brief_items', JSON.stringify(actions.map((a, i) => ({ n: i + 1, key: a.key, title: a.title })))).catch(() => {});
  } else {
    lines.push(`\n✅ Nothing needs action today — all sites within target cover.`);
  }

  for (const code of ['ALTONA', 'MANCHESTER']) {
    const label = code === 'ALTONA' ? 'Altona (AU)' : 'Manchester (UK)';
    const site = (rows ?? []).filter((r: any) => r.location_code === code);
    const oos = site.filter((r: any) => computeStatus(r) === 'oos');
    const reorderNow = site.filter((r: any) => computeStatus(r) === 'reorder_now');
    const reorderSoon = site.filter((r: any) => computeStatus(r) === 'reorder_soon');
    lines.push(`\n*${label}*`);
    lines.push(`⚠️ ${oos.length} out of stock · 🔴 ${reorderNow.length} reorder now · 🟠 ${reorderSoon.length} reorder soon`);

    const priorityAttention = [...reorderNow, ...reorderSoon]
      .filter((r: any) => r.tier === 'primary')
      .sort((a: any, b: any) => (a.days_of_cover ?? 999) - (b.days_of_cover ?? 999))
      .slice(0, 5);
    for (const r of priorityAttention) {
      lines.push(`• ${r.flavour} ${sizeLabel(r.unit_size_g)} — ${Math.round(r.days_of_cover)}d cover${r.inbound > 0 ? ` (+${r.inbound} inbound)` : ''}`);
    }
    const primaryOos = oos.filter((r: any) => r.tier === 'primary');
    for (const r of primaryOos.slice(0, 5)) {
      lines.push(`• ${r.flavour} ${sizeLabel(r.unit_size_g)} — OUT${r.inbound > 0 ? ` (+${r.inbound} inbound)` : ''}`);
    }
  }

  const openPos = (pos ?? []).filter((p: any) => OPEN_STATUSES.includes(p.status)).length;
  lines.push(`\n🚚 ${openPos} open purchase order${openPos === 1 ? '' : 's'}`);
  lines.push(`\nReply with a question any time (e.g. “Manchester primary cover?”).`);
  return lines.join('\n');
}

const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);

// Kate's wholesale-focused 8am brief: yesterday's sales, who to expect POs from
// (due to reorder), and a 320g stock summary per flavour.
async function buildWholesaleBriefing(): Promise<string> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date());
  const y = new Date(today + 'T00:00:00'); y.setDate(y.getDate() - 1);
  const yStr = y.toISOString().slice(0, 10);

  const { data: yOrders } = await supabaseLogistics.from('wholesale_orders')
    .select('total, contact_name').eq('order_date', yStr);
  const ySum = (yOrders ?? []).reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);

  const w = await getWholesaleDashboard().catch(() => null);
  const lines: string[] = [`🛒 *Wholesale brief* — ${today}`, `Morning Kate! ☀️`];

  lines.push(`\n*Yesterday:* ${money(ySum)} across ${(yOrders ?? []).length} order${(yOrders ?? []).length === 1 ? '' : 's'}`);
  if (w) lines.push(`*This week:* ${money(w.totals.week)} · *This month:* ${money(w.totals.month)}`);

  if (w?.due?.length) {
    lines.push(`\n*📞 Expect / chase a PO from:*`);
    for (const c of w.due.slice(0, 6)) lines.push(`• ${c.name} — ${c.overdue_days >= 0 ? `${c.overdue_days}d overdue` : `due in ${Math.abs(c.overdue_days)}d`} (~${c.avg_interval_days}d cycle)`);
  } else {
    lines.push(`\n✅ No customers due to reorder right now.`);
  }

  if (w?.stock?.length) {
    lines.push(`\n*🥞 320g stock (Altona):*`);
    for (const s of w.stock) {
      const flag = s.days_cover != null && s.days_cover <= 45 ? ' 🔴' : '';
      lines.push(`• ${s.flavour}: ${s.available} cartons · ${s.days_cover != null ? `${s.days_cover}d` : '—'} cover${flag}`);
    }
  }

  // Marketing: next collab + likely-to-post influencers
  const todayStr = today;
  const collabs = (await listCollabs().catch(() => [])) as any[];
  const nextCollab = collabs
    .filter((c) => c.due_date && c.due_date >= todayStr && c.status !== 'completed' && c.status !== 'cancelled')
    .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  if (nextCollab) {
    const samples = nextCollab.expecting_samples ? (nextCollab.samples_received ? ' · samples received ✓' : ' · received stock yet?') : '';
    lines.push(`\n*🤝 Next collab:* ${nextCollab.partner_name} — ${nextCollab.due_date}${nextCollab.title ? ` (${nextCollab.title})` : ''}${samples}`);
  }
  const likely = await likelyToPost(3).catch(() => []);
  if (likely.length) {
    lines.push(`\n*📸 Likely to post next:*`);
    for (const i of likely) lines.push(`• ${i.name}${i.handle ? ` ${i.handle}` : ''} — got ${i.flavour} ${i.days_since}d ago`);
  }

  lines.push(`\nForward me a PO, an influencer's details, or a collab chat and I'll handle it. 💪`);
  return lines.join('\n');
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const recipients = allowedNumbers();
  const logistics = await buildBriefing();
  const hasWholesale = recipients.some((to) => senderRole(to) === 'wholesale');
  const wholesale = hasWholesale ? await buildWholesaleBriefing() : '';
  const results = await Promise.all(recipients.map((to) =>
    sendWhatsApp(to, senderRole(to) === 'wholesale' ? wholesale : logistics)));
  return NextResponse.json({ ok: true, sent: results.filter(Boolean).length, recipients: recipients.length, wholesale_preview: wholesale || undefined, preview: logistics });
}

export const POST = handle;
export const GET = handle; // allow GET so it can be previewed/triggered easily
