// WRO flow: find Sharon's delivery docket in Gmail, parse it (Claude reads the PDF),
// create the ShipBob WRO with lots, link the PO, and draft the label email back.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { gmailSearch, gmailGetPdfAttachment, gmailListAttachmentNames, gmailCreateDraft } from './google';
import { createWRO, getWROLabels } from './shipbob';
import { ABC_PO_TO, ABC_PO_CC } from './poActions';

const MODEL = 'claude-sonnet-4-6';
// Matches dockets sent directly by ABC AND copies the user forwards in (Sharon sometimes
// emails Luke's Outlook instead of the connected Gmail — a forward comes FROM Luke, so a pure
// from: filter would never find it; braces = Gmail OR).
const ABC_QUERY = 'has:attachment newer_than:30d {from:abcblending.com.au subject:docket subject:shipment subject:pallets subject:"ship bob" filename:shipment}';

export interface DocketLine {
  sku: string; flavour: string; size_g: number;
  lot: string; expiry: string; qty: number;
}
export interface ParsedDocket {
  docket_ref: string | null;
  po_ref: string | null;            // e.g. "PO-0037"
  expected_date: string | null;
  package_type: string | null;
  lines: DocketLine[];
  messageId: string;
  subject: string;
}

export async function findLatestDocket(): Promise<{ messageId: string; subject: string; from: string; date: string; attachment: string } | null> {
  const hits = await gmailSearch(ABC_QUERY, 8);
  // Sharon's subjects vary wildly ("Shipment 001452", "2 pallets ready for Ship Bob",
  // "RE: New PO") — subject-keyword ranking picked the WRONG email twice. The reliable signal
  // is the docket PDF itself: newest hit that actually carries a PDF attachment wins.
  for (const h of hits) {
    const atts = await gmailListAttachmentNames(h.id).catch(() => []);
    const pdf = atts.find((a) => /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.filename));
    if (pdf) return { messageId: h.id, subject: h.subject || '', from: h.from || '', date: h.date || '', attachment: pdf.filename };
  }
  return null;
}

export async function parseDocket(messageId: string, subject = ''): Promise<ParsedDocket> {
  const pdf = await gmailGetPdfAttachment(messageId);
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
Qty is units shipped. "Your Reference: NN" maps to po_ref "PO-00NN" (zero-pad to 4 digits). Reply ONLY with JSON: {"docket_ref":"","po_ref":"PO-00NN","expected_date":"YYYY-MM-DD or null","package_type":"Pallet","lines":[{"sku":"","flavour":"","size_g":520,"lot":"","expiry":"YYYY-MM-DD","qty":0}]}`,
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
  return { ...json, messageId, subject };
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

  let wro;
  try {
    wro = await createWRO({
      site, expected_arrival_date,
      tracking_ref: parsed.docket_ref || 'ABC docket', purchase_order_number: parsed.po_ref || undefined,
      package_type: 'Pallet', items,
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
  return { wro_id: wro.id, status: wro.status, lines: parsed.lines.length, received };
}

const SIGNATURE = 'Luke Rolls\nOwner | The Protein Pancake\nP: +61 0412 474 330\nE: luke@theproteinpancake.co';

// Draft the reply to Sharon with the WRO box labels attached (does not send).
// Returns the EXACT draft so the agent can show it verbatim before sending.
// ALWAYS goes to the canonical ABC address (Sharon to, Stephen cc) — NOT the docket sender,
// which can be an unmonitored alias (a labels reply once went to sharon@ instead of
// sharon.driscoll@ and stalled a shipment). The `to` arg is kept for signature compat but ignored.
export async function draftSharonReply(_to: string, docketRef: string | null, wroId: number, site = 'ALTONA') {
  const to = ABC_PO_TO;
  const cc = ABC_PO_CC;
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
