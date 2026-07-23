// Restructured logistics brief (9am): top-6 priority SKUs per site, UK transfer status,
// outstanding inbound (open Xero POs not yet billed), and ONLY new fulfilment-cost outliers.
// Sent via the tpp_logistics_brief template (delivers any time) with a free-form fallback.
import { supabaseLogistics } from './supabase-logistics';
import { computeStatus } from './stock';
import { getConfig } from './settings';
import { getTemplateSid } from './waTemplates';
import { sendWhatsApp, sendWhatsAppTemplate, allowedNumbers, senderRole } from './whatsapp';
import { stockImageUrl } from './stockImage';
import { recordProactiveContext } from './stockAgent';
import { melbDate, melbLongDate } from './tz';

// SKUs the owner has asked to keep OUT of the brief's stock list, per site (e.g. UK sizes not stocked).
async function loadExcludes(): Promise<Record<string, string[]>> {
  try { const v = await getConfig('logistics_brief_excludes'); return v ? JSON.parse(v) : {}; } catch { return {}; }
}

const TRANSFER_STATUS: Record<string, string> = {
  draft: 'draft', in_transit: 'in transit', customs: 'awaiting customs clearance',
  arrived: 'arrived — awaiting receiving', received: 'received', cancelled: 'cancelled',
};
const aestDateStr = (off = 0) => melbDate(off);
const longDate = () => melbLongDate();
const shortDate = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const sizeLabel = (g: any) => g == null ? '' : Number(g) >= 1000 ? ` ${Number(g) / 1000}kg` : ` ${Number(g)}g`;
function stockLine(r: any): string {
  const st = computeStatus(r);
  const cover = r.days_of_cover != null ? `${Math.round(r.days_of_cover)}d` : '—';
  // 320g inbound arrives in POUCHES (po_items) but the audience thinks in CARTONS of 4
  const inbN = r.unit_size_g === 320 ? Math.round(Number(r.inbound) / 4) : Number(r.inbound);
  const inb = Number(r.inbound) > 0 ? ` (+${inbN}${r.unit_size_g === 320 ? ' ctn' : ''} in)` : '';
  return `${r.flavour}${sizeLabel(r.unit_size_g)} ${st === 'oos' ? 'OOS' : cover}${inb}`;
}
// Top-N most urgent SELLABLE SKUs at a site (primary tier, OOS first, then lowest days of cover).
// `exclude` = SKU codes the owner asked to hide for this site.
function topStock(rows: any[], code: string, exclude: string[] = [], n = 6): string {
  const hidden = new Set(exclude.map((s) => s.toUpperCase()));
  // 80g sample packs are deliberately not replenished on velocity — their OOS states are
  // noise here (they filled half the UK line the day they were activated).
  const ranked = rows.filter((r) => r.location_code === code && r.flavour && r.tier === 'primary' && r.unit_size_g !== 80 && !hidden.has(String(r.sku || '').toUpperCase()))
    .map((r) => ({ r, k: computeStatus(r) === 'oos' ? -1 : (r.days_of_cover ?? 9999) }))
    .sort((a, b) => a.k - b.k).slice(0, n);
  return ranked.map((x) => stockLine(x.r)).join(' · ') || 'all healthy';
}

// Yesterday's shipments whose cost is a clear outlier vs the recent median (only "new" = yesterday's).
async function fulfilmentWatch(): Promise<string> {
  const yday = aestDateStr(-1);
  const { data } = await supabaseLogistics.from('shipment_costs')
    .select('cost,currency,ship_date,order_number').gte('ship_date', aestDateStr(-90));
  const aud = (o: any) => (/gbp/i.test(o.currency || '') ? (Number(o.cost) || 0) * 1.95 : Number(o.cost) || 0);
  const costs = (data ?? []).map(aud).filter((c) => c > 0).sort((a, b) => a - b);
  if (!costs.length) return 'nothing unusual';
  const median = costs[Math.floor(costs.length / 2)];
  const threshold = Math.max(median * 3, 40);
  const out = (data ?? []).filter((o) => o.ship_date === yday && aud(o) > threshold).map((o) => `$${Math.round(aud(o))} on #${o.order_number}`);
  return out.length ? `${out.join(', ')} — worth a check (median $${Math.round(median)})` : 'nothing unusual';
}

export async function buildLogisticsBrief(): Promise<{ vars: Record<string, string>; text: string }> {
  const [stockRes, trRes, poRes, watch] = await Promise.all([
    supabaseLogistics.from('v_stock_current').select('sku,flavour,unit_size_g,tier,location_code,available,inbound,days_of_cover').eq('active', true),
    supabaseLogistics.from('internal_transfers').select('reference,status,eta'),
    supabaseLogistics.from('purchase_orders').select('reference,status,xero_status'),
    fulfilmentWatch(),
  ]);
  const rows = stockRes.data ?? [];
  const excl = await loadExcludes();
  const au = topStock(rows, 'ALTONA', excl.AU || []);
  const uk = topStock(rows, 'MANCHESTER', excl.UK || []);

  const transfers = (trRes.data ?? []).filter((t: any) => !['received', 'cancelled'].includes(t.status));
  const transferLine = transfers.map((t: any) => `${t.reference} — ${TRANSFER_STATUS[t.status] || t.status}${t.eta ? `, ETA ${shortDate(t.eta)}` : ''}`).join('; ') || 'none in transit';

  // Outstanding inbound = real open POs not yet billed (when a packing list lands + WRO is created
  // the agent marks the PO billed/received, so it drops off automatically).
  const outstanding = (poRes.data ?? [])
    .filter((p: any) => !['received', 'cancelled', 'draft'].includes(p.status) && (p.xero_status || '') !== 'BILLED' && p.reference && !/whatsapp draft/i.test(p.reference))
    .map((p: any) => p.reference).join(', ') || 'none';

  const date = longDate();
  const vars = { '1': date, '2': au, '3': uk, '4': transferLine, '5': outstanding, '6': watch };
  const text = [
    `🥞 *Logistics overview* — ${date}`, ``,
    `🇦🇺 *AU stock*`, ...au.split(' · ').map((s) => `• ${s}`), ``,
    `🇬🇧 *UK stock*`, ...uk.split(' · ').map((s) => `• ${s}`), ``,
    `🚢 *UK transfer*`, `${transferLine}`, ``,
    `📦 *Outstanding inbound*`, `${outstanding}`, ``,
    `💸 *Fulfilment watch*`, `${watch}`, ``,
    `_Reply to action anything._`,
  ].join('\n');
  return { vars, text };
}

export async function sendLogisticsBrief(): Promise<{ sent: number; text: string }> {
  const { vars, text } = await buildLogisticsBrief();
  const sid = await getTemplateSid('tpp_logistics_brief');
  const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
  let sent = 0;
  for (const to of owners) {
    let ok = false;
    if (sid) ok = await sendWhatsAppTemplate(to, sid, vars);
    if (!ok) ok = await sendWhatsApp(to, text);
    // Dashboard-style stock cards ride along with the text brief (live ShipBob numbers,
    // pouch shots, 320g in cartons) — the text stays the actionable summary, the cards are
    // the glanceable numbers. Best-effort: outside a 24h session the freeform media message
    // may not deliver; the templated brief above is the guaranteed signal.
    if (ok) {
      await sendWhatsApp(to, '🇦🇺 Altona', stockImageUrl('ALTONA')).catch(() => false);
      await sendWhatsApp(to, '🇬🇧 Manchester', stockImageUrl('MANCHESTER')).catch(() => false);
    }
    if (ok) { sent++; await recordProactiveContext(to, `This is the LOGISTICS BRIEF I just sent. If the user replies about it (e.g. "stop showing X in the UK", "don't remind me of these SKUs"), use update_logistics_brief_excludes:\n${text}`).catch(() => {}); }
  }
  return { sent, text };
}
