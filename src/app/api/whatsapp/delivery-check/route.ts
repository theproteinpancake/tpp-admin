import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

// Read-only delivery diagnostics: recent outbound WhatsApp messages with Twilio's REAL
// delivery status + error codes. Twilio accepting a send (201) says nothing about delivery —
// a message can die inside WhatsApp afterwards (template paused by Meta, quality limits,
// closed session window) and our code never sees it. Built while chasing sales reviews that
// "sent" fine (heartbeat + context note recorded) but never reached Luke's phone.
// Cron-secret guarded, GET only. ?to=whatsapp:+61… filters recipient.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return NextResponse.json({ error: 'Twilio not configured' }, { status: 500 });

  const url = new URL(req.url);
  const q = new URLSearchParams({ PageSize: url.searchParams.get('limit') || '40' });
  const to = url.searchParams.get('to');
  if (to) q.set('To', to);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?${q}`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') },
  });
  if (!res.ok) return NextResponse.json({ error: `Twilio ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 500 });
  const j = await res.json();
  return NextResponse.json({
    ok: true,
    messages: (j.messages || []).map((m: any) => ({
      date: m.date_created,
      to: m.to,
      direction: m.direction,
      status: m.status,                       // queued/sent/delivered/read/undelivered/failed
      error_code: m.error_code,               // e.g. 63016 (no session), 63049/63024 (template issues)
      error_message: m.error_message,
      body: (m.body || '(template)').slice(0, 90),
    })),
  });
}

export const GET = handle;
