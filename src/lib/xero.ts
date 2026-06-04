// Xero OAuth2 (auth-code) + token storage/refresh + API helper. Server-side only.
import { supabaseLogistics } from './supabase-logistics';

// Minimal valid scopes: offline_access (refresh token) + accounting.transactions
// (read+write — covers reading Purchase Orders now and drafting them later).
export const XERO_SCOPES = ['offline_access', 'accounting.transactions'].join(' ');

const AUTHORIZE = 'https://login.xero.com/identity/connect/authorize';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS = 'https://api.xero.com/connections';
const API_BASE = 'https://api.xero.com/api.xro/2.0';

function basicAuth() {
  const id = process.env.XERO_CLIENT_ID || '';
  const secret = process.env.XERO_CLIENT_SECRET || '';
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

export function authorizeUrl(state: string) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.XERO_CLIENT_ID || '',
    redirect_uri: process.env.XERO_REDIRECT_URI || '',
    scope: XERO_SCOPES,
    state,
  });
  return `${AUTHORIZE}?${p.toString()}`;
}

async function saveToken(t: {
  access_token: string; refresh_token: string; expires_in: number;
  tenant_id?: string; tenant_name?: string;
}) {
  const expires_at = new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString();
  const row: Record<string, unknown> = {
    provider: 'xero', access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at, updated_at: new Date().toISOString(),
  };
  if (t.tenant_id) row.tenant_id = t.tenant_id;
  if (t.tenant_name) row.tenant_name = t.tenant_name;
  await supabaseLogistics.from('integration_tokens').upsert(row, { onConflict: 'provider' });
}

export async function exchangeCode(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: process.env.XERO_REDIRECT_URI || '',
    }),
  });
  if (!res.ok) throw new Error(`Xero token exchange failed: ${res.status} ${await res.text()}`);
  const tok = await res.json();

  // discover the tenant (organisation) to use
  const connRes = await fetch(CONNECTIONS, {
    headers: { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' },
  });
  const conns = connRes.ok ? await connRes.json() : [];
  const au = conns.find((c: any) => /protein pancake/i.test(c.tenantName)) || conns[0];
  await saveToken({ ...tok, tenant_id: au?.tenantId, tenant_name: au?.tenantName });
  return { tenants: conns.map((c: any) => c.tenantName), chosen: au?.tenantName };
}

export async function getConnection() {
  const { data } = await supabaseLogistics.from('integration_tokens').select('*').eq('provider', 'xero').maybeSingle();
  return data as null | {
    access_token: string; refresh_token: string; expires_at: string; tenant_id: string; tenant_name: string;
  };
}

async function refresh(refresh_token: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token }),
  });
  if (!res.ok) throw new Error(`Xero refresh failed: ${res.status} ${await res.text()}`);
  const tok = await res.json();
  await saveToken(tok);
  return tok.access_token as string;
}

// Returns a valid access token + tenant id, refreshing if needed.
export async function getXeroAuth(): Promise<{ token: string; tenant: string } | null> {
  const c = await getConnection();
  if (!c) return null;
  let token = c.access_token;
  if (!c.expires_at || new Date(c.expires_at).getTime() < Date.now()) {
    token = await refresh(c.refresh_token);
  }
  return { token, tenant: c.tenant_id };
}

export async function xeroPost(path: string, body: unknown): Promise<any> {
  const auth = await getXeroAuth();
  if (!auth) throw new Error('Xero not connected');
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Xero-tenant-id': auth.tenant,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Xero POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Create a purchase order in Xero. lines: [{ ItemCode, Quantity, UnitAmount }]
export async function createXeroPurchaseOrder(opts: {
  contactName: string;
  lines: { ItemCode: string; Quantity: number; UnitAmount: number | null }[];
  reference?: string;
  deliveryDate?: string | null;
  status?: 'DRAFT' | 'AUTHORISED';
}): Promise<{ id: string; number: string }> {
  const body = {
    PurchaseOrders: [{
      Contact: { Name: opts.contactName },
      Date: new Date().toISOString().slice(0, 10),
      DeliveryDate: opts.deliveryDate || undefined,
      Reference: opts.reference || undefined,
      Status: opts.status || 'AUTHORISED',
      LineItems: opts.lines.map((l) => ({
        ItemCode: l.ItemCode,
        Quantity: l.Quantity,
        UnitAmount: l.UnitAmount ?? 0,
        AccountCode: '310', // Cost of Goods Sold (matches existing ABC POs)
      })),
    }],
  };
  const res = await xeroPost('/PurchaseOrders', body);
  const po = res.PurchaseOrders?.[0];
  return { id: po?.PurchaseOrderID, number: po?.PurchaseOrderNumber };
}

export async function xeroGet(path: string): Promise<any> {
  const auth = await getXeroAuth();
  if (!auth) throw new Error('Xero not connected');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Xero-tenant-id': auth.tenant,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Xero GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}
