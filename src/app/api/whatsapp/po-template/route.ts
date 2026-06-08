import { NextRequest, NextResponse } from 'next/server';
import { twilioAuthHeader } from '@/lib/whatsapp';
import { getConfig, setConfig } from '@/lib/settings';

export const maxDuration = 30;

// One-shot admin route to create the "PO detected" WhatsApp template via Twilio's
// Content API and submit it for WhatsApp (Meta) approval — so the PO alert can fire
// instantly even outside Kate's 24h session window. The resulting ContentSid is stored
// in app_config (wholesale_po_template_sid); the scour reads it from there.
//   POST → create + submit + store        GET → report approval status
// Both require the cron secret. Variables: {{1}} customer (#PO), {{2}} line summary, {{3}} action.
const CONTENT_API = 'https://content.twilio.com/v1/Content';
// Plenty of fixed text around the 3 variables — Meta rejects templates whose variables
// are too large a share of the message ("too many variables for its length").
const TEMPLATE_BODY = '🛒 New wholesale purchase order from {{1}}.\n\nOrder summary: {{2}}\n\nWhat happens next: {{3}}\n\nReply to this message and I\'ll get it sorted, or open the TPP dashboard for the full details.';

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') || new URL(req.url).searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const auth = twilioAuthHeader();
  if (!auth) return NextResponse.json({ error: 'Twilio credentials not configured' }, { status: 400 });

  const existing = await getConfig('wholesale_po_template_sid');

  // GET → current status incl. WhatsApp approval state
  if (req.method === 'GET') {
    if (!existing) return NextResponse.json({ ok: true, configured: false, hint: 'POST here with the cron secret to create + submit the template.' });
    const res = await fetch(`${CONTENT_API}/${existing}/ApprovalRequests`, { headers: { Authorization: auth } });
    const j = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: true, configured: true, content_sid: existing, approval: (j as any)?.whatsapp ?? j });
  }

  // POST → create, submit for approval, store. ?force=1 re-creates even if one exists
  // (e.g. after a rejection). Each submission uses a unique name (WhatsApp names must be
  // unique within the business account).
  const force = new URL(req.url).searchParams.get('force');
  if (existing && !force) return NextResponse.json({ ok: true, already: true, content_sid: existing, note: 'Already created — GET to check approval status, or POST with &force=1 to recreate.' });

  const name = `wholesale_po_alert_${Date.now().toString(36)}`;
  const createRes = await fetch(CONTENT_API, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      friendly_name: name,
      language: 'en',
      variables: { '1': 'Highland Evolution (#PO347986)', '2': 'Buttermilk ×4, Salted Caramel ×2', '3': 'Stock is good — reply to process it.' },
      types: { 'twilio/text': { body: TEMPLATE_BODY } },
    }),
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !(created as any)?.sid) {
    return NextResponse.json({ error: 'create failed', status: createRes.status, detail: created }, { status: 502 });
  }
  const contentSid = (created as any).sid as string;

  const approvalRes = await fetch(`${CONTENT_API}/${contentSid}/ApprovalRequests/whatsapp`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, category: 'UTILITY' }),
  });
  const approval = await approvalRes.json().catch(() => ({}));

  await setConfig('wholesale_po_template_sid', contentSid);
  return NextResponse.json({ ok: true, content_sid: contentSid, submitted: approvalRes.ok, approval });
}

export const GET = handle;
export const POST = handle;
