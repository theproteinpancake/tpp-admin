import { NextRequest, NextResponse } from 'next/server';
import { TWILIO_API_BASE, twilioAuthHeader, allowedNumbers, waAddr } from '@/lib/whatsapp';

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
  const keySid = process.env.TWILIO_API_KEY_SID || '';
  const keySecret = process.env.TWILIO_API_KEY_SECRET || '';
  const usingApiKey = !!(keySid && keySecret);
  const tok = process.env.TWILIO_AUTH_TOKEN || '';
  const cred = usingApiKey ? `${keySid}:${keySecret}` : `${sid}:${tok}`;
  const headers = { Authorization: `Basic ${Buffer.from(cred).toString('base64')}` };
  const probe = async (host: string) => {
    try {
      const r = await fetch(`https://${host}/2010-04-01/Accounts/${sid}.json`, { headers });
      return { status: r.status, body: (await r.text()).slice(0, 300) };
    } catch (e) { return { status: 'fetch-error', body: String(e).slice(0, 120) }; }
  };
  const [us1, au1] = await Promise.all([probe('api.twilio.com'), probe('api.au1.twilio.com')]);

  // ?send=1 → actually send a WhatsApp to the first allowlisted number to test the From path
  let send: unknown = 'skipped (add &send=1 to test a real send)';
  if (searchParams.get('send') === '1') {
    const to = allowedNumbers()[0];
    const from = process.env.TWILIO_WHATSAPP_FROM || '';
    const auth = twilioAuthHeader();
    if (!to || !from || !auth) { send = { error: 'missing to/from/auth' }; }
    else {
      const params = new URLSearchParams({ To: to, From: waAddr(from), Body: '✅ Twilio test from the TPP dashboard — sending works.' });
      const r = await fetch(`${TWILIO_API_BASE}/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params,
      });
      send = { to, from, status: r.status, body: (await r.text()).slice(0, 400) };
    }
  }
  return NextResponse.json({
    account_sid: sid ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : '(missing)',
    sid_source,
    account_sid_len: sid.length, // a real Account SID is 34 chars (AC + 32 hex)
    account_sid_ok: sid.startsWith('AC') && sid.length === 34,
    auth_mode: usingApiKey ? 'api_key' : 'auth_token',
    api_key_sid: keySid ? `${keySid.slice(0, 4)}…${keySid.slice(-2)}` : '(none)',
    token_present: !!tok,
    token_len: tok.length,
    token_preview: tok ? `${tok.slice(0, 4)}…${tok.slice(-2)}` : '(missing)',
    from_number: process.env.TWILIO_WHATSAPP_FROM || '(missing)',
    us1, au1, // body shows Twilio's exact error (e.g. code 20003 = bad SID/token pair)
    send,
  });
}
