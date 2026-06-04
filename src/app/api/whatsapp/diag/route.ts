import { NextRequest, NextResponse } from 'next/server';
import { askStockAgent } from '@/lib/stockAgent';

export const maxDuration = 120;

// TEMPORARY diagnostic: GET /api/whatsapp/diag?q=...&phone=...&secret=...
// Returns the agent's text without going through Twilio. Guarded by CRON_SECRET.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const q = searchParams.get('q') || 'hello';
  const phone = searchParams.get('phone') || undefined;
  const answer = await askStockAgent(q, phone);
  return NextResponse.json(answer);
}
