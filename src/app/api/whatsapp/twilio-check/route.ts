import { NextRequest, NextResponse } from 'next/server';

// Verifies the Twilio creds actually in Vercel env (server-side) without sending a message.
// GET /api/whatsapp/twilio-check?secret=CRON_SECRET
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const tok = process.env.TWILIO_AUTH_TOKEN || '';
  let auth_status: number | string = 'not-attempted';
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${tok}`).toString('base64')}` },
    });
    auth_status = res.status;
  } catch (e) {
    auth_status = `fetch-error: ${String(e).slice(0, 80)}`;
  }
  return NextResponse.json({
    account_sid: sid ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : '(missing)',
    account_sid_ok: sid.startsWith('AC'),
    token_present: !!tok,
    token_len: tok.length, // a real Twilio Auth Token is 32 hex chars
    token_preview: tok ? `${tok.slice(0, 4)}…${tok.slice(-2)}` : '(missing)',
    from_number: process.env.TWILIO_WHATSAPP_FROM || '(missing)',
    auth_status, // 200 = creds valid, 401 = wrong token/SID
  });
}
