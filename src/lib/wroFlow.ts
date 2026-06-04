// WRO flow: find Sharon's delivery docket in Gmail, parse it (Claude reads the PDF),
// create the ShipBob WRO with lots, link the PO, and draft the label email back.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { gmailSearch, gmailGetPdfAttachment, gmailCreateDraft } from './google';
import { createWRO } from './shipbob';

const MODEL = 'claude-sonnet-4-6';
const ABC_QUERY = 'from:abcblending.com.au has:attachment newer_than:30d';

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

export async function findLatestDocket(): Promise<{ messageId: string; subject: string; from: string; date: string } | null> {
  const hits = await gmailSearch(ABC_QUERY, 5);
  const docket = hits.find((h) => /docket|packing|shipment|delivery/i.test(h.subject || '')) || hits[0];
  if (!docket) return null;
  return { messageId: docket.id, subject: docket.subject || '', from: docket.from || '', date: docket.date || '' };
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
Map each product line to the matching SKU by flavour + size. Lot is the "Serial/Lot Nbr". Expiry is its Expiry date (output YYYY-MM-DD). Qty is units shipped. "Your Reference: NN" maps to po_ref "PO-00NN" (zero-pad to 4 digits). Reply ONLY with JSON: {"docket_ref":"","po_ref":"PO-00NN","expected_date":"YYYY-MM-DD or null","package_type":"Pallet","lines":[{"sku":"","flavour":"","size_g":520,"lot":"","expiry":"YYYY-MM-DD","qty":0}]}`,
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
  const { data: loc } = await supabaseLogistics.from('locations').select('id').eq('code', site).single();
  const { data: pls } = await supabaseLogistics.from('product_locations')
    .select('shipbob_inventory_id, product_id, products(sku)').eq('location_id', loc!.id);
  const invBySku = new Map((pls ?? []).map((p: any) => [p.products?.sku, p.shipbob_inventory_id]));
  const pidBySku = new Map((pls ?? []).map((p: any) => [p.products?.sku, p.product_id]));

  const items = parsed.lines.map((l) => ({
    inventory_id: Number(invBySku.get(l.sku)),
    quantity: l.qty, lot_number: l.lot, expiration_date: l.expiry,
  })).filter((i) => i.inventory_id);
  if (!items.length) throw new Error('No docket lines matched a known SKU.');

  const wro = await createWRO({
    site, expected_arrival_date: parsed.expected_date || new Date().toISOString().slice(0, 10),
    tracking_ref: parsed.docket_ref || 'ABC docket', purchase_order_number: parsed.po_ref || undefined,
    package_type: 'Pallet', items,
  });

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
  return { wro_id: wro.id, status: wro.status, lines: parsed.lines.length };
}

// Draft the reply to Sharon (does not send).
export async function draftSharonReply(to: string, docketRef: string | null, wroId: number) {
  const subject = `WRO ${wroId} — ready for freight${docketRef ? ` (docket ${docketRef})` : ''}`;
  const body = `Hi Sharon,\n\nThanks — I've created the WRO in ShipBob (WRO ${wroId}). You're right to organise freight to ShipBob now; the WRO labels are attached.\n\nCheers,\nLuke`;
  return gmailCreateDraft(to, subject, body);
}
