import { NextRequest, NextResponse } from 'next/server';
import { getCashView } from '@/lib/cashflow';

export const maxDuration = 60;

// Probe for the Money view (cron-guarded) — verifies Xero AR/AP/bank pulls without a session.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const c = await getCashView();
    return NextResponse.json({
      ok: true,
      bank: c.bank_balance, bank_accounts: c.bank_accounts.length,
      ar_total: c.ar_total, ar_items: c.ar_items.length, ar_overdue: c.ar_overdue,
      ap_total: c.ap_total, ap_items: c.ap_items.length,
      committed_pos: c.committed_pos, detected_bills: c.detected_bills,
      net_30d: c.net_30d, notes: c.notes,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as any)?.message || e) });
  }
}

export const GET = handle;
export const POST = handle;
