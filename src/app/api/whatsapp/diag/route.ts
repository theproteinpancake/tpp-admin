import { NextRequest, NextResponse } from 'next/server';
import { askStockAgent } from '@/lib/stockAgent';
import { TWILIO_API_BASE, twilioAuthHeader } from '@/lib/whatsapp';

export const maxDuration = 120;

// TEMP diagnostic: GET /api/whatsapp/diag?q=...&phone=...&secret=...  (or ?messages=1 for delivery status)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ?messages=1 → recent Twilio messages with delivery status + error codes
  if (searchParams.get('messages') === '1') {
    const sid = process.env.TWILIO_ACCOUNT_SID || '';
    const auth = twilioAuthHeader();
    const r = await fetch(`${TWILIO_API_BASE}/2010-04-01/Accounts/${sid}/Messages.json?PageSize=15`, { headers: { Authorization: auth || '' } });
    const j = await r.json();
    const msgs = (j.messages || []).map((m: any) => ({
      to: m.to, from: m.from, status: m.status, error_code: m.error_code, error_message: m.error_message,
      direction: m.direction, date_sent: m.date_sent || m.date_created, body: (m.body || '').slice(0, 40),
    }));
    return NextResponse.json({ count: msgs.length, messages: msgs });
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
