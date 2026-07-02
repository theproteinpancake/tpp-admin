// Google Ads API — read-only account-level reporting for the weekly analytics.
// Mirrors meta.ts's shape (spend/roas/purchases/cpa) so autofillWeek() can treat both channels
// identically. Google doesn't expose a native "incrementality" metric via Basic Access the way
// Meta does, so NC ROAS/NC CPA always come from our own click-based attribution_rollup (the same
// fallback Meta uses when its incrementality data isn't available) — wired in analytics.ts.
import { getGoogleToken } from './google';

// Bump if Google deprecates this API version.
const ADS_VERSION = 'v19';

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
  const j = await res.json();
  if (!res.ok) throw new Error(`Google Ads ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);

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
