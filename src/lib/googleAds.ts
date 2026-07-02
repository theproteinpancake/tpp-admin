// Google Ads API — read-only account-level reporting for the weekly analytics.
// Mirrors meta.ts's shape (spend/roas/purchases/cpa) so autofillWeek() can treat both channels
// identically. Google doesn't expose a native "incrementality" metric via Basic Access the way
// Meta does, so NC ROAS/NC CPA always come from our own click-based attribution_rollup (the same
// fallback Meta uses when its incrementality data isn't available) — wired in analytics.ts.
import { getGoogleToken } from './google';

// Google sunsets each major version ~1 year after release (v19 died 11 Feb 2026 — the original
// build shipped with it already dead, surfacing as an HTML 404 the JSON parse choked on).
// Override via env when the next sunset lands; the error below says exactly when that happens.
const ADS_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v23';

export function googleAdsConfigured() {
  return !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN && !!process.env.GOOGLE_ADS_CUSTOMER_ID;
}

export interface GoogleWeek { spend: number; roas: number | null; purchases: number; cpa: number | null }

// startIso inclusive, endIso exclusive (Monday→next Monday) — same contract as fetchMetaWeek.
// Google's BETWEEN is inclusive on both ends, so `until` = endIso minus one day (like Meta's `until`).
export async function fetchGoogleAdsWeek(startIso: string, endIso: string): Promise<GoogleWeek | null> {
  if (!googleAdsConfigured()) return null;
  const token = await getGoogleToken('ads'); // provider 'google_ads' — connected via Settings
  if (!token) return null;

  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/[^0-9]/g, '');
  if (!customerId) return null;
  const until = new Date(new Date(endIso + 'T00:00:00').getTime() - 86400_000).toISOString().slice(0, 10);

  // FROM customer = one account-level aggregated row for the whole date range (no per-campaign
  // summing needed), same spirit as Meta's level=account insights call.
  const query = `SELECT metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${startIso}' AND '${until}'`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    'Content-Type': 'application/json',
  };
  const loginId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/[^0-9]/g, '');
  if (loginId) headers['login-customer-id'] = loginId; // only needed under a manager (MCC) account

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
  const j = JSON.parse(raw);

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
