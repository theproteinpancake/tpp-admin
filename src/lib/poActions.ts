// PO drafting/approval actions used by the WhatsApp agent.
import { supabaseLogistics } from './supabase-logistics';
import { getReorderRecommendations } from './reorder';
import { getConnection, createXeroPurchaseOrder, getXeroPOPdf } from './xero';
import { gmailCreateDraft, gmailSendDraft } from './google';

const APP_URL = process.env.PUBLIC_APP_URL || 'https://admin.theproteinpancake.co';

// Where ABC Blending emails go (POs AND WRO/labels replies — Sharon to, Stephen cc).
// Single source of truth so no flow can mis-route to an unmonitored alias. Overridable via env.
export const ABC_PO_TO = process.env.ABC_PO_TO || 'sharon.driscoll@abcblending.com.au';
export const ABC_PO_CC = process.env.ABC_PO_CC || 'stephen@abcblending.com.au';
const PO_SIGNATURE = 'Luke Rolls\nOwner | The Protein Pancake\nP: +61 0412 474 330\nE: luke@theproteinpancake.co';

// Build the ABC PO email (To: Sharon, CC: Stephen, Xero PDF attached).
function poEmailContent(poNumber: string, flavour: string) {
  const of = flavour ? ` of ${flavour}` : '';
  return {
    to: ABC_PO_TO, cc: ABC_PO_CC, subject: 'New PO',
    body: `Hey guys,\n\nJust sending over a new PO${of}.\n\nThanks!\n\n${PO_SIGNATURE}`,
  };
}

// Create (but DON'T send) the ABC PO email as a Gmail draft so Luke can review it
// first. Returns the draft id + the exact contents. Best-effort (null on failure).
export async function draftPOEmailToABC(xeroPoId: string, poNumber: string, flavour: string):
  Promise<{ draft_id: string; to: string; cc: string; subject: string; body: string; attached: boolean } | null> {
  try {
    const pdf = await getXeroPOPdf(xeroPoId);
    const c = poEmailContent(poNumber, flavour);
    const attachment = pdf ? { filename: `${poNumber}.pdf`, base64: pdf } : undefined;
    const draft_id = await gmailCreateDraft(c.to, c.subject, c.body, attachment, c.cc);
    return { draft_id, ...c, attached: !!pdf };
  } catch {
    return null;
  }
}

// Send the pending ABC email for the most-recently-approved PO (the Gmail draft
// created at approval). Called only when Luke explicitly confirms ("send to ABC").
export async function sendLatestPOEmail():
  Promise<{ ok: true; po_number: string; to: string; cc: string } | { error: string }> {
  const { data: po } = await supabaseLogistics.from('purchase_orders')
    .select('id, po_number, email_draft_id')
    .eq('source', 'whatsapp').eq('status', 'placed')
    .not('email_draft_id', 'is', null)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle() as any;
  if (!po?.email_draft_id) return { error: 'No PO email draft is waiting to be sent. Approve a PO first.' };
  try {
    await gmailSendDraft(po.email_draft_id);
    await supabaseLogistics.from('purchase_orders')
      .update({ email_draft_id: null, updated_at: new Date().toISOString() }).eq('id', po.id);
    return { ok: true, po_number: po.po_number, to: ABC_PO_TO, cc: ABC_PO_CC };
  } catch (e) {
    return { error: `Couldn't send the PO email: ${String(e).slice(0, 120)}` };
  }
}

export interface DraftLine { product_id: string; qty_ordered: number; unit_cost: number | null }

// Create a DRAFT PO in our DB (not yet in Xero) for ABC → Altona.
export async function draftWhatsAppPO(lines?: DraftLine[]): Promise<{ id: string; image_url: string; summary: string } | { error: string }> {
  let items = lines;
  if (!items || items.length === 0) {
    const recs = await getReorderRecommendations('ALTONA');
    items = recs.map((r) => ({ product_id: r.product_id, qty_ordered: r.recommend_units, unit_cost: null }));
  }
  if (!items.length) return { error: 'Nothing needs reordering at Altona right now.' };

  // fill unit costs from product COGS where missing
  const { data: prods } = await supabaseLogistics.from('products')
    .select('id, sku, flavour, unit_size_g, cogs').in('id', items.map((i) => i.product_id));
  const byId = new Map((prods ?? []).map((p: any) => [p.id, p]));
  items = items.map((i) => ({ ...i, unit_cost: i.unit_cost ?? byId.get(i.product_id)?.cogs ?? null }));

  const { data: abc } = await supabaseLogistics.from('suppliers').select('id').eq('name', 'ABC Blending').single();
  const { data: altona } = await supabaseLogistics.from('locations').select('id').eq('code', 'ALTONA').single();
  const total = items.reduce((s, i) => s + i.qty_ordered * (i.unit_cost || 0), 0);

  const { data: po, error } = await supabaseLogistics.from('purchase_orders').insert({
    supplier_id: abc?.id, destination_location_id: altona?.id, status: 'draft',
    currency: 'AUD', order_date: new Date().toISOString().slice(0, 10),
    total_cost: total, source: 'whatsapp', reference: 'WhatsApp draft', notes: 'Drafted via WhatsApp assistant',
  }).select('id').single();
  if (error || !po) return { error: 'Could not create draft.' };
  await supabaseLogistics.from('po_items').insert(items.map((i) => ({ ...i, po_id: po.id, qty_received: 0 })));

  const lineSummary = items.map((i) => {
    const p = byId.get(i.product_id);
    const sz = p?.unit_size_g >= 1000 ? `${p.unit_size_g / 1000}kg` : `${p?.unit_size_g}g`;
    return `• ${p?.flavour ?? p?.sku} ${sz} ×${i.qty_ordered}`;
  }).join('\n');
  const summary = `Drafted PO for ABC Blending (→ Altona):\n${lineSummary}\nTotal: AUD ${total.toFixed(2)}`;
  return { id: po.id, image_url: `${APP_URL}/api/whatsapp/po-image/${po.id}`, summary };
}

// Approve the most recent WhatsApp draft → push to Xero as AUTHORISED, then DRAFT
// the ABC email (To: Sharon, CC: Stephen, Xero PDF) for Luke to review. The email
// is NOT sent until Luke confirms with "send to ABC" (sendLatestPOEmail).
export async function approveLatestWhatsAppDraft(flavourFilter?: string): Promise<
  { ok: true; xero_number: string; email_drafted: boolean; email_to: string; email_cc: string; email_subject: string; email_body: string }
  | { error: string }> {
  if (!(await getConnection())) return { error: 'Xero is not connected yet — connect it on the Purchase Orders page first.' };
  // Several drafts can be pending at once (two flavours ordered together) — approving "the
  // latest" blind sent the wrong flavour's PO, so a flavour filter picks the right one.
  const { data: drafts } = await supabaseLogistics.from('purchase_orders')
    .select('id, reference, expected_date, items:po_items(qty_ordered, unit_cost, product:product_id(sku, flavour, unit_size_g))')
    .eq('source', 'whatsapp').eq('status', 'draft')
    .order('created_at', { ascending: false }).limit(10) as any;
  const all = (drafts ?? []) as any[];
  const f = (flavourFilter || '').toLowerCase().trim();
  const po = f
    ? all.find((d) => (d.items || []).some((i: any) => (i.product?.flavour || '').toLowerCase().includes(f)))
    : all[0];
  if (!po) return { error: f ? `No pending draft matches flavour "${flavourFilter}". Pending: ${all.map((d) => [...new Set((d.items || []).map((i: any) => i.product?.flavour).filter(Boolean))].join('/')).join(', ') || 'none'}.` : 'No pending WhatsApp draft to approve.' };
  if (!f && all.length > 1) {
    const flavours = all.map((d) => [...new Set((d.items || []).map((i: any) => i.product?.flavour).filter(Boolean))].join('/'));
    return { error: `MULTIPLE drafts are pending (${flavours.join(', ')}) — ask the user which one and call approve_po with that flavour.` };
  }

  const valid = (po.items || []).filter((i: any) => i.product?.sku);
  const lines = valid.map((i: any) => ({ ItemCode: i.product.sku, Quantity: i.qty_ordered, UnitAmount: i.unit_cost }));
  if (!lines.length) return { error: 'Draft has no valid line items.' };

  // POs are one flavour each; derive it for the email (joins if somehow mixed).
  const flavour = [...new Set(valid.map((i: any) => i.product.flavour).filter(Boolean))].join(', ');

  // Reference in Luke's manual style: "<FLAVOUR> <MONTH> <SIZE>" e.g. "BUTTERMILK JUNE 1T".
  const totalKg = valid.reduce((s: number, i: any) => s + (i.qty_ordered || 0) * ((i.product.unit_size_g || 0) / 1000), 0);
  const sizeTag = totalKg >= 1000 ? `${Number((totalKg / 1000).toFixed(1))}T` : `${Math.round(totalKg)}KG`;
  const month = new Date().toLocaleDateString('en-AU', { month: 'long' }).toUpperCase();
  const reference = [flavour.toUpperCase(), month, totalKg > 0 ? sizeTag : ''].filter(Boolean).join(' ') || 'ABC PO';

  try {
    const xero = await createXeroPurchaseOrder({
      contactName: 'ABC Blending', lines, reference, status: 'AUTHORISED',
    });
    const draft = await draftPOEmailToABC(xero.id, xero.number, flavour);
    await supabaseLogistics.from('purchase_orders')
      .update({ status: 'placed', xero_po_id: xero.id, po_number: xero.number, xero_status: 'AUTHORISED', reference, email_draft_id: draft?.draft_id ?? null, updated_at: new Date().toISOString() })
      .eq('id', po.id);
    return {
      ok: true, xero_number: xero.number, email_drafted: !!draft,
      email_to: ABC_PO_TO, email_cc: ABC_PO_CC,
      email_subject: draft?.subject ?? 'New PO', email_body: draft?.body ?? '',
    };
  } catch (e) {
    return { error: `Xero push failed: ${xeroErrorMessage(e)}` };
  }
}

// Pull the human-readable validation message(s) out of a Xero error blob.
function xeroErrorMessage(e: unknown): string {
  const s = String(e);
  try {
    const json = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
    const msgs: string[] = [];
    for (const el of json.Elements ?? []) for (const v of el.ValidationErrors ?? []) if (v.Message) msgs.push(v.Message);
    if (msgs.length) return msgs.join('; ');
    if (json.Message) return json.Message;
  } catch { /* not JSON */ }
  return s.slice(0, 200);
}
