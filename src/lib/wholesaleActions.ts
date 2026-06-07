// Wholesale order processing: push the ShipBob B2C order + draft the Xero invoice,
// then (on confirm) email the invoice. Called ONLY after Kate confirms the summary.
import { supabaseLogistics } from './supabase-logistics';
import { createB2COrder, findRecentOrderByReference, type B2CRecipient } from './shipbob';
import { createXeroInvoice, emailXeroInvoice, findInvoiceByReference } from './xero';

function normName(s: string): string {
  return (s || '').toLowerCase().replace(/\b(pty|ltd|inc|co|the|p\/l|llc|group)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
async function matchCustomer(name: string): Promise<{ id: string; name: string; xero_contact_id: string | null } | null> {
  const { data } = await supabaseLogistics.from('wholesale_customers').select('id, name, xero_contact_id').eq('is_wholesale', true);
  const target = normName(name); if (!target) return null;
  const tTok = target.split(' ').filter((w) => w.length > 2);
  let best: any = null, score = 0;
  for (const c of (data ?? []) as any[]) {
    const cn = normName(c.name); if (!cn) continue;
    if (cn === target || cn.includes(target) || target.includes(cn)) return c;
    const ov = cn.split(' ').filter((w) => w.length > 2 && tTok.includes(w)).length;
    if (ov > score) { score = ov; best = c; }
  }
  return score >= 2 ? best : null;
}

export interface WholesaleOrderInput {
  customer_name: string;
  recipient: B2CRecipient;                         // ship-to store + address
  lines: { sku: string; cartons: number }[];
  box: string;                                     // PANOUTERSMALL / PANOUTER / PANXLARGE
  free_shipping: boolean;
  po_number?: string;                              // customer PO number (dedup key)
  reference?: string;
  site?: string;
}

export async function createWholesaleOrder(input: WholesaleOrderInput):
  Promise<{ ok: true; shipbob_order_id: number; shipbob_added: string; xero_invoice: string; xero_invoice_id: string; xero_total: number; reused?: string } | { error: string }> {
  const cust = await matchCustomer(input.customer_name);
  if (!cust || !cust.xero_contact_id) return { error: `"${input.customer_name}" isn't on file in Xero yet — add the customer first, then retry.` };
  const site = (input.site || 'ALTONA').toUpperCase();
  const lines = input.lines.filter((l) => l.sku && l.cartons > 0);
  if (!lines.length) return { error: 'No valid order lines.' };

  const poRef = input.po_number || input.reference || '';
  const reference = `TPP-WS-${poRef || Date.now()}`;

  // DEDUP — never double-create. Check our log + Xero (by PO ref) + ShipBob (recent).
  if (poRef) {
    const { data: prior } = await supabaseLogistics.from('wholesale_po_log')
      .select('shipbob_order_id, xero_invoice_id').eq('po_number', poRef).not('shipbob_order_id', 'is', null).limit(1).maybeSingle() as any;
    if (prior?.shipbob_order_id) return { error: `PO ${poRef} was ALREADY processed — ShipBob order #${prior.shipbob_order_id}${prior.xero_invoice_id ? ` / Xero invoice on file` : ''}. Not creating a duplicate.` };
    const existingSbOrder = await findRecentOrderByReference(site, reference).catch(() => null);
    if (existingSbOrder) return { error: `A ShipBob order (#${existingSbOrder.id}) already exists for PO ${poRef}. Not creating a duplicate.` };
  }

  // 1) ShipBob B2C order: carton SKUs + the box
  let order;
  try {
    order = await createB2COrder({
      site, reference, recipient: input.recipient,
      products: [...lines.map((l) => ({ reference_id: l.sku, quantity: l.cartons })), { reference_id: input.box, quantity: 1 }],
    });
  } catch (e) {
    return { error: `ShipBob order failed: ${String(e).slice(0, 160)}` };
  }

  // 2) Xero invoice — reuse an existing one for this PO (don't double-invoice), else DRAFT a new one
  let inv: { id: string; number: string; total: number }; let reused: string | undefined;
  try {
    const existingInv = poRef ? await findInvoiceByReference(poRef) : null;
    if (existingInv) { inv = { id: existingInv.id, number: existingInv.number, total: 0 }; reused = `reused existing Xero invoice ${existingInv.number}`; }
    else {
      inv = await createXeroInvoice({
        contactId: cust.xero_contact_id,
        lines: lines.map((l) => ({ sku: l.sku, quantity: l.cartons })),
        freight: input.free_shipping ? undefined : 15,
        reference: poRef || undefined, status: 'DRAFT',
      });
    }
  } catch (e) {
    return { error: `ShipBob order #${order.id} created, but Xero invoice failed: ${String(e).slice(0, 140)}. Create the invoice manually.` };
  }

  // record in the dedup log
  try {
    await supabaseLogistics.from('wholesale_po_log').insert({
      po_number: poRef || null, customer_name: cust.name, status: 'processed',
      shipbob_order_id: String(order.id), xero_invoice_id: inv.id,
    });
  } catch { /* logging is best-effort */ }

  const added = `${lines.map((l) => `${l.cartons}× ${l.sku}`).join(', ')} + 1× ${input.box} → ${input.recipient.name}, ${input.recipient.city}`;
  return { ok: true, shipbob_order_id: order.id, shipbob_added: added, xero_invoice: inv.number, xero_invoice_id: inv.id, xero_total: inv.total, reused };
}

// Send (authorise + email) the most relevant wholesale invoice once Kate has cross-checked.
export async function sendWholesaleInvoice(invoiceId: string): Promise<{ ok: boolean }> {
  return { ok: await emailXeroInvoice(invoiceId) };
}
