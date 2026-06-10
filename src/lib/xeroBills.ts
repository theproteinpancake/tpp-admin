// Auto-create Xero BILLS (ACCPAY) from supplier invoices the agent detects in the inbox —
// the "I never enter bills" fix. Once the bill exists in Xero, the bank feed auto-suggests
// the match when it's paid, so reconciling becomes one click for Luke/the accountant.
//
// Account code + contact are copied from the supplier's MOST RECENT existing bill (never
// guessed). With a code we create the bill AUTHORISED (awaiting payment → bank-feed matching
// works); without history we create a DRAFT for the accountant to code. Deduped by invoice
// number. Status flows back: detected → in_xero → paid (syncDetectedBillStatuses).
import { supabaseLogistics } from './supabase-logistics';
import { xeroGet, xeroPost, getXeroContactId } from './xero';

const esc = (s: string) => s.replace(/"/g, '');

// Find the supplier's latest bill → copy contact + line account code.
async function supplierTemplate(supplier: string): Promise<{ contactId: string | null; accountCode: string | null }> {
  const contactId = await getXeroContactId(supplier).catch(() => null);
  if (!contactId) return { contactId: null, accountCode: null };
  try {
    const j = await xeroGet(`/Invoices?where=Type=="ACCPAY" AND Contact.ContactID==Guid("${contactId}")&order=Date DESC&page=1`);
    const prior = (j?.Invoices ?? [])[0];
    const code = prior?.LineItems?.[0]?.AccountCode || null;
    return { contactId, accountCode: code };
  } catch { return { contactId, accountCode: null }; }
}

export async function billExistsInXero(invoiceNumber: string): Promise<{ id: string; status: string } | null> {
  try {
    const j = await xeroGet(`/Invoices?where=Type=="ACCPAY" AND InvoiceNumber=="${esc(invoiceNumber)}"`);
    const inv = (j?.Invoices ?? [])[0];
    return inv ? { id: inv.InvoiceID, status: inv.Status } : null;
  } catch { return null; }
}

// Create the bill for a detected_bills row. Returns what happened for the notify message.
export async function createXeroBill(bill: { id: string; supplier: string; invoice_number: string; amount: number; currency: string; due_date: string | null }):
  Promise<{ created: boolean; status?: string; note: string }> {
  // already in Xero? just link it
  const existing = await billExistsInXero(bill.invoice_number);
  if (existing) {
    await supabaseLogistics.from('detected_bills').update({ status: 'in_xero', xero_invoice_id: existing.id, xero_status: existing.status }).eq('id', bill.id);
    return { created: false, status: existing.status, note: `Bill ${bill.invoice_number} already in Xero (${existing.status}).` };
  }
  const tpl = await supplierTemplate(bill.supplier);
  if (!tpl.contactId) return { created: false, note: `No Xero contact found for "${bill.supplier}" — left as detected (visible on Money page).` };

  const authorise = !!tpl.accountCode;
  const body = {
    Invoices: [{
      Type: 'ACCPAY',
      Contact: { ContactID: tpl.contactId },
      InvoiceNumber: bill.invoice_number,
      ...(bill.due_date ? { DueDate: bill.due_date } : {}),
      CurrencyCode: bill.currency || 'AUD',
      LineAmountTypes: 'Inclusive',
      Status: authorise ? 'AUTHORISED' : 'DRAFT',
      LineItems: [{
        Description: `${bill.supplier} invoice ${bill.invoice_number} (auto-captured from inbox by TPP Control)`,
        Quantity: 1, UnitAmount: bill.amount,
        ...(tpl.accountCode ? { AccountCode: tpl.accountCode } : {}),
      }],
    }],
  };
  try {
    const j = await xeroPost('/Invoices', body);
    const inv = (j?.Invoices ?? [])[0];
    if (!inv?.InvoiceID) return { created: false, note: `Xero rejected bill ${bill.invoice_number}: ${JSON.stringify(j?.Elements?.[0]?.ValidationErrors || j).slice(0, 160)}` };
    await supabaseLogistics.from('detected_bills').update({ status: 'in_xero', xero_invoice_id: inv.InvoiceID, xero_status: inv.Status }).eq('id', bill.id);
    return { created: true, status: inv.Status, note: authorise
      ? `Bill ${bill.invoice_number} ($${Math.round(bill.amount).toLocaleString()}) entered in Xero as AWAITING PAYMENT — it'll auto-match in bank reconciliation when paid.`
      : `Bill ${bill.invoice_number} ($${Math.round(bill.amount).toLocaleString()}) DRAFTED in Xero (no prior ${bill.supplier} bill to copy the account code from — accountant to code it once; future ones will authorise automatically).` };
  } catch (e) {
    return { created: false, note: `Xero bill create failed for ${bill.invoice_number}: ${String(e).slice(0, 140)}` };
  }
}

// Sync Xero status back (e.g. PAID after reconciliation) so the Money page stays truthful.
export async function syncDetectedBillStatuses(): Promise<number> {
  const { data } = await supabaseLogistics.from('detected_bills')
    .select('id, xero_invoice_id, xero_status').eq('status', 'in_xero').not('xero_invoice_id', 'is', null).limit(25);
  let updated = 0;
  for (const b of (data ?? []) as any[]) {
    try {
      const j = await xeroGet(`/Invoices/${b.xero_invoice_id}`);
      const st = (j?.Invoices ?? [])[0]?.Status;
      if (st && st !== b.xero_status) {
        await supabaseLogistics.from('detected_bills').update({ xero_status: st, ...(st === 'PAID' ? { status: 'paid' } : {}) }).eq('id', b.id);
        updated++;
      }
    } catch { /* per-bill best-effort */ }
  }
  return updated;
}
