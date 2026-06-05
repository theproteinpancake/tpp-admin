import { NextRequest, NextResponse } from 'next/server';

// Verifies the Twilio creds actually in Vercel env (server-side) without sending a message.
// GET /api/whatsapp/twilio-check?secret=CRON_SECRET
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // optional ?sid= override lets us test the env token against a known-good SID
  const sid = searchParams.get('sid') || process.env.TWILIO_ACCOUNT_SID || '';
  const sid_source = searchParams.get('sid') ? 'override' : 'env';
  const tok = process.env.TWILIO_AUTH_TOKEN || '';
  const headers = { Authorization: `Basic ${Buffer.from(`${sid}:${tok}`).toString('base64')}` };
  const probe = async (host: string) => {
    try {
      const r = await fetch(`https://${host}/2010-04-01/Accounts/${sid}.json`, { headers });
      return { status: r.status, body: (await r.text()).slice(0, 300) };
    } catch (e) { return { status: 'fetch-error', body: String(e).slice(0, 120) }; }
  };
  const [us1, au1] = await Promise.all([probe('api.twilio.com'), probe('api.au1.twilio.com')]);
  return NextResponse.json({
    account_sid: sid ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : '(missing)',
    sid_source,
    account_sid_len: sid.length, // a real Account SID is 34 chars (AC + 32 hex)
    account_sid_ok: sid.startsWith('AC') && sid.length === 34,
    token_present: !!tok,
    token_len: tok.length,
    token_preview: tok ? `${tok.slice(0, 4)}…${tok.slice(-2)}` : '(missing)',
    from_number: process.env.TWILIO_WHATSAPP_FROM || '(missing)',
    us1, au1, // body shows Twilio's exact error (e.g. code 20003 = bad SID/token pair)
  });
}
