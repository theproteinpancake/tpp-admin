import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';
import { markPOReceived } from '@/lib/poReconcile';

export const maxDuration = 120;

// One-time backfill: close out every open PO except the genuinely-not-yet-landed
// recent batch. Marks each received locally AND Billed in Xero. Guarded by
// CRON_SECRET. Safe to re-run (already-received POs are simply skipped).
const KEEP = ['PO-0036', 'PO-0037', 'PO-0038', 'PO-0039'];
const OPEN = ['placed', 'in_production', 'partially_received'];

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // allow overriding the keep-list via ?keep=PO-0036,PO-0037
  const keepParam = new URL(req.url).searchParams.get('keep');
  const keep = keepParam ? keepParam.split(',').map((s) => s.trim().toUpperCase()) : KEEP;

  const { data: pos } = await supabaseLogistics
    .from('purchase_orders')
    .select('po_number, status')
    .in('status', OPEN);

  const targets = (pos ?? [])
    .map((p: any) => p.po_number)
    .filter((n: string) => n && !keep.includes(n))
    .sort();

  const results: { po_number: string; local: boolean; xero: boolean }[] = [];
  for (const po of targets) {
    try { results.push(await markPOReceived(po, { pushXero: true })); }
    catch (e) { results.push({ po_number: po, local: false, xero: false }); }
  }

  return NextResponse.json({
    ok: true,
    kept: keep,
    closed: results.length,
    xero_billed: results.filter((r) => r.xero).length,
    local_only: results.filter((r) => r.local && !r.xero).map((r) => r.po_number),
    failed: results.filter((r) => !r.local).map((r) => r.po_number),
    results,
  });
}

export const POST = handle;
export const GET = handle;
