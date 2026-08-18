// Restructured logistics brief (9am): top-6 priority SKUs per site, UK transfer status,
// outstanding inbound (open Xero POs not yet billed), and ONLY new fulfilment-cost outliers.
// Sent via the tpp_logistics_brief template (delivers any time) with a free-form fallback.
import { supabaseLogistics } from './supabase-logistics';
import { computeStatus, CATEGORY_LEAD_DAYS } from './stock';
import { getConfig } from './settings';
import { getTemplateSid } from './waTemplates';
import { sendWhatsApp, sendWhatsAppTemplate, waitUntilSent, allowedNumbers, senderRole } from './whatsapp';
import { stockImageUrl } from './stockImage';
import { recordProactiveContext } from './stockAgent';
import { getRestockFocus, focusText } from './restockFocus';
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
// Short labels for the flavourless gear/syrup SKUs when they earn a brief slot.
const GEAR_LABEL: Record<string, string> = {
  MSS: 'Syrup', MSS8: 'Syrup ctn-8', ACCP: 'Pancake Pan', ACCF: 'Flipper', ACCS: 'Scraper', TWM: 'Waffle Maker',
};
function stockLine(r: any): string {
  const st = computeStatus(r);
  const cover = r.days_of_cover != null ? `${Math.round(r.days_of_cover)}d` : '—';
  if (!r.flavour && GEAR_LABEL[r.sku]) {
    const inb2 = Number(r.inbound) > 0 ? ` (+${Number(r.inbound)} in)` : '';
    return `${GEAR_LABEL[r.sku]} ${st === 'oos' ? 'OOS' : `${cover} (${CATEGORY_LEAD_DAYS[r.category] || '?'}d lead)`}${inb2}`;
  }
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
  const mix = rows.filter((r) => r.location_code === code && r.flavour && r.tier === 'primary' && r.unit_size_g !== 80 && !hidden.has(String(r.sku || '').toUpperCase()));
  // Gear/syrup earn a slot ONLY when their lead-time status says act (velocity-aware — the
  // Flipper OOS'd because a static ShipBob alert fired too late for its 60-day lead).
  const gear = rows.filter((r) => r.location_code === code && GEAR_LABEL[r.sku] && !hidden.has(String(r.sku || '').toUpperCase()))
    .filter((r) => ['oos', 'reorder_now', 'reorder_soon'].includes(computeStatus(r)));
  const ranked = [...mix, ...gear]
    .map((r) => ({ r, k: computeStatus(r) === 'oos' ? -1 : (r.days_of_cover ?? 9999) }))
    .sort((a, b) => a.k - b.k).slice(0, gear.length ? n + 2 : n);
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
    supabaseLogistics.from('v_stock_current').select('sku,flavour,unit_size_g,tier,category,location_code,available,inbound,days_of_cover').eq('active', true),
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

// Luke's call (27 Jul): the text overview was noise next to the cards — the morning brief is
// now JUST the two stock card images (AU then UK, sequenced so they arrive in order). The
// text summary is still built: it goes to the agent's context (so replies about the brief
// work) and is the fallback if both images fail to send (e.g. out-of-session).
export async function sendLogisticsBrief(): Promise<{ sent: number; text: string }> {
  const { vars, text } = await buildLogisticsBrief();
  // The one text block Luke DOES want with the cards: at most 3 restock actions ranked across
  // every SKU class (finished goods both sites, ABC pouches, cartons, insert cards). Silent
  // when nothing's flagged — cards-only stays the quiet default.
  const focus = await getRestockFocus().then(focusText).catch(() => null);
  const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
  const date = melbLongDate();
  let sent = 0;
  for (const to of owners) {
    const au = await sendWhatsApp(to, `🥞 Morning stock — ${date}`, stockImageUrl('ALTONA')).catch(() => false as const);
    if (typeof au === 'string') await waitUntilSent(au).catch(() => {});
    const uk = await sendWhatsApp(to, '🇬🇧 Manchester', stockImageUrl('MANCHESTER')).catch(() => false as const);
    if (focus && (au || uk)) {
      // Sequence AFTER the cards, same trick as the button fix: media queues while Twilio
      // renders our image URLs, so an instantly-sent text would arrive above the cards.
      if (typeof uk === 'string') await waitUntilSent(uk).catch(() => {});
      await sendWhatsApp(to, focus).catch(() => false);
    }
    let ok = !!(au || uk);
    if (!ok) {
      const sid = await getTemplateSid('tpp_logistics_brief');
      if (sid) ok = await sendWhatsAppTemplate(to, sid, vars);
      if (!ok) ok = !!(await sendWhatsApp(to, text));
    }
    if (ok) { sent++; await recordProactiveContext(to, `MORNING STOCK CARDS just sent (AU + UK images)${focus ? ` plus this Restock focus:\n${focus}` : ''}. The underlying data, for answering follow-ups (user replies like "stop showing X" → update_logistics_brief_excludes):\n${text}`).catch(() => {}); }
  }
  return { sent, text };
}
