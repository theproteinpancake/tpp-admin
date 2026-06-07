// Xero via Custom Connection (client-credentials grant). Machine-to-machine:
// no consent flow, no refresh token — fetch a short-lived token on demand and cache it.
import { supabaseLogistics } from './supabase-logistics';

const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS = 'https://api.xero.com/connections';
const API_BASE = 'https://api.xero.com/api.xro/2.0';

// For a Custom Connection, request NO scope — Xero issues a token carrying all
// scopes the connection was granted (requesting a specific scope it lacks 500s
// with invalid_scope). The granted set already permits the PurchaseOrders API.
export const XERO_SCOPES = '';

export function xeroConfigured(): boolean {
  return !!process.env.XERO_CLIENT_ID && !!process.env.XERO_CLIENT_SECRET;
}

function basicAuth() {
  return 'Basic ' + Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64');
}

async function cached() {
  const { data } = await supabaseLogistics.from('integration_tokens').select('*').eq('provider', 'xero').maybeSingle();
  return data as null | { access_token: string; expires_at: string; tenant_id: string; tenant_name: string };
}

// Status for the UI — tries to obtain a token so we can show the org name.
export async function getConnection() {
  if (!xeroConfigured()) return null;
  try {
    const auth = await getXeroAuth();
    if (!auth) return null;
    const c = await cached();
    return { tenant_name: c?.tenant_name || 'Custom connection', tenant_id: auth.tenant };
  } catch {
    return null;
  }
}

export async function getXeroAuth(): Promise<{ token: string; tenant: string } | null> {
  if (!xeroConfigured()) return null;
  const c = await cached();
  if (c?.access_token && c.expires_at && new Date(c.expires_at).getTime() > Date.now() && c.tenant_id) {
    return { token: c.access_token, tenant: c.tenant_id };
  }

  // fetch a fresh client-credentials token
  const form = new URLSearchParams({ grant_type: 'client_credentials' });
  if (XERO_SCOPES) form.set('scope', XERO_SCOPES);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!res.ok) throw new Error(`Xero token failed: ${res.status} ${await res.text()}`);
  const tok = await res.json();

  // resolve tenant (the org the custom connection is bound to)
  let tenant_id = c?.tenant_id, tenant_name = c?.tenant_name;
  if (!tenant_id) {
    const conn = await fetch(CONNECTIONS, { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' } });
    const list = conn.ok ? await conn.json() : [];
    const t = list.find((x: any) => /protein pancake/i.test(x.tenantName)) || list[0];
    tenant_id = t?.tenantId; tenant_name = t?.tenantName;
  }

  await supabaseLogistics.from('integration_tokens').upsert({
    provider: 'xero', access_token: tok.access_token,
    expires_at: new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString(),
    tenant_id, tenant_name, refresh_token: null, updated_at: new Date().toISOString(),
  }, { onConflict: 'provider' });

  if (!tenant_id) throw new Error('Xero connected but no organisation found for this custom connection.');
  return { token: tok.access_token, tenant: tenant_id };
}

export async function xeroGet(path: string): Promise<any> {
  const auth = await getXeroAuth();
  if (!auth) throw new Error('Xero not configured');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${auth.token}`, 'Xero-tenant-id': auth.tenant, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Xero GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Fetch a PO as a PDF (Xero's official template) → base64, or null on failure.
export async function getXeroPOPdf(xeroPoId: string): Promise<string | null> {
  if (!xeroPoId) return null;
  try {
    const auth = await getXeroAuth();
    if (!auth) return null;
    const res = await fetch(`${API_BASE}/PurchaseOrders/${xeroPoId}`, {
      headers: { Authorization: `Bearer ${auth.token}`, 'Xero-tenant-id': auth.tenant, Accept: 'application/pdf' },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 1000 && buf.subarray(0, 4).toString('latin1') === '%PDF') return buf.toString('base64');
  } catch { /* pdf optional */ }
  return null;
}

export async function xeroPost(path: string, body: unknown): Promise<any> {
  const auth = await getXeroAuth();
  if (!auth) throw new Error('Xero not configured');
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.token}`, 'Xero-tenant-id': auth.tenant, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Xero POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Mark a Xero PO as BILLED (= delivered/closed for us). Xero allows a direct status
// change on the PurchaseOrders endpoint; it's a status flag, not a ledger posting.
// Best-effort: returns false on any failure so callers can still reconcile locally.
export async function markXeroPOBilled(xeroPoId: string): Promise<boolean> {
  if (!xeroPoId) return false;
  try {
    await xeroPost('/PurchaseOrders', {
      PurchaseOrders: [{ PurchaseOrderID: xeroPoId, Status: 'BILLED' }],
    });
    return true;
  } catch {
    return false;
  }
}

// Resolve a contact's Xero ContactID by name (PO create requires ContactID, not Name).
export async function getXeroContactId(name: string): Promise<string | null> {
  try {
    const r = await xeroGet(`/Contacts?where=${encodeURIComponent(`Name=="${name}"`)}`);
    return r.Contacts?.[0]?.ContactID ?? null;
  } catch {
    return null;
  }
}

// Find an existing (non-deleted) ACCREC invoice by Reference (the customer PO number) —
// so we never invoice the same PO twice.
export async function findInvoiceByReference(reference: string): Promise<{ id: string; number: string; status: string } | null> {
  if (!reference) return null;
  try {
    const r = await xeroGet(`/Invoices?where=${encodeURIComponent(`Type=="ACCREC"&&Reference=="${reference}"`)}`);
    const inv = (r.Invoices ?? []).find((i: any) => i.Status !== 'DELETED' && i.Status !== 'VOIDED');
    return inv ? { id: inv.InvoiceID, number: inv.InvoiceNumber, status: inv.Status } : null;
  } catch {
    return null;
  }
}

// Create a wholesale SALES invoice (ACCREC). Lines by ItemCode (Xero applies the
// item's sales price); GST-free (TaxType NONE, like our products). DRAFT by default.
export async function createXeroInvoice(opts: {
  contactId: string;
  lines: { sku: string; quantity: number }[];
  freight?: number | boolean;  // truthy → add the GST-free FREIGHT item ($15, priced by Xero)
  reference?: string;
  status?: 'DRAFT' | 'AUTHORISED';
}): Promise<{ id: string; number: string; total: number }> {
  const lineItems: any[] = opts.lines.map((l) => ({ ItemCode: l.sku, Quantity: l.quantity, TaxType: 'NONE' }));
  // Freight = the Xero 'FREIGHT' item (Freight Charge, $15, GST-free). Xero applies its price.
  if (opts.freight) lineItems.push({ ItemCode: 'FREIGHT', Quantity: 1, TaxType: 'NONE' });
  const body = {
    Invoices: [{
      Type: 'ACCREC', Contact: { ContactID: opts.contactId },
      Date: new Date().toISOString().slice(0, 10),
      LineAmountTypes: 'Exclusive', Reference: opts.reference || undefined,
      Status: opts.status || 'DRAFT', LineItems: lineItems,
    }],
  };
  const res = await xeroPost('/Invoices', body);
  const inv = res.Invoices?.[0];
  return { id: inv?.InvoiceID, number: inv?.InvoiceNumber, total: Number(inv?.Total) || 0 };
}

// Authorise + email an invoice to the contact's email on file (Xero sends it).
export async function emailXeroInvoice(invoiceId: string): Promise<boolean> {
  try {
    await xeroPost('/Invoices', { Invoices: [{ InvoiceID: invoiceId, Status: 'AUTHORISED' }] });
    await xeroPost(`/Invoices/${invoiceId}/Email`, {});
    return true;
  } catch {
    return false;
  }
}

export async function createXeroPurchaseOrder(opts: {
  contactName: string;
  lines: { ItemCode: string; Quantity: number; UnitAmount: number | null }[];
  reference?: string;
  deliveryDate?: string | null;
  status?: 'DRAFT' | 'AUTHORISED';
}): Promise<{ id: string; number: string }> {
  // Xero rejects Contact-by-Name on PO create; resolve the ContactID first.
  const contactId = await getXeroContactId(opts.contactName);
  const body = {
    PurchaseOrders: [{
      Contact: contactId ? { ContactID: contactId } : { Name: opts.contactName },
      Date: new Date().toISOString().slice(0, 10),
      DeliveryDate: opts.deliveryDate || undefined,
      Reference: opts.reference || undefined,
      Status: opts.status || 'AUTHORISED',
      // TPP mix + syrup are GST-free; TaxType NONE => 0 GST (matches existing POs).
      LineItems: opts.lines.map((l) => ({
        ItemCode: l.ItemCode, Quantity: l.Quantity, UnitAmount: l.UnitAmount ?? 0, AccountCode: '310', TaxType: 'NONE',
      })),
    }],
  };
  const res = await xeroPost('/PurchaseOrders', body);
  const po = res.PurchaseOrders?.[0];
  return { id: po?.PurchaseOrderID, number: po?.PurchaseOrderNumber };
}
