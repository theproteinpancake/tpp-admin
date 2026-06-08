// Meta (Facebook) Marketing API — read-only account insights for the weekly analytics.
// Pulls spend, purchase ROAS, purchases and derives CPA for an [start,end) week.
const GRAPH = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_ACCESS_TOKEN || '';
const rawAcct = process.env.META_AD_ACCOUNT_ID || '';
const ACCT = rawAcct ? (rawAcct.startsWith('act_') ? rawAcct : `act_${rawAcct}`) : '';

export function metaConfigured() { return !!TOKEN && !!ACCT; }

const PURCHASE_TYPES = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
const pickPurchase = (arr: any[] | undefined) => {
  if (!Array.isArray(arr)) return 0;
  for (const t of PURCHASE_TYPES) { const hit = arr.find((a) => a.action_type === t); if (hit) return Number(hit.value) || 0; }
  return 0;
};

export interface MetaWeek { spend: number; roas: number | null; purchases: number; cpa: number | null }

// startIso inclusive, endIso exclusive (Monday→next Monday). Meta `until` is inclusive → end-1 day.
export async function fetchMetaWeek(startIso: string, endIso: string): Promise<MetaWeek | null> {
  if (!metaConfigured()) return null;
  const until = new Date(new Date(endIso + 'T00:00:00').getTime() - 86400_000).toISOString().slice(0, 10);
  const timeRange = encodeURIComponent(JSON.stringify({ since: startIso, until }));
  const url = `${GRAPH}/${ACCT}/insights?level=account&fields=spend,purchase_roas,actions&time_range=${timeRange}&access_token=${encodeURIComponent(TOKEN)}`;
  const res = await fetch(url);
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`Meta ${res.status}: ${(j.error?.message || JSON.stringify(j)).slice(0, 160)}`);
  const row = (j.data || [])[0];
  if (!row) return { spend: 0, roas: null, purchases: 0, cpa: null };
  const spend = Number(row.spend) || 0;
  const purchases = pickPurchase(row.actions);
  const roas = pickPurchase(row.purchase_roas) || null;
  return { spend: round2(spend), roas: roas ? round2(roas) : null, purchases, cpa: purchases ? round2(spend / purchases) : null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
