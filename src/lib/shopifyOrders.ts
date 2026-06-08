// Sync Shopify orders (with customer-journey attribution + new/returning) into shopify_order.
// Powers the attribution engine: ROAS / NC ROAS / CPA / NC CPA per channel for any range.
import { supabaseLogistics } from './supabase-logistics';
import { getShopifyToken, SHOPIFY_SHOP } from './shopifyToken';

const API = '2024-10';

// Classify a customer-journey visit to a marketing channel (click-based attribution).
function classify(v: any): string {
  if (!v) return 'direct';
  const s = (v.utmParameters?.source || v.source || '').toLowerCase();
  const m = (v.utmParameters?.medium || '').toLowerCase();
  const ref = (v.referrerUrl || '').toLowerCase();
  const paid = /cpc|ppc|paid/.test(m);
  const isEmail = /klaviyo|email|newsletter|shopify_email/.test(s) || m === 'email';
  const isMeta = /facebook|instagram|\bfb\b|\big\b|meta|fbclid|audience_network|\ban\b/.test(s) || /facebook|instagram|fb\.com|l\.facebook/.test(ref);
  const isGoogle = /google|adwords|gclid|youtube/.test(s) || /google\.|youtube\./.test(ref);
  if (isEmail) return 'email';
  if (isMeta) return /organic|social$|unpaid|referral/.test(m) ? 'organic' : 'meta';
  if (isGoogle) return paid ? 'google' : 'organic';
  if (ref) return 'organic';
  return 'direct';
}

const QUERY = `query($cursor: String, $q: String) {
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id createdAt
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { id numberOfOrders }
      shippingAddress { countryCodeV2 }
      customerJourneySummary {
        firstVisit { source referrerUrl utmParameters { source medium } }
        lastVisit { source referrerUrl utmParameters { source medium } }
      }
    }
  }
}`;

export async function syncOrders(sinceIso: string, untilIso?: string): Promise<{ synced: number; error?: string }> {
  const token = await getShopifyToken();
  const url = `https://${SHOPIFY_SHOP}/admin/api/${API}/graphql.json`;
  const q = `created_at:>=${sinceIso}${untilIso ? ` created_at:<=${untilIso}` : ''} financial_status:paid`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let cursor: string | null = null;
  let total = 0;
  for (let page = 0; page < 400; page++) {
    // request with throttle-aware retry
    let j: any = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const res: Response = await fetch(url, {
        method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { cursor, q } }),
      });
      j = await res.json();
      const throttled = Array.isArray(j.errors) && j.errors.some((e: any) => e.extensions?.code === 'THROTTLED');
      if (!throttled) break;
      await sleep(2500 * (attempt + 1)); // back off and retry same cursor
    }
    if (j.errors) return { synced: total, error: JSON.stringify(j.errors).slice(0, 200) };
    // pace against the leaky bucket so we don't get throttled
    const ts = j.extensions?.cost?.throttleStatus;
    if (ts && ts.currentlyAvailable < 400) await sleep(Math.min(3000, ((400 - ts.currentlyAvailable) / (ts.restoreRate || 100)) * 1000));
    const conn = j.data?.orders;
    const nodes = conn?.nodes || [];
    if (nodes.length) {
      const rows = nodes.map((o: any) => ({
        id: o.id,
        created_at: o.createdAt,
        total: Number(o.totalPriceSet?.shopMoney?.amount) || 0,
        currency: o.totalPriceSet?.shopMoney?.currencyCode || 'AUD',
        customer_id: o.customer?.id || null,
        num_orders: o.customer?.numberOfOrders != null ? Number(o.customer.numberOfOrders) : null,
        is_new_customer: o.customer?.numberOfOrders === 1 || o.customer?.numberOfOrders === '1',
        country: o.shippingAddress?.countryCodeV2 || null,
        first_source: classify(o.customerJourneySummary?.firstVisit),
        last_source: classify(o.customerJourneySummary?.lastVisit),
        updated_at: new Date().toISOString(),
      }));
      await supabaseLogistics.from('shopify_order').upsert(rows, { onConflict: 'id' });
      total += rows.length;
    }
    if (!conn?.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  // accurate new/returning: earliest order per customer = acquisition
  try { await supabaseLogistics.rpc('recompute_new_customers'); } catch { /* best-effort */ }
  return { synced: total };
}
