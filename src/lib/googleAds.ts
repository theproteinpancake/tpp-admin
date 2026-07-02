// Google Ads API — read-only account-level reporting for the weekly analytics.
// Mirrors meta.ts's shape (spend/roas/purchases/cpa) so autofillWeek() can treat both channels
// identically. Google doesn't expose a native "incrementality" metric via Basic Access the way
// Meta does, so NC ROAS/NC CPA always come from our own click-based attribution_rollup (the same
// fallback Meta uses when its incrementality data isn't available) — wired in analytics.ts.
import { getGoogleToken } from './google';
import { getConfig, setConfig } from './settings';

// Google sunsets each major version ~1 year after release (v19 died 11 Feb 2026 — the original
// build shipped with it already dead, surfacing as an HTML 404 the JSON parse choked on).
// Override via env when the next sunset lands; the error below says exactly when that happens.
const ADS_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v23';

// GOOGLE_ADS_CUSTOMER_ID in env is actually the MANAGER (MCC) account, and Google refuses
// metrics queries against a manager (QueryError.REQUESTED_METRICS_FOR_MANAGER) — metrics must
// target the client ad account, with login-customer-id set to the manager. Rather than making
// the env config load-bearing, the first metrics failure triggers a customer_client discovery
// on the manager and the resolved client id is cached here (app_config).
const EFFECTIVE_ID_KEY = 'google_ads_effective_customer_id';

export function googleAdsConfigured() {
  return !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN && !!process.env.GOOGLE_ADS_CUSTOMER_ID;
}

const digits = (s?: string) => (s || '').replace(/[^0-9]/g, '');

async function adsSearch(customerId: string, query: string, token: string, loginId?: string): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    'Content-Type': 'application/json',
  };
  if (loginId && loginId !== customerId) headers['login-customer-id'] = loginId;
  const res = await fetch(`https://googleads.googleapis.com/${ADS_VERSION}/customers/${customerId}/googleAds:search`, {
    method: 'POST', headers, body: JSON.stringify({ query }),
  });
  // Read as text first: a sunset API version returns an HTML 404 page, and res.json() on that
  // produced the useless "Unexpected token '<'" error that hid the real cause.
  const raw = await res.text();
  if (!res.ok) {
    const hint = res.status === 404 ? ` — Google Ads API ${ADS_VERSION} may be sunset; set GOOGLE_ADS_API_VERSION to a current version` : '';
    // The generic message ("Request contains an invalid argument") comes first; the actually
    // useful field-level errors live in error.details — surface those, not the preamble.
    let detail = raw.slice(0, 600);
    try { const e = JSON.parse(raw).error; detail = JSON.stringify(e.details ?? e.message ?? e).slice(0, 600); } catch { /* keep raw */ }
    throw new Error(`Google Ads ${res.status}${hint}: ${detail}`);
  }
  return JSON.parse(raw);
}

// Find the enabled non-manager ad account to query metrics against. Two paths, because the
// account can hang off the manager OR just be directly accessible to the OAuth login:
// 1) customer_client children of the manager (to depth 2, covers sub-managers)
// 2) listAccessibleCustomers — every account the OAuth user can reach directly
async function resolveClientAccount(managerId: string, token: string): Promise<{ id: string; viaManager: boolean }> {
  const notes: string[] = [];
  try {
    const j = await adsSearch(
      managerId,
      'SELECT customer_client.id, customer_client.status, customer_client.manager FROM customer_client WHERE customer_client.level <= 2',
      token,
      managerId,
    );
    const all = (j.results || []).map((r: any) => r.customerClient).filter(Boolean);
    const clients = all.filter((c: any) => !c.manager && c.status === 'ENABLED' && digits(String(c.id)) !== managerId);
    if (clients.length) return { id: digits(String(clients[0].id)), viaManager: true };
    notes.push(`manager children: ${all.map((c: any) => `${c.id}(${c.status}${c.manager ? ',mgr' : ''})`).join(', ') || 'none'}`);
  } catch (e) { notes.push(`customer_client lookup failed: ${String(e).slice(0, 120)}`); }

  const res = await fetch(`https://googleads.googleapis.com/${ADS_VERSION}/customers:listAccessibleCustomers`, {
    headers: { Authorization: `Bearer ${token}`, 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '' },
  });
  if (res.ok) {
    const ids = (((await res.json()).resourceNames || []) as string[]).map((n) => digits(n.split('/')[1] || '')).filter((id) => id && id !== managerId);
    for (const id of ids) {
      try {
        const j = await adsSearch(id, 'SELECT customer.id, customer.manager, customer.status FROM customer', token);
        const c = j.results?.[0]?.customer;
        if (c && !c.manager && c.status === 'ENABLED') return { id, viaManager: false };
        notes.push(`${id}: ${c ? `${c.status}${c.manager ? ',mgr' : ''}` : 'no row'}`);
      } catch (e) { notes.push(`${id}: ${String(e).slice(0, 80)}`); }
    }
    if (!ids.length) notes.push('listAccessibleCustomers: only the manager itself');
  } else notes.push(`listAccessibleCustomers ${res.status}`);

  throw new Error(`Google Ads: no enabled ad account found (${managerId} is a manager; metrics need the client account). ${notes.join(' | ')}`.slice(0, 500));
}

export interface GoogleWeek { spend: number; roas: number | null; purchases: number; cpa: number | null }

// startIso inclusive, endIso exclusive (Monday→next Monday) — same contract as fetchMetaWeek.
// Google's BETWEEN is inclusive on both ends, so `until` = endIso minus one day (like Meta's `until`).
export async function fetchGoogleAdsWeek(startIso: string, endIso: string): Promise<GoogleWeek | null> {
  if (!googleAdsConfigured()) return null;
  const token = await getGoogleToken('ads'); // provider 'google_ads' — connected via Settings
  if (!token) return null;

  const envId = digits(process.env.GOOGLE_ADS_CUSTOMER_ID);
  if (!envId) return null;
  const envLogin = digits(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  // Cache holds {id, viaManager} — viaManager decides whether login-customer-id is sent
  // (required when access goes through the MCC, a 403 when the account is direct-access).
  let cached: { id: string; viaManager: boolean } | null = null;
  try {
    const s = await getConfig(EFFECTIVE_ID_KEY);
    if (s) cached = s.startsWith('{') ? JSON.parse(s) : { id: digits(s), viaManager: true };
  } catch { /* re-resolve below */ }

  const until = new Date(new Date(endIso + 'T00:00:00').getTime() - 86400_000).toISOString().slice(0, 10);
  // FROM customer = one account-level aggregated row for the whole date range (no per-campaign
  // summing needed), same spirit as Meta's level=account insights call.
  const query = `SELECT metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${startIso}' AND '${until}'`;

  let customerId = cached?.id || envId;
  let j: any;
  try {
    j = await adsSearch(customerId, query, token, envLogin || (cached?.viaManager ? envId : undefined));
  } catch (e) {
    if (!String(e).includes('REQUESTED_METRICS_FOR_MANAGER')) throw e;
    const resolved = await resolveClientAccount(envId, token);
    customerId = resolved.id;
    await setConfig(EFFECTIVE_ID_KEY, JSON.stringify(resolved)).catch(() => { /* cache miss just means re-resolving next run */ });
    j = await adsSearch(customerId, query, token, resolved.viaManager ? envId : undefined);
  }

  const row = (j.results || [])[0];
  if (!row) return { spend: 0, roas: null, purchases: 0, cpa: null };
  const spend = round2((Number(row.metrics?.costMicros) || 0) / 1_000_000);
  const purchases = Math.round(Number(row.metrics?.conversions) || 0);
  const revenue = Number(row.metrics?.conversionsValue) || 0;
  return {
    spend, purchases,
    roas: spend ? round2(revenue / spend) : null,
    cpa: purchases ? round2(spend / purchases) : null,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
