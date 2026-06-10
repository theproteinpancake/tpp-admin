import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { getConfigMany, recordJobRun } from '@/lib/settings';
import { getTemplateSid } from '@/lib/waTemplates';
import { sendWhatsApp, sendWhatsAppTemplate, allowedNumbers, senderRole } from '@/lib/whatsapp';
import { melbLongDate } from '@/lib/tz';

export const maxDuration = 60;

// Daily system self-check (9:30am AEST): verifies every scheduled job ran inside its window
// (heartbeats written by recordJobRun) + a few end-to-end data-freshness probes that catch
// failures the heartbeats can't (pg_cron itself dead, a sync "succeeding" but writing nothing).
// SILENT when healthy; alerts the owner via the tpp_system_alert template when something's off.

const JOBS: { job: string; label: string; maxAgeH: number }[] = [
  { job: 'sales-review', label: '7am sales review', maxAgeH: 26 },
  { job: 'wholesale-brief', label: "Kate's 8am wholesale brief", maxAgeH: 26 },
  { job: 'logistics-brief', label: '9am logistics brief', maxAgeH: 26 },
  { job: 'wholesale-scour', label: 'wholesale PO scour (15-min)', maxAgeH: 2 },
  { job: 'gmail-scour', label: 'inbox scour (4×/day)', maxAgeH: 8 },
];

const hoursAgo = (iso: string | undefined) => iso ? (Date.now() - Date.parse(iso)) / 3600_000 : Infinity;
const fmtAge = (h: number) => !isFinite(h) ? 'never' : h < 1 ? `${Math.round(h * 60)}m ago` : `${h.toFixed(1)}h ago`;

async function freshness(): Promise<{ label: string; detail: string }[]> {
  const issues: { label: string; detail: string }[] = [];
  // hourly Shopify order sync (runs 7am–8pm AEST; allow a generous window)
  try {
    const { data } = await supabaseLogistics.from('shopify_order').select('updated_at').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    const h = hoursAgo(data?.updated_at);
    if (h > 14) issues.push({ label: 'Shopify order sync looks stalled', detail: `Newest synced order update is ${fmtAge(h)} (hourly sync expected).` });
  } catch { issues.push({ label: 'Shopify order freshness probe failed', detail: 'Could not read shopify_order.' }); }
  // daily ShipBob cost sync
  try {
    const { data } = await supabaseLogistics.from('shipment_costs').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle();
    const h = hoursAgo(data?.created_at);
    if (h > 30) issues.push({ label: 'ShipBob cost sync looks stalled', detail: `Newest shipment cost row is ${fmtAge(h)} (daily sync expected).` });
  } catch { issues.push({ label: 'ShipBob cost freshness probe failed', detail: 'Could not read shipment_costs.' }); }
  // nightly analytics autofill
  try {
    const { data } = await supabaseLogistics.from('sales_week').select('auto_filled_at').order('auto_filled_at', { ascending: false }).limit(1).maybeSingle();
    const h = hoursAgo(data?.auto_filled_at);
    if (h > 30) issues.push({ label: 'Sales master autofill looks stalled', detail: `Last autofill was ${fmtAge(h)} (nightly refresh expected).` });
  } catch { issues.push({ label: 'Sales master freshness probe failed', detail: 'Could not read sales_week.' }); }
  return issues;
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const beats = await getConfigMany(JOBS.map((j) => `health:last:${j.job}`));
  const issues: { label: string; detail: string }[] = [];
  for (const j of JOBS) {
    const h = hoursAgo(beats[`health:last:${j.job}`]);
    if (h > j.maxAgeH) issues.push({ label: `${j.label} hasn't run`, detail: `Last successful run: ${fmtAge(h)} (expected within ${j.maxAgeH}h).` });
  }
  issues.push(...(await freshness()));

  const dry = !!new URL(req.url).searchParams.get('dry');
  let sent = 0;
  if (issues.length && !dry) {
    const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
    const sid = await getTemplateSid('tpp_system_alert');
    const what = issues.map((i) => i.label).join(' · ').slice(0, 550);
    const detail = issues.map((i) => i.detail).join(' ').slice(0, 550);
    const text = `🚨 *TPP system check* — ${melbLongDate()}\n\n${issues.map((i) => `• ${i.label} — ${i.detail}`).join('\n')}\n\nReply here and I'll dig into it.`;
    for (const to of owners) {
      let ok = false;
      if (sid) ok = await sendWhatsAppTemplate(to, sid, { '1': melbLongDate(), '2': what, '3': detail });
      if (!ok) ok = await sendWhatsApp(to, text);
      if (ok) sent++;
    }
  }
  await recordJobRun('health-check');
  return NextResponse.json({ ok: true, healthy: issues.length === 0, issues, alerted: sent, dry });
}

export const GET = handle;
export const POST = handle;
