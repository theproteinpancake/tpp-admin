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

export async function syncOrders(sinceIso: string): Promise<{ synced: number; error?: string }> {
  const token = await getShopifyToken();
  const url = `https://${SHOPIFY_SHOP}/admin/api/${API}/graphql.json`;
  const q = `created_at:>=${sinceIso} financial_status:paid`;
  let cursor: string | null = null;
  let total = 0;
  for (let page = 0; page < 200; page++) {
    const res = await fetch(url, {
      method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { cursor, q } }),
    });
    const j = await res.json();
    if (j.errors) return { synced: total, error: JSON.stringify(j.errors).slice(0, 200) };
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
  await supabaseLogistics.rpc('recompute_new_customers').catch(() => {});
  return { synced: total };
}
