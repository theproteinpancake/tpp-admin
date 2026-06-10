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
