// WRO flow: find Sharon's delivery docket in Gmail, parse it (Claude reads the PDF),
// create the ShipBob WRO with lots, link the PO, and draft the label email back.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { gmailSearch, gmailGetPdfAttachment, gmailListAttachmentNames, gmailCreateDraft } from './google';
import { createWRO, getWROLabels } from './shipbob';
import { ABC_PO_TO, ABC_CC } from './poActions';

const MODEL = 'claude-sonnet-4-6';
// Matches dockets sent directly by ABC AND copies the user forwards in (Sharon sometimes
// emails Luke's Outlook instead of the connected Gmail — a forward comes FROM Luke, so a pure
// from: filter would never find it; braces = Gmail OR).
const ABC_QUERY = 'has:attachment newer_than:30d {from:abcblending.com.au subject:docket subject:shipment subject:pallets subject:"ship bob" filename:shipment}';

export interface DocketLine {
  sku: string; flavour: string; size_g: number;
  lot: string; expiry: string; qty: number;
}
// One physical pallet, as Sharon writes it in the docket's Note field:
//   "1 x 43 boxes x 520gms + 43 boxes x 80gms"  →  { contents: [{size_g:520,boxes:43},{size_g:80,boxes:43}] }
export interface DocketPallet { contents: { sku?: string | null; size_g: number; boxes: number }[] }

export interface ParsedDocket {
  docket_ref: string | null;
  po_ref: string | null;            // e.g. "PO-0037"
  expected_date: string | null;
  package_type: string | null;
  lines: DocketLine[];
  pallet_count: number | null;      // from the Note field
  pallets: DocketPallet[];          // per-pallet box breakdown, [] when the Note doesn't give one
  note: string | null;              // the raw Note text, so a human can check our reading
  messageId: string;
  subject: string;
  attachment?: string;
}

export interface DocketCandidate {
  messageId: string; subject: string; from: string; date: string; attachment: string;
}

/**
 * EVERY docket PDF on the newest ABC email that has one — not just the first.
 *
 * Sharon routinely completes two flavours in one run and attaches a docket for each ("We have
 * completed both Buttermilk & Chocolate – delivery docket attached"). The old finder returned
 * the first PDF and stopped, so the Chocolate docket was invisible; when Luke asked for it
 * directly the agent truthfully reported it couldn't find one, and he had to send the PDF by
 * hand. Each attachment is now its own candidate, and the caller processes them all.
 *
 * Subjects vary wildly ("Shipment 001452", "2 pallets ready for Ship Bob", "RE: New PO"), so
 * the reliable signal remains the PDF itself rather than subject-keyword ranking.
 */
export async function findDockets(): Promise<DocketCandidate[]> {
  const hits = await gmailSearch(ABC_QUERY, 8);

  // Walk the whole conversation, not just the newest message with a PDF. On the 30 Jul run the
  // dockets were spread across it: Sharon's original carried BOTH (001529 + 001530), then Luke
  // forwarded 001530 on its own and replied with our label PDF. Stopping at the newest
  // docket-bearing message would surface only the forwarded one and hide 001529 — the same
  // class of miss as taking the first attachment.
  const seen = new Set<string>();
  const out: DocketCandidate[] = [];
  let thread: string | null = null;

  for (const h of hits) {
    // Once we've locked onto a delivery conversation, stay in it — older threads are past runs.
    if (thread && h.threadId !== thread) break;
    const atts = await gmailListAttachmentNames(h.id).catch(() => []);
    const pdfs = atts.filter((a) => /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.filename));
    // Our OWN outgoing label PDFs sit on these threads (Luke's "labels attached" reply is often
    // the newest message). Skip them — feeding a label PDF to the parser finds no docket lines.
    const dockets = pdfs.filter((a) => !/wro[_-]?\d+|boxlabel|label/i.test(a.filename));
    if (!dockets.length) continue;
    thread ??= h.threadId;
    for (const p of dockets) {
      // Same docket forwarded again is the same docket.
      if (seen.has(p.filename)) continue;
      seen.add(p.filename);
      out.push({ messageId: h.id, subject: h.subject || '', from: h.from || '', date: h.date || '', attachment: p.filename });
    }
  }
  return out;
}

/** First docket only — kept for callers that want a single result. */
export async function findLatestDocket(): Promise<DocketCandidate | null> {
  return (await findDockets())[0] ?? null;
}

export async function parseDocket(messageId: string, subject = '', attachment?: string): Promise<ParsedDocket> {
  const pdf = await gmailGetPdfAttachment(messageId, attachment);
  if (!pdf) throw new Error('No PDF attachment found on that email.');

  const { data: products } = await supabaseLogistics.from('products')
    .select('sku, flavour, unit_size_g').eq('active', true).eq('category', 'mix');
  const skuList = (products ?? []).map((p: any) =>
    `${p.sku} = ${p.flavour} ${p.unit_size_g >= 1000 ? p.unit_size_g / 1000 + 'kg' : p.unit_size_g + 'g'}`).join('; ');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 1500,
    system: `You read an ABC Blending delivery docket PDF and extract receiving data as JSON.
Our SKUs: ${skuList}.
Map each product line to the matching SKU by flavour + size. Lot is the "Serial/Lot Nbr". Expiry is its Expiry/Best-Before date.
CRITICAL — dates: ABC/Sharon write dates in AUSTRALIAN format DD/MM/YYYY (day first). Interpret every date that way and output ISO YYYY-MM-DD. NEVER swap day and month — e.g. "03/08/2027" = 3 August 2027 = 2027-08-03 (not 8 March). A "21/08/2027" style value where the first number is >12 is your confirmation day comes first. Best-befores must be a FUTURE date; if your parse yields a past date you've misread it.
Qty is units shipped. "Your Reference: NN" maps to po_ref "PO-00NN" (zero-pad to 4 digits).

THE "Note:" FIELD IS IMPORTANT — it is how ABC tell us the PALLET CONFIGURATION, and we print one shipping label per pallet, so getting it wrong means the driver is short of labels. It reads like:
  3 pallets
  1 x 43 boxes x 520gms + 43 boxes x 80gms
  1 x 80 boxes x 520gms
  1 x 120 boxes x 320gms
Each line after the count is ONE pallet ("1 x ..." means one pallet built like this); a "+" joins two products stacked on that SAME pallet. Copy the Note text verbatim into "note", put the stated total in "pallet_count", and give one entry in "pallets" per pallet, in the order written. For each pallet content give BOTH the gram size as written (520gms → 520, 1kg → 1000) AND, when the Note names the product/flavour ("GF Cinnamon Churro 520g - 78 boxes"), the matching SKU from Our SKUs — the sku is what disambiguates two products of the same size on different pallets, so never omit it when the flavour is stated; use null only when the Note truly gives size alone. If there is no Note or it says nothing about pallets, set pallet_count null and pallets [] — never invent a split.

Reply ONLY with JSON: {"docket_ref":"","po_ref":"PO-00NN","expected_date":"YYYY-MM-DD or null","package_type":"Pallet","note":"raw Note text or null","pallet_count":3,"pallets":[{"contents":[{"sku":"BMM","size_g":520,"boxes":43},{"size_g":80,"boxes":43}]}],"lines":[{"sku":"","flavour":"","size_g":520,"lot":"","expiry":"YYYY-MM-DD","qty":0}]}`,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.base64 } },
        { type: 'text', text: 'Extract the receiving data as JSON.' },
      ],
    }],
  });
  const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return { pallet_count: null, pallets: [], note: null, ...json, messageId, subject, attachment: pdf.filename };
}

/**
 * Turn the docket's pallet Note into ShipBob boxes — one box per physical pallet, which is what
 * gives the labels PDF a page per pallet.
 *
 * Sharon's Note gives BOXES per pallet, not units, so units-per-box is derived from the docket
 * itself: a size's total ShipBob quantity divided by its total boxes across all pallets. For the
 * 30 Jul Buttermilk docket that's 1,476 units over 123 boxes of 520g = 12 per box, splitting
 * 43/80 boxes into 516/960 units. Any rounding remainder lands on the last pallet holding that
 * size, so the per-pallet quantities always re-add to the docket total exactly.
 *
 * Bails out to a single pallet (with a reason) rather than guessing whenever the Note can't be
 * reconciled — two lines sharing one gram size, a size in the Note that isn't on the docket, or
 * a box count that doesn't divide. A wrong split would mis-state what's physically on each
 * pallet to the receiving warehouse, which is worse than one label to hand-copy.
 */
export function planPallets(
  lines: DocketLine[],
  pallets: DocketPallet[],
  qtyFor: (l: DocketLine) => number,
  invFor: (l: DocketLine) => number,
): { boxes?: { inventory_id: number; quantity: number; lot_number?: string | null; expiration_date?: string | null }[][]; reason?: string } {
  if (!pallets?.length) return { reason: 'the docket Note gave no pallet breakdown' };
  if (pallets.length === 1) return { reason: 'single pallet' };

  // Resolve each pallet content to a docket LINE — by SKU when the Note names the flavour
  // (which it does whenever two products share a size: "GF Cinnamon Churro 520g - 78 boxes" vs
  // "Cinnamon Churro 520g - 80 boxes"), by size only when that size is unambiguous. The first
  // version matched on size alone and refused docket 001592 outright, so a 3-pallet delivery
  // shipped with a 1-of-1 label.
  const bySku = new Map(lines.map((l) => [l.sku.toUpperCase(), l]));
  const bySize = new Map<number, DocketLine[]>();
  for (const l of lines) bySize.set(l.size_g, [...(bySize.get(l.size_g) ?? []), l]);
  const resolve = (c: { sku?: string | null; size_g: number }): DocketLine | string => {
    if (c.sku && bySku.has(String(c.sku).toUpperCase())) return bySku.get(String(c.sku).toUpperCase())!;
    const sized = bySize.get(c.size_g) ?? [];
    if (sized.length === 1) return sized[0];
    if (!sized.length) return `the Note mentions ${c.size_g}g but the docket has no ${c.size_g}g line`;
    return `${sized.length} docket lines are ${c.size_g}g and the Note doesn't name which flavour this pallet holds`;
  };

  // Per-LINE totals of the boxes the Note claims, so units-per-box is derived per line and any
  // note-vs-docket disagreement (ABC's box counts are occasionally approximate) is absorbed
  // proportionally — per-pallet quantities always re-add to the docket total exactly.
  const totalBoxes = new Map<string, number>();
  for (const p of pallets) for (const c of p.contents || []) {
    const r = resolve(c);
    if (typeof r === 'string') return { reason: r };
    totalBoxes.set(r.sku, (totalBoxes.get(r.sku) ?? 0) + (Number(c.boxes) || 0));
  }
  for (const l of lines) {
    if (!totalBoxes.get(l.sku)) return { reason: `the Note doesn't say which pallet the ${l.flavour} ${l.size_g}g goes on` };
  }

  // Last pallet carrying each line soaks up the rounding remainder.
  const lastFor = new Map<string, number>();
  pallets.forEach((p, i) => { for (const c of p.contents || []) { const r = resolve(c); if (typeof r !== 'string') lastFor.set(r.sku, i); } });

  const running = new Map<string, number>();
  const boxes = pallets.map((p, i) => (p.contents || []).map((c) => {
    const line = resolve(c) as DocketLine;
    const total = qtyFor(line);
    const isLast = lastFor.get(line.sku) === i;
    const share = isLast
      ? total - (running.get(line.sku) ?? 0)
      : Math.round(total * (Number(c.boxes) || 0) / totalBoxes.get(line.sku)!);
    running.set(line.sku, (running.get(line.sku) ?? 0) + share);
    return { inventory_id: invFor(line), quantity: share, lot_number: line.lot, expiration_date: line.expiry };
  }).filter((b) => b.inventory_id && b.quantity > 0));

  if (boxes.some((b) => !b.length)) return { reason: 'a pallet came out empty after splitting the quantities' };
  return { boxes };
}

// Create the WRO in ShipBob (Altona), record lots, link the PO.
export async function createWROFromParsed(parsed: ParsedDocket, site = 'ALTONA') {
  // IDEMPOTENT: if this PO already has a WRO, return it instead of creating a duplicate.
  // ShipBob rejects a repeated PO reference with a 422 ("PO reference already exists"), so the
  // agent calling create_wro a second time (e.g. when the user says "send") must NOT blow up —
  // the WRO is already made; just hand it back so the flow can proceed to Sharon's reply.
  if (parsed.po_ref) {
    const { data: existingPo } = await supabaseLogistics.from('purchase_orders')
      .select('shipbob_wro_id, wro_status').eq('po_number', parsed.po_ref).maybeSingle();
    if ((existingPo as any)?.shipbob_wro_id) {
      return { wro_id: Number((existingPo as any).shipbob_wro_id), status: (existingPo as any).wro_status || 'AwaitingArrival', lines: parsed.lines.length, already_existed: true };
    }
  }
  const { data: loc } = await supabaseLogistics.from('locations').select('id').eq('code', site).single();
  const { data: pls } = await supabaseLogistics.from('product_locations')
    .select('shipbob_inventory_id, shipbob_units_per, product_id, products(sku)').eq('location_id', loc!.id);
  const invBySku = new Map((pls ?? []).map((p: any) => [p.products?.sku, p.shipbob_inventory_id]));
  const pidBySku = new Map((pls ?? []).map((p: any) => [p.products?.sku, p.product_id]));
  const perBySku = new Map((pls ?? []).map((p: any) => [p.products?.sku, Number(p.shipbob_units_per) || 1]));

  // Dockets list POUCH units, but some ShipBob inventories are multi-packs — every 320g SKU
  // maps to a "Wholesale (4)" SRP carton — so the WRO quantity is units ÷ shipbob_units_per.
  // Sending raw units inflated receiving 4× (docket 001445: 168 pouches went in as 168 cartons
  // instead of 42). A non-whole carton count means a misread docket or a genuinely loose pouch
  // — refuse loudly rather than create a wrong WRO.
  const items = parsed.lines.map((l) => {
    const per = perBySku.get(l.sku) ?? 1;
    if (l.qty % per !== 0) {
      throw new Error(`${l.sku}: docket qty ${l.qty} isn't a whole number of ${per}-pouch cartons (the ShipBob inventory is the carton). Check the docket with the user before creating the WRO.`);
    }
    return {
      inventory_id: Number(invBySku.get(l.sku)),
      quantity: l.qty / per, lot_number: l.lot, expiration_date: l.expiry,
    };
  }).filter((i) => i.inventory_id);
  if (!items.length) throw new Error('No docket lines matched a known SKU.');

  // ShipBob rejects past arrival dates. The date is only a rough guide, so if the
  // docket's date is missing or in the past, default to tomorrow (T+1).
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const expected_arrival_date = parsed.expected_date && parsed.expected_date > today ? parsed.expected_date : tomorrow;

  // One ShipBob box per physical pallet → one label page per pallet. Sharon's 30 Jul Buttermilk
  // delivery was three pallets and went out with a single label, which Luke had to fix by hand.
  const plan = planPallets(
    parsed.lines, parsed.pallets || [],
    (l) => l.qty / (perBySku.get(l.sku) ?? 1),
    (l) => Number(invBySku.get(l.sku)),
  );
  const pallet_count = plan.boxes?.length ?? 1;

  let wro;
  try {
    wro = await createWRO({
      site, expected_arrival_date,
      tracking_ref: parsed.docket_ref || 'ABC docket', purchase_order_number: parsed.po_ref || undefined,
      package_type: 'Pallet', ...(plan.boxes ? { boxes: plan.boxes } : { items }),
    });
  } catch (e) {
    // Backstop: ShipBob says the PO reference already exists → a WRO was already made for it
    // (but we didn't have it linked). Don't fail the flow; surface it as already-existing.
    if (/already exists|unique value|422/i.test(String(e)) && parsed.po_ref) {
      const { data: po } = await supabaseLogistics.from('purchase_orders').select('shipbob_wro_id, wro_status').eq('po_number', parsed.po_ref).maybeSingle();
      if ((po as any)?.shipbob_wro_id) return { wro_id: Number((po as any).shipbob_wro_id), status: (po as any).wro_status || 'AwaitingArrival', lines: parsed.lines.length, already_existed: true };
      throw new Error(`A WRO for PO ${parsed.po_ref} already exists at ShipBob — open Receiving in ShipBob to get its number, then I can draft Sharon's reply with the labels.`);
    }
    throw e;
  }

  // record lots + link PO
  for (const l of parsed.lines) {
    const pid = pidBySku.get(l.sku);
    if (!pid) continue;
    await supabaseLogistics.from('inventory_lots').upsert({
      location_id: loc!.id, product_id: pid, lot_number: l.lot, expiry_date: l.expiry,
      on_hand: l.qty, source: 'wro', updated_at: new Date().toISOString(),
    }, { onConflict: 'location_id,product_id,lot_number' });
  }
  if (parsed.po_ref) {
    await supabaseLogistics.from('purchase_orders')
      .update({ wro_created: true, shipbob_wro_id: String(wro.id), wro_status: wro.status, updated_at: new Date().toISOString() })
      .eq('po_number', parsed.po_ref);
  }
  const received = parsed.lines.map((l) => {
    const per = perBySku.get(l.sku) ?? 1;
    return { sku: l.sku, lot: l.lot, docket_units: l.qty, shipbob_qty: l.qty / per, ...(per > 1 ? { note: `${per}-pouch cartons` } : {}) };
  });
  // Surface the pallet decision so the agent can state the label count — and say plainly when
  // the docket claimed more pallets than we could split, since that's a hand-fix before sending.
  const claimed = parsed.pallet_count ?? null;
  const pallets = {
    labels: pallet_count,
    ...(claimed ? { docket_says: claimed } : {}),
    ...(plan.boxes
      ? { split: plan.boxes.map((b, i) => `pallet ${i + 1}: ${b.map((x) => x.quantity).join(' + ')}`).join('; ') }
      : { note: `built as ONE pallet — ${plan.reason}` }),
    ...(claimed && claimed !== pallet_count
      ? { warning: `The docket says ${claimed} pallets but the labels PDF will only have ${pallet_count}. Tell the user to add the missing pallet labels by hand in ShipBob before sending them to Sharon.` }
      : {}),
  };
  return { wro_id: wro.id, status: wro.status, lines: parsed.lines.length, received, pallets };
}

const SIGNATURE = 'Luke Rolls\nOwner | The Protein Pancake\nP: +61 0412 474 330\nE: luke@theproteinpancake.co';

// Draft the reply to Sharon with the WRO box labels attached (does not send).
// Returns the EXACT draft so the agent can show it verbatim before sending.
// ALWAYS goes to the canonical ABC address (Sharon to, Stephen cc) — NOT the docket sender,
// which can be an unmonitored alias (a labels reply once went to sharon@ instead of
// sharon.driscoll@ and stalled a shipment). The `to` arg is kept for signature compat but ignored.
export async function draftSharonReply(_to: string, docketRef: string | null, wroId: number, site = 'ALTONA') {
  const to = ABC_PO_TO;
  const cc = ABC_CC;
  const subject = 'Pallet labels';
  const body = `Hi Sharon,\n\nThanks for that. Labels attached!\n\n${SIGNATURE}`;
  let attached = false;
  let attachment;
  try {
    const labels = await getWROLabels(site, wroId);
    if (labels) { attachment = { filename: `WRO-${wroId}-labels.pdf`, base64: labels }; attached = true; }
  } catch { /* labels optional — draft still useful */ }
  const draft_id = await gmailCreateDraft(to, subject, body, attachment, cc);
  return { draft_id, to, cc, subject, body, attached };
}
