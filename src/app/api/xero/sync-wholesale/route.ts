import { NextRequest, NextResponse } from 'next/server';
import { syncWholesale } from '@/lib/wholesaleSync';

export const maxDuration = 120;

// Sync wholesale sales (Xero ACCREC) → wholesale tables. Browser calls are gated by
// the auth-cookie middleware; cron passes the auth cookie + optional x-cron-secret.
async function handle(_req: NextRequest) {
  const res = await syncWholesale();
  const status = 'error' in res ? 500 : 200;
  return NextResponse.json(res, { status });
}

export const POST = handle;
export const GET = handle;
