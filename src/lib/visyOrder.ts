// VISY packaging orders, initiated from the WhatsApp agent.
//  SRP cartons / ABC-line packaging → email to Amanda, deliver to ABC Blending (no WRO).
//  ShipBob shipping cartons → email to Amanda, deliver to ShipBob Altona WITH a WRO label on
//  the pallet (so ShipBob can receive it). The agent drafts; Luke approves; then send_email_draft.
import { supabaseLogistics } from './supabase-logistics';
import { gmailCreateDraft, gmailDeleteDraftsBySubject } from './google';
import { getConfig } from './settings';
import { createWRO, getWROLabels, cancelWRO } from './shipbob';
import { deliveryBlock, VISY_SIGNATURE } from './visyConstants';
import { melbDate, addDays } from './tz';

export interface VisyContact { name: string; email: string }
export async function getVisyContact(): Promise<VisyContact> {
  const raw = await getConfig('visy_contact');
  let name = 'Amanda Eastley', email = '';
  if (raw) { try { const j = JSON.parse(raw); name = j.name || name; email = j.email || ''; } catch { /* keep defaults */ } }
  return { name, email };
}

export interface VisyItem {
  id: string; kind: string; name: string; sku: string | null; visy_code: string | null;
  destination: 'ABC' | 'ALTONA'; min_order: number | null; units_per: number | null;
  baseline_qty: number | null; shipbob_inventory_id: number | null;
  linked_sku: string | null; linked_flavour: string | null;
}

// Words that describe packaging in general but don't identify WHICH item — stripped before matching
// so "the BMS SRP cartons", "Buttermilk boxes", "order more PANSMALL shippers" all resolve.
const FILLER = new Set(['srp', 'carton', 'cartons', 'box', 'boxes', 'pouch', 'pouches', 'shipper', 'shippers',
  'shipping', 'wholesale', 'empty', 'empties', 'the', 'a', 'an', 'for', 'our', 'of', 'unit', 'units', 'please',
  'more', 'some', 'order', 'orders', 'visy', 'to', 'from', 'send', 'get', 'and', 'my', 'we', 'are', 'on', 'stock']);
const toks = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9#/ ]/g, ' ').split(/\s+/).filter(Boolean);

// Resolve a VISY-orderable item from free text — robust to natural phrasing (flavour, pouch SKU,
// carton name, VISY code, with or without "SRP"/"cartons"/etc.). Single match, or candidates if tied.
export async function resolveVisyItem(query: string): Promise<{ item?: VisyItem; candidates?: VisyItem[] }> {
  const raw = query.trim().toLowerCase();
  const { data } = await supabaseLogistics.from('packaging')
    .select('*, linked:linked_product_id(sku, flavour)')
    .not('visy_code', 'is', null).eq('active', true);
  const items: VisyItem[] = (data ?? []).map((p: any) => ({
    id: p.id, kind: p.kind, name: p.name, sku: p.sku, visy_code: p.visy_code,
    destination: (p.destination || 'ABC') as 'ABC' | 'ALTONA', min_order: p.min_order, units_per: p.units_per,
    baseline_qty: p.baseline_qty, shipbob_inventory_id: p.shipbob_inventory_id ?? null,
    linked_sku: p.linked?.sku ?? null, linked_flavour: p.linked?.flavour ?? null,
  }));

  // 1) exact VISY code / carton SKU / linked pouch SKU (e.g. "PANSMALL", "VP54448", "BMS")
  const exact = items.find((i) =>
    [i.visy_code, i.sku, i.linked_sku].some((x) => x && x.toLowerCase() === raw));
  if (exact) return { item: exact };

  // 2) meaningful tokens only (strip the "srp/cartons/order/the…" noise)
  const qTokens = toks(query).filter((t) => !FILLER.has(t));
  if (!qTokens.length) return {};
  const qPhrase = qTokens.join(' ');

  // exact flavour-phrase match wins outright ("buttermilk" → Buttermilk, not GF Buttermilk)
  const flavExact = items.filter((i) => (i.linked_flavour || '').toLowerCase() === qPhrase);
  if (flavExact.length === 1) return { item: flavExact[0] };

  // 3) score by token overlap across flavour / name / sku / code
  const scored = items.map((i) => {
    const hay = new Set(toks(`${i.linked_flavour || ''} ${i.name || ''} ${i.sku || ''} ${i.linked_sku || ''} ${i.visy_code || ''}`));
    let score = qTokens.filter((t) => hay.has(t)).length;
    if ((i.linked_flavour || '').toLowerCase() === qPhrase) score += 5;
    return { i, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return {};
  const top = scored[0].score;
  const best = scored.filter((x) => x.score === top).map((x) => x.i);
  return best.length === 1 ? { item: best[0] } : { candidates: best };
}

export interface VisyDraft {
  draft_id: string; to: string; subject: string; body: string;
  destination: 'ABC' | 'ALTONA'; qty: number; visy_code: string | null;
  wro_id?: number; wro_attached?: boolean; pallets?: number; notes: string[];
}

// VISY stacks 1,000 shipper cartons per pallet — every 1,000 units is its own pallet in the
// WRO, so the labels PDF carries one label per pallet (VISY had to chase a second label when a
// 2,000-unit order went out as a single-pallet WRO).
const UNITS_PER_PALLET = 1000;

// Draft (NOT send) a VISY order email. For ALTONA shipping cartons, also create a WRO + attach
// its label PDF to the pallet's paperwork.
export async function draftVisyOrder(opts: { item: VisyItem; qty?: number }): Promise<VisyDraft> {
  const { item } = opts;
  const notes: string[] = [];
  const contact = await getVisyContact();
  const qty = opts.qty && opts.qty > 0 ? Math.round(opts.qty) : (item.min_order || 1000);
  if (item.min_order && qty < item.min_order) notes.push(`Heads up: VISY's minimum for this item is ${item.min_order.toLocaleString()} — ${qty.toLocaleString()} is below it.`);

  // Description line — SRP cartons read "my SRP cartons for {flavour}", shipping cartons use the item name.
  const desc = item.kind === 'srp' && item.linked_flavour
    ? `my SRP cartons for ${item.linked_flavour}`
    : item.name;
  const shortCode = item.linked_sku || item.visy_code || item.sku || 'ORDER';
  const subject = `NEW ORDER - ${shortCode}`;

  // ALTONA shipping cartons → create the WRO first so its label can ride with the paperwork.
  // One pallet (= one WRO box = one label page) per 1,000 units: 1,000 → 1 pallet, 2,000 → 2.
  const palletQtys: number[] = [];
  for (let left = qty; left > 0; left -= UNITS_PER_PALLET) palletQtys.push(Math.min(left, UNITS_PER_PALLET));
  let attachment: { filename: string; base64: string } | undefined;
  let wro_id: number | undefined;
  let wro_attached = false;
  if (item.destination === 'ALTONA') {
    if (item.shipbob_inventory_id) {
      try {
        const eta = addDays(melbDate(0), 14);
        const wro = await createWRO({
          site: 'ALTONA', expected_arrival_date: eta, tracking_ref: `VISY-${item.visy_code}-${eta}`,
          package_type: 'Pallet',
          boxes: palletQtys.map((q) => [{ inventory_id: item.shipbob_inventory_id!, quantity: q }]),
        });
        wro_id = wro.id;
        const labels = await getWROLabels('ALTONA', wro.id);
        if (labels) { attachment = { filename: `WRO-${wro.id}-label.pdf`, base64: labels }; wro_attached = true; }
        else notes.push(`WRO ${wro.id} created but its label PDF wasn't available yet — re-fetch before sending.`);
        if (palletQtys.length > 1) notes.push(`${qty.toLocaleString()} units = ${palletQtys.length} pallets — the WRO has one label per pallet (VISY needs a label on each).`);
      } catch (e) { notes.push(`Couldn't create the ShipBob WRO automatically: ${String(e).slice(0, 120)}. Draft made without a label.`); }
    } else {
      notes.push('This carton has no ShipBob inventory id mapped, so no WRO/label was generated — add the inventory id to enable it.');
    }
  }

  const body = [
    `Hi ${contact.name.split(' ')[0] || 'Amanda'},`,
    '',
    `Could I please have a delivery of ${qty.toLocaleString()} units of ${desc} - Product Code: ${item.visy_code || '—'}`,
    '',
    deliveryBlock(item.destination),
    '',
    VISY_SIGNATURE,
  ].join('\n');

  if (!contact.email) notes.push("VISY contact email isn't set yet — the draft has no recipient. Set it in settings (config key `visy_contact`) or tell me Amanda's email.");
  // Supersede any earlier un-sent copy of THIS order so duplicate drafts never pile up
  // (a stale duplicate is what caused a no-op "send" before). The superseded draft's WRO is
  // orphaned (this re-draft made its own), so cancel it in ShipBob too — two live WROs for one
  // physical delivery confuses receiving. Then mark stale DB rows cancelled.
  const supersededDrafts = await gmailDeleteDraftsBySubject(subject).catch(() => 0);
  if (supersededDrafts) {
    const { data: stale } = await supabaseLogistics.from('visy_orders').select('wro_id').eq('subject', subject).eq('status', 'drafted');
    for (const staleWro of new Set((stale ?? []).map((r: any) => r.wro_id).filter((id: any) => id && id !== wro_id))) {
      const ok = await cancelWRO('ALTONA', staleWro as number).catch(() => false);
      notes.push(ok
        ? `Cancelled WRO ${staleWro} from the replaced draft (this draft has its own WRO).`
        : `WRO ${staleWro} from the replaced draft could NOT be auto-cancelled — cancel it in ShipBob so receiving isn't expecting a double-up.`);
    }
    await supabaseLogistics.from('visy_orders').update({ status: 'cancelled' }).eq('subject', subject).eq('status', 'drafted').then(() => {}, () => {});
    notes.push(`Replaced ${supersededDrafts} earlier un-sent draft${supersededDrafts > 1 ? 's' : ''} for this order so there's only one to send.`);
  }
  const draft_id = await gmailCreateDraft(contact.email || '', subject, body, attachment);
  // Record the order so the VISY scour can track its status as Amanda replies.
  await supabaseLogistics.from('visy_orders').insert({
    visy_code: item.visy_code, item: item.name, qty, destination: item.destination,
    draft_id, wro_id: wro_id ?? null, subject, status: 'drafted',
  }).then(() => {}, () => {});
  return { draft_id, to: contact.email || '(no recipient set)', subject, body, destination: item.destination, qty, visy_code: item.visy_code, wro_id, wro_attached, pallets: item.destination === 'ALTONA' ? palletQtys.length : undefined, notes };
}

// When a VISY order draft is actually sent, flip it drafted → ordered (called from send_email_draft).
export async function markVisyOrderSent(draftId: string): Promise<boolean> {
  if (!draftId) return false;
  const { data } = await supabaseLogistics.from('visy_orders')
    .update({ status: 'ordered', sent_at: new Date().toISOString() })
    .eq('draft_id', draftId).eq('status', 'drafted').select('id');
  return !!(data && data.length);
}

export interface VisyOrderRow {
  id: string; visy_code: string | null; item: string | null; qty: number | null; destination: string | null;
  wro_id: number | null; status: string; eta: string | null; last_update: string | null;
  last_email_at: string | null; ordered_at: string | null;
}
// Open/recent VISY orders for the agent ("what's the status of my VISY orders").
export async function getVisyOrders(opts: { openOnly?: boolean } = {}): Promise<VisyOrderRow[]> {
  let q = supabaseLogistics.from('visy_orders')
    .select('id, visy_code, item, qty, destination, wro_id, status, eta, last_update, last_email_at, ordered_at')
    .order('ordered_at', { ascending: false }).limit(40);
  if (opts.openOnly) q = q.not('status', 'in', '("delivered","cancelled")');
  const { data } = await q;
  return (data ?? []) as VisyOrderRow[];
}
