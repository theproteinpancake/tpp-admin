import { NextRequest, NextResponse } from 'next/server';
import { TWILIO_API_BASE, twilioAuthHeader } from '@/lib/whatsapp';

// READ-ONLY: recent Twilio message delivery statuses. GET ?secret=CRON_SECRET
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const auth = twilioAuthHeader();
  const r = await fetch(`${TWILIO_API_BASE}/2010-04-01/Accounts/${sid}/Messages.json?PageSize=12`, { headers: { Authorization: auth || '' } });
  const j = await r.json();
  const messages = (j.messages || []).map((m: any) => ({
    dir: m.direction, status: m.status, error_code: m.error_code,
    date: m.date_sent || m.date_created, body: (m.body || '').slice(0, 35),
  }));
  return NextResponse.json({
    from_number: process.env.TWILIO_WHATSAPP_FROM || '(missing)',
    using_messaging_service: !!process.env.TWILIO_MESSAGING_SERVICE_SID,
    count: messages.length, messages,
  });
}
