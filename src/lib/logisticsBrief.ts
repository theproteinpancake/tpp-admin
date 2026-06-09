// Restructured logistics brief (9am): top-6 priority SKUs per site, UK transfer status,
// outstanding inbound (open Xero POs not yet billed), and ONLY new fulfilment-cost outliers.
// Sent via the tpp_logistics_brief template (delivers any time) with a free-form fallback.
import { supabaseLogistics } from './supabase-logistics';
import { computeStatus } from './stock';
import { getTemplateSid } from './waTemplates';
import { sendWhatsApp, sendWhatsAppTemplate, allowedNumbers, senderRole } from './whatsapp';

const TRANSFER_STATUS: Record<string, string> = {
  draft: 'draft', in_transit: 'in transit', customs: 'awaiting customs clearance',
  arrived: 'arrived — awaiting receiving', received: 'received', cancelled: 'cancelled',
};
const aestDateStr = (off = 0) => new Date(Date.now() + off * 86400_000 + 10 * 3600_000).toISOString().slice(0, 10);
const longDate = () => new Date(Date.now() + 10 * 3600_000).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortDate = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function stockLine(r: any): string {
  const st = computeStatus(r);
  const cover = r.days_of_cover != null ? `${Math.round(r.days_of_cover)}d` : '—';
  const inb = Number(r.inbound) > 0 ? ` (+${Number(r.inbound)} in)` : '';
  return `${r.flavour} ${st === 'oos' ? 'OOS' : cover}${inb}`;
}
// Top-N most urgent SKUs at a site (OOS first, then lowest days of cover).
function topStock(rows: any[], code: string, n = 6): string {
  const ranked = rows.filter((r) => r.location_code === code)
    .map((r) => ({ r, k: computeStatus(r) === 'oos' ? -1 : (r.days_of_cover ?? 9999) }))
    .sort((a, b) => a.k - b.k).slice(0, n);
  return ranked.map((x) => stockLine(x.r)).join(', ') || 'all healthy';
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
  const au = topStock(rows, 'ALTONA');
  const uk = topStock(rows, 'MANCHESTER');

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
    `Logistics overview — ${date}`, ``,
    `🇦🇺 AU priority stock:`, ...au.split(', ').map((s) => `• ${s}`), ``,
    `🇬🇧 UK priority stock:`, ...uk.split(', ').map((s) => `• ${s}`), ``,
    `🚢 UK transfer: ${transferLine}`, ``,
    `📦 Outstanding inbound: ${outstanding}`, ``,
    `💸 Fulfilment watch: ${watch}`,
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
    if (ok) sent++;
  }
  return { sent, text };
}
