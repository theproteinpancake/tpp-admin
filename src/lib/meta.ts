// Meta (Facebook) Marketing API — read-only account insights for the weekly analytics.
// Pulls spend, purchase ROAS, purchases + Meta's INCREMENTALITY (truly-caused conversions/value)
// for an [start,end) week. Incrementality powers the most accurate NC CPA / NC ROAS:
//   NC CPA  = spend / incremental_conversions
//   NC ROAS = incremental_conversion_value / spend
// Requires Meta's Incrementality Attribution to be enabled on the ad account — otherwise the
// `incrementality` key comes back 0 (we then fall back to click-based attribution upstream).
const GRAPH = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_ACCESS_TOKEN || '';
const rawAcct = process.env.META_AD_ACCOUNT_ID || '';
const ACCT = rawAcct ? (rawAcct.startsWith('act_') ? rawAcct : `act_${rawAcct}`) : '';

export function metaConfigured() { return !!TOKEN && !!ACCT; }

const PURCHASE_TYPES = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
// Pull a field ('value' or 'incrementality') off the first matching purchase action type.
const pick = (arr: any[] | undefined, field: string) => {
  if (!Array.isArray(arr)) return 0;
  for (const t of PURCHASE_TYPES) { const hit = arr.find((a) => a.action_type === t); if (hit && hit[field] != null) return Number(hit[field]) || 0; }
  return 0;
};

export interface MetaWeek {
  spend: number; roas: number | null; purchases: number; cpa: number | null;
  inc_conversions: number; inc_value: number; nc_roas: number | null; nc_cpa: number | null;
}

// startIso inclusive, endIso exclusive (Monday→next Monday). Meta `until` is inclusive → end-1 day.
export async function fetchMetaWeek(startIso: string, endIso: string): Promise<MetaWeek | null> {
  if (!metaConfigured()) return null;
  const until = new Date(new Date(endIso + 'T00:00:00').getTime() - 86400_000).toISOString().slice(0, 10);
  const timeRange = encodeURIComponent(JSON.stringify({ since: startIso, until }));
  // Adding "incrementality" to the windows makes Meta return an extra `incrementality` key
  // alongside `value` on every actions / action_values entry — no separate call needed.
  const windows = encodeURIComponent(JSON.stringify(['incrementality']));
  const url = `${GRAPH}/${ACCT}/insights?level=account&fields=spend,purchase_roas,actions,action_values&action_attribution_windows=${windows}&time_range=${timeRange}&access_token=${encodeURIComponent(TOKEN)}`;
  const res = await fetch(url);
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`Meta ${res.status}: ${(j.error?.message || JSON.stringify(j)).slice(0, 160)}`);
  const row = (j.data || [])[0];
  if (!row) return { spend: 0, roas: null, purchases: 0, cpa: null, inc_conversions: 0, inc_value: 0, nc_roas: null, nc_cpa: null };
  const spend = Number(row.spend) || 0;
  const purchases = pick(row.actions, 'value');
  const roas = pick(row.purchase_roas, 'value') || null;
  const incConv = pick(row.actions, 'incrementality');
  const incValue = pick(row.action_values, 'incrementality');
  return {
    spend: round2(spend), roas: roas ? round2(roas) : null, purchases, cpa: purchases ? round2(spend / purchases) : null,
    inc_conversions: incConv, inc_value: round2(incValue),
    nc_roas: spend && incValue ? round2(incValue / spend) : null,
    nc_cpa: incConv ? round2(spend / incConv) : null,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type Market = 'AUNZ' | 'UK' | 'OTHER';

/**
 * Which market a campaign belongs to, from its NAME — the only geo signal available without a
 * per-campaign targeting lookup. Campaigns are named consistently for this:
 *   "2026 - RA - UK - PROSPECTING - CBO"        → UK
 *   "2026 - RA - AU - PROSPECTING - CBO"        → AUNZ
 *   "2026 - RA - RETENTION - AU, NZ"            → AUNZ
 *   "2026 - SM - Followers / Traffic"           → OTHER (no market, no purchases)
 * Matched on word boundaries so a stray "au" inside another word can't claim a campaign, and a
 * name mentioning BOTH regions is left OTHER rather than guessed at — it would silently move
 * spend between markets, which is exactly the error this split exists to avoid.
 */
export function campaignMarket(name: string): Market {
  const n = ` ${String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
  const uk = / (UK|GB|BRITAIN|UNITED KINGDOM) /.test(n);
  const aunz = / (AU|AUS|NZ|AUSTRALIA|NEW ZEALAND) /.test(n);
  if (uk && !aunz) return 'UK';
  if (aunz && !uk) return 'AUNZ';
  return 'OTHER';
}

/** Per-market spend + purchases + value for a week, bucketed from campaign-level insights. */
export async function fetchMetaWeekByMarket(startIso: string, endIso: string):
  Promise<Record<Market, MetaWeek> & { campaigns: { name: string; market: Market; spend: number }[] } | null> {
  if (!metaConfigured()) return null;
  const until = new Date(new Date(endIso + 'T00:00:00').getTime() - 86400_000).toISOString().slice(0, 10);
  const timeRange = encodeURIComponent(JSON.stringify({ since: startIso, until }));
  const windows = encodeURIComponent(JSON.stringify(['incrementality']));
  const url = `${GRAPH}/${ACCT}/insights?level=campaign&fields=campaign_name,spend,actions,action_values&action_attribution_windows=${windows}&time_range=${timeRange}&limit=200&access_token=${encodeURIComponent(TOKEN)}`;
  const res = await fetch(url);
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`Meta campaigns ${res.status}: ${(j.error?.message || JSON.stringify(j)).slice(0, 160)}`);

  const blank = (): MetaWeek & { value: number } =>
    ({ spend: 0, roas: null, purchases: 0, cpa: null, inc_conversions: 0, inc_value: 0, nc_roas: null, nc_cpa: null, value: 0 });
  const acc: Record<Market, MetaWeek & { value: number }> = { AUNZ: blank(), UK: blank(), OTHER: blank() };
  const campaigns: { name: string; market: Market; spend: number }[] = [];

  for (const row of j.data || []) {
    const market = campaignMarket(row.campaign_name);
    const spend = Number(row.spend) || 0;
    const a = acc[market];
    a.spend += spend;
    a.purchases += pick(row.actions, 'value');
    a.value += pick(row.action_values, 'value');
    a.inc_conversions += pick(row.actions, 'incrementality');
    a.inc_value += pick(row.action_values, 'incrementality');
    campaigns.push({ name: row.campaign_name, market, spend: round2(spend) });
  }
  // Ratios are computed AFTER summing — averaging per-campaign ROAS would weight a $15 campaign
  // the same as a $4,800 one.
  for (const m of ['AUNZ', 'UK', 'OTHER'] as Market[]) {
    const a = acc[m];
    a.spend = round2(a.spend); a.value = round2(a.value); a.inc_value = round2(a.inc_value);
    a.roas = a.spend ? round2(a.value / a.spend) : null;
    a.cpa = a.purchases ? round2(a.spend / a.purchases) : null;
    a.nc_roas = a.spend && a.inc_value ? round2(a.inc_value / a.spend) : null;
    a.nc_cpa = a.inc_conversions ? round2(a.spend / a.inc_conversions) : null;
  }
  return { ...acc, campaigns };
}
