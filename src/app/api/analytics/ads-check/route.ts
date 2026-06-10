import { NextRequest, NextResponse } from 'next/server';
import { fetchCampaignPerformance, fetchAdPerformance } from '@/lib/metaAds';
import { melbDate, addDays } from '@/lib/tz';

export const maxDuration = 60;

// Probe for the Ads tab data: campaign + ad counts, thumbnail coverage, top ad sample. Cron-guarded.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const from = url.searchParams.get('from') || addDays(melbDate(0), -13);
  const to = url.searchParams.get('to') || addDays(melbDate(0), 1);
  try {
    const [campaigns, ads] = await Promise.all([fetchCampaignPerformance(from, to), fetchAdPerformance(from, to)]);
    return NextResponse.json({
      ok: true, range: { from, to },
      campaigns: campaigns.length, ads: ads.length,
      with_thumbnail: ads.filter((a) => a.thumbnail).length,
      videos: ads.filter((a) => a.is_video).length,
      with_preview_link: ads.filter((a) => a.preview_url).length,
      top_campaign: campaigns[0] ? { name: campaigns[0].name, spend: campaigns[0].spend, roas: campaigns[0].roas, nc_cpa: campaigns[0].nc_cpa } : null,
      top_ad: ads[0] ? { name: ads[0].ad_name, spend: ads[0].spend, roas: ads[0].roas, nc_cpa: ads[0].nc_cpa, video: ads[0].is_video, has_thumb: !!ads[0].thumbnail } : null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as any)?.message || e) });
  }
}

export const GET = handle;
export const POST = handle;
