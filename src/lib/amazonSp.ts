// Amazon Selling Partner API (SP-API) — read-only order totals for the weekly analytics.
// Self-authorized PRIVATE app (Seller Central → Apps & Services → Develop Apps) — refresh tokens
// are generated once in that UI directly, no OAuth-redirect flow needed (unlike Ads API or
// Google). AU and UK sit in DIFFERENT SP-API regions (AU = Far East, UK = Europe) AND each
// marketplace authorization mints its OWN refresh token (confirmed in Seller Central's "Manage
// Authorisations" screen — one row per marketplace, each with its own "Authorise app" button) —
// so unlike the Client ID/Secret (shared), the refresh token is per-region, not shared.
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

interface Market { region: string; endpoint: string; marketplaceId: string; label: string; currency: 'AUD' | 'GBP'; refreshTokenEnv: string }
const MARKETS: Market[] = [
  { region: 'fe', endpoint: 'https://sellingpartnerapi-fe.amazon.com', marketplaceId: 'A39IBJ37TRP1C6', label: 'AU', currency: 'AUD', refreshTokenEnv: 'AMAZON_SP_REFRESH_TOKEN_AU' },
  { region: 'eu', endpoint: 'https://sellingpartnerapi-eu.amazon.com', marketplaceId: 'A1F83G8C2ARO7P', label: 'UK', currency: 'GBP', refreshTokenEnv: 'AMAZON_SP_REFRESH_TOKEN_UK' },
];

export function amazonSpConfigured() {
  return !!process.env.AMAZON_SP_CLIENT_ID && !!process.env.AMAZON_SP_CLIENT_SECRET
    && MARKETS.some((m) => !!process.env[m.refreshTokenEnv]); // at least one region authorised
}

const tokenCache = new Map<string, { token: string; expires: number }>();
async function getAccessToken(refreshTokenEnv: string): Promise<string> {
  const cached = tokenCache.get(refreshTokenEnv);
  if (cached && cached.expires > Date.now()) return cached.token;
  const refreshToken = process.env[refreshTokenEnv];
  if (!refreshToken) throw new Error(`${refreshTokenEnv} not set`);
  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.AMAZON_SP_CLIENT_ID || '',
      client_secret: process.env.AMAZON_SP_CLIENT_SECRET || '',
    }),
  });
  if (!res.ok) throw new Error(`Amazon SP-API token failed: ${res.status} ${await res.text()}`);
  const tok = await res.json();
  const entry = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
  tokenCache.set(refreshTokenEnv, entry);
  return entry.token;
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
  const createdAfter = `${startIso}T00:00:00Z`;
  // SP-API rejects a CreatedBefore in the future (400 InvalidInput) — for the current,
  // in-progress week the exclusive end is next Monday, so clamp to a couple of minutes ago
  // (Amazon also requires it to be at least ~2 min before now). Past weeks pass through as-is.
  const endMs = Math.min(new Date(`${endIso}T00:00:00Z`).getTime(), Date.now() - 3 * 60_000);
  if (endMs <= new Date(createdAfter).getTime()) return { au: 0, uk: 0, orders: 0, warnings: [] }; // week hasn't started yet
  const createdBefore = new Date(endMs).toISOString().replace(/\.\d{3}Z$/, 'Z');

  let au = 0, uk = 0, orders = 0;
  const warnings: string[] = [];
  for (const m of MARKETS) {
    try {
      const token = await getAccessToken(m.refreshTokenEnv);
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

// Daily sales for the last N days, bucketed by MELBOURNE calendar day (how Luke reads
// "yesterday"), AU in AUD + UK in GBP (native — the agent reports both as-is).
export interface AmazonDailyRow { date: string; au_sales: number; au_orders: number; uk_sales_gbp: number; uk_orders: number }
export async function fetchAmazonDaily(days = 7): Promise<{ rows: AmazonDailyRow[]; warnings: string[] } | null> {
  if (!amazonSpConfigured()) return null;
  const n = Math.min(Math.max(Math.round(days) || 7, 1), 30);
  const createdAfter = new Date(Date.now() - n * 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const createdBefore = new Date(Date.now() - 3 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const melbDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
  const byDay = new Map<string, AmazonDailyRow>();
  const warnings: string[] = [];
  for (const m of MARKETS) {
    try {
      const token = await getAccessToken(m.refreshTokenEnv);
      let nextToken: string | undefined, pages = 0;
      do {
        const params = new URLSearchParams({ MarketplaceIds: m.marketplaceId, CreatedAfter: createdAfter, CreatedBefore: createdBefore });
        if (nextToken) params.set('NextToken', nextToken);
        const res = await fetch(`${m.endpoint}/orders/v0/orders?${params}`, { headers: { 'x-amz-access-token': token } });
        if (!res.ok) throw new Error(`${m.label} ${res.status}: ${(await res.text()).slice(0, 120)}`);
        const j = await res.json();
        for (const o of (j.payload?.Orders || [])) {
          if (o.OrderStatus === 'Canceled' || !o.PurchaseDate) continue;
          const d = melbDay(o.PurchaseDate);
          if (!byDay.has(d)) byDay.set(d, { date: d, au_sales: 0, au_orders: 0, uk_sales_gbp: 0, uk_orders: 0 });
          const row = byDay.get(d)!;
          const amt = Number(o.OrderTotal?.Amount) || 0;
          if (m.label === 'UK') { row.uk_sales_gbp = round2(row.uk_sales_gbp + amt); row.uk_orders++; }
          else { row.au_sales = round2(row.au_sales + amt); row.au_orders++; }
        }
        nextToken = j.payload?.NextToken;
        pages++;
      } while (nextToken && pages < 20);
    } catch (e) {
      warnings.push(`${m.label}: ${String((e as Error).message || e).slice(0, 120)}`);
    }
  }
  if (warnings.length === MARKETS.length) throw new Error(warnings.join(' | '));
  // fill empty days so a $0 day is VISIBLE (that's often the whole point of asking)
  for (let i = 0; i < n; i++) {
    const d = melbDay(new Date(Date.now() - i * 86400_000).toISOString());
    if (!byDay.has(d)) byDay.set(d, { date: d, au_sales: 0, au_orders: 0, uk_sales_gbp: 0, uk_orders: 0 });
  }
  const rows = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-n);
  return { rows, warnings };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
