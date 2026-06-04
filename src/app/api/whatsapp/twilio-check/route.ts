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
  const headers = { Authorization: `Basic ${Buffer.from(`${sid}:${tok}`).toString('base64')}` };
  const probe = async (host: string) => {
    try { return (await fetch(`https://${host}/2010-04-01/Accounts/${sid}.json`, { headers })).status; }
    catch (e) { return `fetch-error: ${String(e).slice(0, 60)}`; }
  };
  const [us1, au1] = await Promise.all([probe('api.twilio.com'), probe('api.au1.twilio.com')]);
  return NextResponse.json({
    account_sid: sid ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : '(missing)',
    account_sid_ok: sid.startsWith('AC'),
    token_present: !!tok,
    token_len: tok.length, // a real Twilio Auth Token is 32 hex chars
    token_preview: tok ? `${tok.slice(0, 4)}…${tok.slice(-2)}` : '(missing)',
    from_number: process.env.TWILIO_WHATSAPP_FROM || '(missing)',
    auth_status_us1: us1,
    auth_status_au1: au1, // this is the one that matters — 200 = good
  });
}
