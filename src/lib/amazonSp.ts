// Amazon Selling Partner API (SP-API) — read-only order totals for the weekly analytics.
// Self-authorized PRIVATE app (Seller Central → Apps & Services → Develop Apps) — the refresh
// token is generated once in that UI directly, no OAuth-redirect flow needed (unlike Ads API
// or Google). AU and UK sit in DIFFERENT SP-API regions (AU = Far East, UK = Europe); both
// marketplaces are queried and summed into one weekly total, matching the single "Amazon"
// column in Sales & Data. UK order totals (GBP) are converted to AUD before summing.
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

interface Market { region: string; endpoint: string; marketplaceId: string; label: string; currency: 'AUD' | 'GBP' }
const MARKETS: Market[] = [
  { region: 'fe', endpoint: 'https://sellingpartnerapi-fe.amazon.com', marketplaceId: 'A39IBJ37TRP1C6', label: 'AU', currency: 'AUD' },
  { region: 'eu', endpoint: 'https://sellingpartnerapi-eu.amazon.com', marketplaceId: 'A1F83G8C2ARO7P', label: 'UK', currency: 'GBP' },
];

export function amazonSpConfigured() {
  return !!process.env.AMAZON_SP_CLIENT_ID && !!process.env.AMAZON_SP_CLIENT_SECRET && !!process.env.AMAZON_SP_REFRESH_TOKEN;
}

let cachedToken: { token: string; expires: number } | null = null;
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.token;
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.AMAZON_SP_REFRESH_TOKEN || '',
      client_id: process.env.AMAZON_SP_CLIENT_ID || '',
      client_secret: process.env.AMAZON_SP_CLIENT_SECRET || '',
    }),
  });
  if (!res.ok) throw new Error(`Amazon SP-API token failed: ${res.status} ${await res.text()}`);
  const tok = await res.json();
  cachedToken = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
  return cachedToken.token;
}

// One market's order total + count for the week (Canceled orders excluded), paginated via NextToken.
async function marketWeek(m: Market, token: string, createdAfter: string, createdBefore: string): Promise<{ sales: number; orders: number }> {
  let sales = 0, orders = 0, nextToken: string | undefined, pages = 0;
  do {
    const params = new URLSearchParams({ MarketplaceIds: m.marketplaceId, CreatedAfter: createdAfter, CreatedBefore: createdBefore });
    if (nextToken) params.set('NextToken', nextToken);
    const res = await fetch(`${m.endpoint}/orders/v0/orders?${params}`, { headers: { 'x-amz-access-token': token } });
    if (!res.ok) throw new Error(`${m.label} ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const j = await res.json();
    for (const o of (j.payload?.Orders || [])) {
      if (o.OrderStatus === 'Canceled') continue;
      sales += Number(o.OrderTotal?.Amount) || 0;
      orders += 1;
    }
    nextToken = j.payload?.NextToken;
    pages++;
  } while (nextToken && pages < 20); // safety cap — weekly volume shouldn't need more
  return { sales, orders };
}

// AU + UK reported separately (Luke compares the two markets), plus a combined order count.
export interface AmazonWeek { au: number; uk: number; orders: number; warnings: string[] }

// startIso inclusive, endIso exclusive — same contract as fetchMetaWeek/fetchGoogleAdsWeek.
export async function fetchAmazonSalesWeek(startIso: string, endIso: string, fxGbpAud: number): Promise<AmazonWeek | null> {
  if (!amazonSpConfigured()) return null;
  const token = await getAccessToken();
  const createdAfter = `${startIso}T00:00:00Z`;
  const createdBefore = `${endIso}T00:00:00Z`;

  let au = 0, uk = 0, orders = 0;
  const warnings: string[] = [];
  for (const m of MARKETS) {
    try {
      const r = await marketWeek(m, token, createdAfter, createdBefore);
      const converted = m.currency === 'GBP' ? r.sales * fxGbpAud : r.sales;
      if (m.label === 'UK') uk += converted; else au += converted;
      orders += r.orders;
    } catch (e) {
      // one market failing (e.g. account not authorised there yet) shouldn't blank the other
      warnings.push(`${m.label}: ${String((e as Error).message || e).slice(0, 120)}`);
    }
  }
  if (warnings.length === MARKETS.length) throw new Error(warnings.join(' | '));
  return { au: round2(au), uk: round2(uk), orders, warnings };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
