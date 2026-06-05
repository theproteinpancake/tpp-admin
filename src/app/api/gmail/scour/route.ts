import { NextRequest, NextResponse } from 'next/server';
import { runScour } from '@/lib/gmailScour';
import { reconcilePOsFromWROs } from '@/lib/poReconcile';
import { refreshInfluencerTracking } from '@/lib/marketing';

export const maxDuration = 120;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const res = await runScour();
  // daily check: close out any PO whose WRO has landed at ShipBob so it stops
  // being counted as inbound (and mark it Billed in Xero).
  let reconcile: Awaited<ReturnType<typeof reconcilePOsFromWROs>> | { error: string };
  try { reconcile = await reconcilePOsFromWROs(); }
  catch (e) { reconcile = { error: String(e) }; }
  // refresh influencer gift tracking (ShipBob) so the dashboard shows live status/tracking
  let tracking: Awaited<ReturnType<typeof refreshInfluencerTracking>> | { error: string };
  try { tracking = await refreshInfluencerTracking(); }
  catch (e) { tracking = { error: String(e) }; }
  return NextResponse.json({ ok: true, ...res, po_reconcile: reconcile, influencer_tracking: tracking });
}

export const POST = handle;
export const GET = handle;
