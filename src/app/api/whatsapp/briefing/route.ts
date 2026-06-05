import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { computeStatus } from '@/lib/stock';
import { OPEN_STATUSES } from '@/lib/po-types';
import { allowedNumbers, sendWhatsApp } from '@/lib/whatsapp';
import { getActionCenter } from '@/lib/actionCenter';

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

  // Lead with the proactive action list — what needs you today
  const actions = await getActionCenter().catch(() => []);
  if (actions.length) {
    lines.push(`\n*🧠 Needs you today:*`);
    for (const a of actions) lines.push(`${SEV_ICON[a.severity] || '•'} ${a.title} — ${a.detail}`);
    lines.push(`_Reply e.g. “${actions[0].command}” and I’ll handle it._`);
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

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const text = await buildBriefing();
  const recipients = allowedNumbers();
  const results = await Promise.all(recipients.map((to) => sendWhatsApp(to, text)));
  return NextResponse.json({ ok: true, sent: results.filter(Boolean).length, recipients: recipients.length, preview: text });
}

export const POST = handle;
export const GET = handle; // allow GET so it can be previewed/triggered easily
