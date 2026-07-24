import { NextRequest, NextResponse } from 'next/server';
import { getGoogleToken } from '@/lib/google';
import { getConfig } from '@/lib/settings';

export const maxDuration = 30;

// Account-level final URL suffix on the Google Ads client account. Google auto-tagging sends
// NO utm params, so paid clicks were indistinguishable from organic Google in our order
// attribution — google NC ROAS/CPA stayed blank. This suffix stamps every ad click with
// utm_source/medium so Shopify's customer journey carries the paid marker.
// GET = show current; POST {apply:true} = set. Cron-secret guarded; NEVER overwrites an
// existing different suffix unless {force:true} — that would be someone's deliberate config.
const SUFFIX = 'utm_source=google&utm_medium=cpc&utm_campaign={campaignid}';
const ADS_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v23';
const digits = (s?: string) => (s || '').replace(/[^0-9]/g, '');

async function ctx() {
  const token = await getGoogleToken('ads');
  if (!token) throw new Error('Google Ads not connected');
  const cachedRaw = await getConfig('google_ads_effective_customer_id');
  const cached = cachedRaw?.startsWith('{') ? JSON.parse(cachedRaw) : null;
  const envId = digits(process.env.GOOGLE_ADS_CUSTOMER_ID);
  const cid = cached?.id || envId;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    'Content-Type': 'application/json',
  };
  if (cached?.viaManager && envId && envId !== cid) headers['login-customer-id'] = envId;
  return { cid, headers };
}

async function readCurrent(cid: string, headers: Record<string, string>) {
  const res = await fetch(`https://googleads.googleapis.com/${ADS_VERSION}/customers/${cid}/googleAds:search`, {
    method: 'POST', headers,
    body: JSON.stringify({ query: 'SELECT customer.id, customer.descriptive_name, customer.final_url_suffix, customer.tracking_url_template FROM customer' }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j.error?.details ?? j.error?.message ?? j).slice(0, 400));
  return j.results?.[0]?.customer ?? {};
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const { cid, headers } = await ctx();
    const before = await readCurrent(cid, headers);
    let body: any = {};
    try { body = await req.json(); } catch { /* GET */ }
    if (!body.apply) return NextResponse.json({ ok: true, customer: cid, current: before, would_set: SUFFIX });

    if (before.finalUrlSuffix && before.finalUrlSuffix !== SUFFIX && !body.force) {
      return NextResponse.json({ ok: false, customer: cid, current: before, error: 'existing final_url_suffix differs — pass force:true to overwrite' }, { status: 409 });
    }
    const res = await fetch(`https://googleads.googleapis.com/${ADS_VERSION}/customers/${cid}:mutate`, {
      method: 'POST', headers,
      body: JSON.stringify({
        operation: { update: { resourceName: `customers/${cid}`, finalUrlSuffix: SUFFIX }, updateMask: 'final_url_suffix' },
      }),
    });
    const j = await res.json();
    if (!res.ok) return NextResponse.json({ ok: false, error: JSON.stringify(j.error?.details ?? j.error?.message ?? j).slice(0, 500) }, { status: 502 });
    const after = await readCurrent(cid, headers);
    return NextResponse.json({ ok: true, customer: cid, before, after });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 400) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
