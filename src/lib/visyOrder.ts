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

// Draft (NOT send) a VISY order email. NO WRO is created at order time (changed 15 Jul): VISY's
// actual manufactured quantity and pallet stacking regularly differ from what we ordered
// (PANLARGE: ordered 2,000, they made 2,110 across 800/800/510 — the pre-made 2×1,000 WRO had
// to be deleted and rebuilt by hand, since ShipBob WROs can't be edited). The WRO + labels are
// now created by createVisyLabels() once Amanda confirms the real pallet configuration.
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

  // ALTONA shipping cartons: WRO deliberately NOT created here — it's built from VISY's real
  // pallet configuration later (createVisyLabels), because their manufactured qty/stacking
  // often differs from the order and ShipBob WROs can't be edited after creation.
  if (item.destination === 'ALTONA') {
    notes.push('No WRO yet — by design. When Amanda replies with the pallet configuration (e.g. "3 pallets: two with 800 and one of 510"), the labels get created from her REAL numbers and emailed back.');
    if (!item.shipbob_inventory_id) notes.push('Note: this carton has no ShipBob inventory id mapped — add it before the labels step or the WRO can\'t be created.');
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
  // (a stale duplicate is what caused a no-op "send" before). Old-flow drafts may still carry a
  // pre-made WRO — cancel those in ShipBob so receiving isn't expecting a double-up.
  const supersededDrafts = await gmailDeleteDraftsBySubject(subject).catch(() => 0);
  if (supersededDrafts) {
    const { data: stale } = await supabaseLogistics.from('visy_orders').select('wro_id').eq('subject', subject).eq('status', 'drafted');
    for (const staleWro of new Set((stale ?? []).map((r: any) => r.wro_id).filter(Boolean))) {
      const ok = await cancelWRO('ALTONA', staleWro as number).catch(() => false);
      notes.push(ok
        ? `Cancelled WRO ${staleWro} from the replaced draft.`
        : `WRO ${staleWro} from the replaced draft could NOT be auto-cancelled — cancel it in ShipBob so receiving isn't expecting a double-up.`);
    }
    await supabaseLogistics.from('visy_orders').update({ status: 'cancelled' }).eq('subject', subject).eq('status', 'drafted').then(() => {}, () => {});
    notes.push(`Replaced ${supersededDrafts} earlier un-sent draft${supersededDrafts > 1 ? 's' : ''} for this order so there's only one to send.`);
  }
  const draft_id = await gmailCreateDraft(contact.email || '', subject, body);
  // Record the order so the VISY scour can track its status as Amanda replies.
  await supabaseLogistics.from('visy_orders').insert({
    visy_code: item.visy_code, item: item.name, qty, destination: item.destination,
    draft_id, wro_id: null, subject, status: 'drafted', // WRO linked later by createVisyLabels from VISY's real pallet config
  }).then(() => {}, () => {});
  return { draft_id, to: contact.email || '(no recipient set)', subject, body, destination: item.destination, qty, visy_code: item.visy_code, notes };
}

// Amanda confirmed the REAL pallet configuration ("3 pallets: two with 800 and one of 510") →
// create the WRO with exactly those boxes (one label page per pallet), draft the labels reply
// to her, and link the WRO to the tracked order. Total = HER numbers, even when they differ
// from what we ordered (VISY manufactures over/under; 2,110 arrived on a 2,000 order).
export async function createVisyLabels(itemQuery: string, pallets: number[]): Promise<
  { ok: true; wro_id: number; pallets: number[]; total: number; draft_id: string; to: string; subject: string; body: string; notes: string[] } | { error: string } | { ambiguous: { name: string; visy_code: string | null }[] }> {
  const clean = (pallets || []).map((p) => Math.round(Number(p))).filter((p) => p > 0);
  if (!clean.length) return { error: 'Need the pallet configuration as units per pallet, e.g. [800, 800, 510].' };
  const { item, candidates } = await resolveVisyItem(itemQuery);
  if (candidates) return { ambiguous: candidates.map((c) => ({ name: c.name, visy_code: c.visy_code })) };
  if (!item) return { error: `No VISY item matching "${itemQuery}".` };
  if (item.destination !== 'ALTONA') return { error: `${item.name} delivers to ABC (no WRO/labels needed) — labels are only for ShipBob Altona shipping cartons.` };
  if (!item.shipbob_inventory_id) return { error: `${item.name} has no ShipBob inventory id mapped — add it on the Packaging page first.` };

  const notes: string[] = [];
  const total = clean.reduce((s2, p2) => s2 + p2, 0);
  const eta = addDays(melbDate(0), 7);
  const wro = await createWRO({
    site: 'ALTONA', expected_arrival_date: eta, tracking_ref: `VISY-${item.visy_code}-${melbDate(0)}`,
    package_type: 'Pallet',
    boxes: clean.map((q) => [{ inventory_id: item.shipbob_inventory_id!, quantity: q }]),
  });
  const labels = await getWROLabels('ALTONA', wro.id);
  if (!labels) notes.push(`WRO ${wro.id} created but the label PDF isn't ready yet — retry create is NOT needed; re-draft the email in a minute.`);

  // Link the WRO to the most recent open order for this code + note the actual quantity.
  const { data: ord } = await supabaseLogistics.from('visy_orders')
    .select('id, qty').eq('visy_code', item.visy_code).not('status', 'in', '("delivered","cancelled")')
    .order('ordered_at', { ascending: false }).limit(1).maybeSingle();
  if (ord) {
    await supabaseLogistics.from('visy_orders').update({ wro_id: wro.id }).eq('id', (ord as any).id).then(() => {}, () => {});
    if ((ord as any).qty && (ord as any).qty !== total) notes.push(`VISY's actual quantity (${total.toLocaleString()}) differs from the order (${Number((ord as any).qty).toLocaleString()}) — normal manufacturing variance; the WRO uses THEIR number.`);
  }

  const contact = await getVisyContact();
  const subject = `RE: NEW ORDER - ${item.linked_sku || item.visy_code || item.sku}`;
  const body = [
    `Hi ${contact.name.split(' ')[0] || 'Amanda'},`,
    '',
    'Thanks so much — pallet labels attached, one per pallet.',
    '',
    VISY_SIGNATURE,
  ].join('\n');
  const draft_id = await gmailCreateDraft(contact.email || '', subject, body,
    labels ? { filename: `WRO-${wro.id}-pallet-labels.pdf`, base64: labels } : undefined);
  return { ok: true, wro_id: wro.id, pallets: clean, total, draft_id, to: contact.email || '(no recipient set)', subject, body, notes };
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
