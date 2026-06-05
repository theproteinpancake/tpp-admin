import { NextRequest, NextResponse } from 'next/server';
import { askStockAgent } from '@/lib/stockAgent';

export const maxDuration = 120;

// TEMP diagnostic: GET /api/whatsapp/diag?q=...&phone=...&secret=...
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const q = searchParams.get('q') || 'hello';
  const phone = searchParams.get('phone') || undefined;
  const started = Date.now();
  try {
    const answer = await askStockAgent(q, phone);
    return NextResponse.json({ ok: true, ms: Date.now() - started, ...answer });
  } catch (e) {
    return NextResponse.json({ ok: false, ms: Date.now() - started, error: String(e).slice(0, 500) }, { status: 500 });
  }
}
