// Meta ad-level + campaign-level performance for the Ads gallery (Atria-style creative view).
// Pulls insights with INCREMENTALITY (same basis as the analytics pages) plus each ad's
// creative thumbnail / video flag / shareable preview link.
const GRAPH = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_ACCESS_TOKEN || '';
const rawAcct = process.env.META_AD_ACCOUNT_ID || '';
const ACCT = rawAcct ? (rawAcct.startsWith('act_') ? rawAcct : `act_${rawAcct}`) : '';

const PURCHASE_TYPES = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
const pick = (arr: any[] | undefined, field: string) => {
  if (!Array.isArray(arr)) return 0;
  for (const t of PURCHASE_TYPES) { const hit = arr.find((a) => a.action_type === t); if (hit && hit[field] != null) return Number(hit[field]) || 0; }
  return 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CampaignPerf {
  id: string; name: string; spend: number; revenue: number; roas: number | null;
  purchases: number; cpa: number | null; nc_roas: number | null; nc_cpa: number | null;
}
export interface AdPerf {
  ad_id: string; ad_name: string; campaign_name: string; adset_name: string;
  spend: number; revenue: number; roas: number | null; purchases: number; cpa: number | null;
  nc_roas: number | null; nc_cpa: number | null;
  impressions: number; ctr: number | null; cpm: number | null;
  thumbnail: string | null; is_video: boolean; preview_url: string | null;
}

function rangeParams(fromDate: string, toDate: string): string {
  // Meta `until` is inclusive → end-1 day. Account reports in its own (store) timezone.
  const until = new Date(Date.parse(toDate + 'T00:00:00Z') - 86400_000).toISOString().slice(0, 10);
  const timeRange = encodeURIComponent(JSON.stringify({ since: fromDate, until }));
  const windows = encodeURIComponent(JSON.stringify(['incrementality']));
  return `time_range=${timeRange}&action_attribution_windows=${windows}&access_token=${encodeURIComponent(TOKEN)}`;
}

function perfFrom(row: any) {
  const spend = Number(row.spend) || 0;
  const purchases = pick(row.actions, 'value');
  const revenue = pick(row.action_values, 'value');
  const incConv = pick(row.actions, 'incrementality');
  const incValue = pick(row.action_values, 'incrementality');
  return {
    spend: r2(spend), revenue: r2(revenue),
    roas: spend && revenue ? r2(revenue / spend) : null,
    purchases, cpa: purchases ? r2(spend / purchases) : null,
    nc_roas: spend && incValue ? r2(incValue / spend) : null,
    nc_cpa: incConv ? r2(spend / incConv) : null,
  };
}

export async function fetchCampaignPerformance(fromDate: string, toDate: string): Promise<CampaignPerf[]> {
  if (!TOKEN || !ACCT) return [];
  const url = `${GRAPH}/${ACCT}/insights?level=campaign&fields=campaign_id,campaign_name,spend,actions,action_values&limit=50&${rangeParams(fromDate, toDate)}`;
  const res = await fetch(url);
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`Meta campaigns ${res.status}: ${(j.error?.message || '').slice(0, 160)}`);
  return ((j.data || []) as any[])
    .map((row) => ({ id: row.campaign_id, name: row.campaign_name, ...perfFrom(row) }))
    .filter((c) => c.spend > 0)
    .sort((a, b) => b.spend - a.spend);
}

// Ad-level INSIGHTS only (one fast call) — creatives are hydrated separately for just the
// page of ads being displayed (hydrateCreatives), so 100 ads don't slow the page down.
export async function fetchAdInsights(fromDate: string, toDate: string): Promise<AdPerf[]> {
  if (!TOKEN || !ACCT) return [];
  const url = `${GRAPH}/${ACCT}/insights?level=ad&fields=ad_id,ad_name,campaign_name,adset_name,spend,impressions,ctr,cpm,actions,action_values&limit=100&sort=${encodeURIComponent('spend_descending')}&${rangeParams(fromDate, toDate)}`;
  const res = await fetch(url);
  const j = await res.json();
  if (!res.ok || j.error) throw new Error(`Meta ads ${res.status}: ${(j.error?.message || '').slice(0, 160)}`);
  const rows = ((j.data || []) as any[]).filter((row) => (Number(row.spend) || 0) > 0);
  return rows.map((row) => ({
    ad_id: row.ad_id, ad_name: row.ad_name || '(unnamed)',
    campaign_name: row.campaign_name || '', adset_name: row.adset_name || '',
    ...perfFrom(row),
    impressions: Number(row.impressions) || 0,
    ctr: row.ctr != null ? r2(Number(row.ctr)) : null,
    cpm: row.cpm != null ? r2(Number(row.cpm)) : null,
    thumbnail: null, is_video: false, preview_url: null,
  }));
}

// Hydrate creatives (big thumbnail + video flag + shareable preview) for a SLICE of ads — call
// with just the visible page. Mutates + returns the slice. Batches of 50 ids.
export async function hydrateCreatives(ads: AdPerf[]): Promise<AdPerf[]> {
  if (!TOKEN || !ads.length) return ads;
  for (let i = 0; i < ads.length; i += 50) {
    const batch = ads.slice(i, i + 50);
    const ids = batch.map((a) => a.ad_id).join(',');
    const cUrl = `${GRAPH}/?ids=${ids}&fields=creative.thumbnail_width(512).thumbnail_height(512){thumbnail_url,video_id,object_type},preview_shareable_link&access_token=${encodeURIComponent(TOKEN)}`;
    try {
      const cRes = await fetch(cUrl);
      const cJ = await cRes.json();
      if (cRes.ok && !cJ.error) {
        for (const a of batch) {
          const c = cJ[a.ad_id];
          if (!c) continue;
          a.thumbnail = c.creative?.thumbnail_url || null;
          a.is_video = !!c.creative?.video_id || c.creative?.object_type === 'VIDEO';
          a.preview_url = c.preview_shareable_link || null;
        }
      }
    } catch { /* thumbnails are best-effort — metrics still render */ }
  }
  return ads;
}

// Back-compat for the probe: insights + all creatives.
export async function fetchAdPerformance(fromDate: string, toDate: string): Promise<AdPerf[]> {
  return hydrateCreatives(await fetchAdInsights(fromDate, toDate));
}
