// Weekly session counts from Shopify's ShopifyQL analytics (sessions dataset) — the missing
// half of conversion rate. CR/NZ CR/UK CR used to be typed in by hand every week; this feeds
// them automatically: CR = orders ÷ sessions, per region.
//
// Two constraints discovered while building (Jul 2026):
// - `shopifyqlQuery` only exists on the `unstable` Admin API version — it was removed from the
//   stable versions. If Shopify pulls it entirely, this fails loudly in the autofill status and
//   CR simply stays blank (manual entry still works as the fallback).
// - Requires the `read_reports` scope on the Dev Dashboard app (client-credentials token carries
//   the app version's scopes automatically once the scope is added + released).
import { getShopifyToken, SHOPIFY_SHOP } from './shopifyToken';

export interface WeekSessions { total: number; nz: number; uk: number; au: number }

// startIso inclusive, endIso exclusive (Monday → next Monday), same contract as the other
// weekly fetchers. ShopifyQL's SINCE/UNTIL are both inclusive → UNTIL = endIso minus one day.
export async function fetchSessionsWeek(startIso: string, endIso: string): Promise<WeekSessions | null> {
  const token = await getShopifyToken();
  const until = new Date(new Date(endIso + 'T00:00:00Z').getTime() - 86400_000).toISOString().slice(0, 10);
  const ql = `FROM sessions SHOW sessions GROUP BY session_country SINCE ${startIso} UNTIL ${until} ORDER BY sessions DESC LIMIT 250`;
  const res = await fetch(`https://${SHOPIFY_SHOP}/admin/api/unstable/graphql.json`, {
    method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) { tableData { columns { name } rows } parseErrors } }` }),
  });
  const j = await res.json();
  if (j.errors?.length) throw new Error(`Shopify sessions: ${String(j.errors[0].message).slice(0, 160)}`);
  const q = j.data?.shopifyqlQuery;
  const td = q?.tableData;
  if (!td) throw new Error(`Shopify sessions: ${JSON.stringify(q?.parseErrors ?? 'no tableData').slice(0, 160)}`);

  const cols: string[] = (td.columns || []).map((c: any) => c.name);
  const ci = cols.findIndex((n) => /country/i.test(n));
  const si = cols.findIndex((n) => /session/i.test(n) && !/country/i.test(n));
  let total = 0, nz = 0, uk = 0, au = 0;
  for (const raw of (td.rows || []) as any[]) {
    // rows is a JSON scalar — tolerate array-of-arrays or array-of-objects
    const country = String(Array.isArray(raw) ? raw[ci] : raw[cols[ci]] ?? '').trim();
    const n = Number(Array.isArray(raw) ? raw[si] : raw[cols[si]]) || 0;
    total += n;
    if (/^new zealand$|^nz$/i.test(country)) nz += n;
    else if (/^united kingdom$|^uk$|^gb$|^great britain$/i.test(country)) uk += n;
    else if (/^australia$|^au$/i.test(country)) au += n;
  }
  return { total, nz, uk, au };
}
