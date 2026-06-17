import { NextRequest, NextResponse } from 'next/server';
import { runScour } from '@/lib/gmailScour';
import { runVisyScour } from '@/lib/visyScour';
import { reconcilePOsFromWROs } from '@/lib/poReconcile';
import { refreshInfluencerTracking } from '@/lib/marketing';
import { recordJobRun } from '@/lib/settings';
import { syncDetectedBillStatuses } from '@/lib/xeroBills';

export const maxDuration = 120;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const res = await runScour();
  if (!res.error) await recordJobRun('gmail-scour');
  const billsSynced = await syncDetectedBillStatuses().catch(() => 0); // mark PAID once reconciled
  // daily check: close out any PO whose WRO has landed at ShipBob so it stops
  // being counted as inbound (and mark it Billed in Xero).
  let reconcile: Awaited<ReturnType<typeof reconcilePOsFromWROs>> | { error: string };
  try { reconcile = await reconcilePOsFromWROs(); }
  catch (e) { reconcile = { error: String(e) }; }
  // refresh influencer gift tracking (ShipBob) so the dashboard shows live status/tracking
  let tracking: Awaited<ReturnType<typeof refreshInfluencerTracking>> | { error: string };
  try { tracking = await refreshInfluencerTracking(); }
  catch (e) { tracking = { error: String(e) }; }
  // track VISY packaging orders from Amanda's emails (confirm → dispatch → deliver)
  let visy: Awaited<ReturnType<typeof runVisyScour>> | { error: string };
  try { visy = await runVisyScour(); }
  catch (e) { visy = { error: String(e) }; }
  return NextResponse.json({ ok: true, ...res, bills_synced: billsSynced, po_reconcile: reconcile, influencer_tracking: tracking, visy });
}

export const POST = handle;
export const GET = handle;
