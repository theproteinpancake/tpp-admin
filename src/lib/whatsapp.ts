// Twilio WhatsApp send helper + allowlist (server-side).
const SID = () => process.env.TWILIO_ACCOUNT_SID || '';
const TOKEN = () => process.env.TWILIO_AUTH_TOKEN || '';
const FROM = () => process.env.TWILIO_WHATSAPP_FROM || '';
// Standard US1 account — use the default US1 host. Override with TWILIO_API_BASE if needed.
export const TWILIO_API_BASE = process.env.TWILIO_API_BASE || 'https://api.twilio.com';

// Prefer API Key auth (SK… + secret) — recommended by Twilio and required by some
// regional accounts; fall back to Account SID + Auth Token. The URL path always
// uses the AC account SID regardless of which credential authenticates.
export function twilioAuthHeader(): string | null {
  const keySid = process.env.TWILIO_API_KEY_SID || '';
  const keySecret = process.env.TWILIO_API_KEY_SECRET || '';
  if (keySid && keySecret) return 'Basic ' + Buffer.from(`${keySid}:${keySecret}`).toString('base64');
  const sid = SID(), token = TOKEN();
  if (sid && token) return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  return null;
}

// normalise to Twilio's "whatsapp:+E164" form
export function waAddr(n: string): string {
  const t = n.trim();
  if (!t) return '';
  return t.startsWith('whatsapp:') ? t : `whatsapp:${t.startsWith('+') ? t : '+' + t.replace(/^0+/, '')}`;
}

export function allowedNumbers(): string[] {
  return (process.env.WHATSAPP_ALLOWED_NUMBERS || '')
    .split(',').map((s) => waAddr(s)).filter(Boolean);
}

export function isAllowed(from: string): boolean {
  const a = allowedNumbers();
  return a.length === 0 ? false : a.includes(waAddr(from));
}

// Kate (wholesale manager) — her number gets the wholesale persona + wholesale brief.
export const KATE_NUMBER = process.env.KATE_WHATSAPP || '+61424430599';
export type SenderRole = 'wholesale' | 'owner';
export function senderRole(from: string): SenderRole {
  return waAddr(from) === waAddr(KATE_NUMBER) ? 'wholesale' : 'owner';
}

// Fetch an inbound Twilio media item (e.g. a WhatsApp screenshot) as base64 + type.
// Twilio media URLs need account auth; the request 307-redirects to the actual file.
// Detect image type from the file's MAGIC BYTES (the content-type header is often
// wrong/octet-stream after the S3 redirect, and a media_type mismatch makes the
// vision API reject the whole request).
function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Did our most recent outbound message to this person actually DELIVER? Twilio accepts sends
// that Meta later drops silently (63049 marketing cap, 63016 out-of-session) — the send call
// returns true either way. Polls the newest outbound created within `sinceMs`.
export async function verifyRecentDelivery(to: string, sinceMs: number): Promise<{ ok: boolean; status?: string; error_code?: number }> {
  const sid = SID(), auth = twilioAuthHeader();
  if (!sid || !auth) return { ok: true }; // can't verify → assume ok
  try {
    const q = new URLSearchParams({ To: waAddr(to), PageSize: '3' });
    const res = await fetch(`${TWILIO_API_BASE}/2010-04-01/Accounts/${sid}/Messages.json?${q}`, { headers: { Authorization: auth } });
    if (!res.ok) return { ok: true };
    const recent = ((await res.json()).messages || []).filter((m: any) =>
      m.direction?.startsWith('outbound') && Date.now() - new Date(m.date_created).getTime() < sinceMs);
    const dead = recent.find((m: any) => ['undelivered', 'failed'].includes(m.status));
    if (dead) return { ok: false, status: dead.status, error_code: dead.error_code };
    return { ok: true, status: recent[0]?.status };
  } catch { return { ok: true }; }
}

// List recent messages to a number (for the review-delivery repair sweep).
export async function recentMessagesTo(to: string, limit = 10): Promise<{ date: string; status: string; error_code: number | null; body: string }[]> {
  const sid = SID(), auth = twilioAuthHeader();
  if (!sid || !auth) return [];
  try {
    const q = new URLSearchParams({ To: waAddr(to), PageSize: String(limit) });
    const res = await fetch(`${TWILIO_API_BASE}/2010-04-01/Accounts/${sid}/Messages.json?${q}`, { headers: { Authorization: auth } });
    if (!res.ok) return [];
    return ((await res.json()).messages || []).filter((m: any) => m.direction?.startsWith('outbound'))
      .map((m: any) => ({ date: m.date_created, status: m.status, error_code: m.error_code ?? null, body: m.body || '' }));
  } catch { return []; }
}

// Tappable quick-reply buttons (DHL-style). Body + labels ride the generic tpp_buttons_N
// content resource; a tap comes back as the button's EXACT label — deterministic routing, no
// free-text "yes" interpretation. Unapproved content still delivers inside the 24h session,
// which is where confirmations always happen. Returns false if unconfigured (caller falls
// back to plain text).
export async function sendWhatsAppButtons(to: string, body: string, labels: string[]): Promise<boolean> {
  const clean = labels.map((l) => l.trim().slice(0, 20)).filter(Boolean).slice(0, 3); // WhatsApp cap: 3 buttons, 20 chars each
  if (clean.length < 2) return false;
  const { getTemplateSid } = await import('./waTemplates'); // lazy — avoids an import cycle
  const sid = await getTemplateSid(`tpp_buttons_${clean.length}`);
  if (!sid) return false;
  const vars: Record<string, string> = { '1': body.slice(0, 1000) };
  clean.forEach((l, i) => { vars[String(i + 2)] = l; });
  return sendWhatsAppTemplate(to, sid, vars);
}

// Is the 24h WhatsApp session window with this person open? (i.e. did THEY message us in the
// last ~23h.) In-session, free-form sends are allowed — and immune to Meta's per-user
// MARKETING-template cap (error 63049), which silently ate the daily sales reviews.
export async function hasOpenSession(to: string): Promise<boolean> {
  const sid = SID(), auth = twilioAuthHeader();
  if (!sid || !auth) return false;
  try {
    const q = new URLSearchParams({ From: waAddr(to), PageSize: '1' });
    const res = await fetch(`${TWILIO_API_BASE}/2010-04-01/Accounts/${sid}/Messages.json?${q}`, { headers: { Authorization: auth } });
    if (!res.ok) return false;
    const m = (await res.json()).messages?.[0];
    return !!m && Date.now() - new Date(m.date_created).getTime() < 23 * 3600_000;
  } catch { return false; }
}

export async function fetchTwilioMedia(url: string): Promise<{ base64: string; mediaType: string } | null> {
  const auth = twilioAuthHeader();
  if (!auth) return null;
  try {
    const res = await fetch(url, { headers: { Authorization: auth } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return null;
    // trust magic bytes over the header; fall back to a clean header value
    const headerType = (res.headers.get('content-type') || '').split(';')[0].trim();
    const mediaType = sniffImageType(buf) || (/^image\/(jpeg|png|gif|webp)$/.test(headerType) ? headerType : null);
    if (!mediaType) return null; // not a supported image — skip it
    if (buf.length > 4_800_000) return null; // over the vision size limit — skip
    return { base64: buf.toString('base64'), mediaType };
  } catch { return null; }
}

// POST a message to Twilio with RETRY on transient failures (network error, 5xx, 429).
// 4xx errors are permanent (bad number, closed 24h window, rejected template) — no retry.
// Briefs ride on this; a single network blip must not silently eat a morning brief.
async function twilioSend(params: URLSearchParams, label: string): Promise<boolean> {
  const sid = SID(), auth = twilioAuthHeader();
  if (!sid || !auth) { console.error(`Twilio ${label}: missing credentials`); return false; }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${TWILIO_API_BASE}/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
      if (res.ok) return true;
      const body = await res.text();
      if (res.status < 500 && res.status !== 429) { console.error(`Twilio ${label} failed (permanent)`, res.status, body.slice(0, 300)); return false; }
      console.error(`Twilio ${label} failed (attempt ${attempt + 1})`, res.status, body.slice(0, 200));
    } catch (e) {
      console.error(`Twilio ${label} network error (attempt ${attempt + 1})`, String(e).slice(0, 200));
    }
    await sleep(2000 * (attempt + 1));
  }
  return false;
}

// Send a pre-approved WhatsApp **template** (Twilio Content API). Unlike sendWhatsApp,
// a template delivers OUTSIDE the 24-hour customer-service window — so proactive alerts
// (e.g. a PO detected at 4am) actually reach Kate. `variables` maps "1","2",… → value;
// each value must be a single line (WhatsApp rejects newlines/tabs inside variables).
export async function sendWhatsAppTemplate(to: string, contentSid: string, variables: Record<string, string>): Promise<boolean> {
  const from = FROM();
  const msgService = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
  if (!contentSid || (!from && !msgService)) { console.error('Twilio template send: missing config'); return false; }
  const params = new URLSearchParams({ To: waAddr(to), ContentSid: contentSid, ContentVariables: JSON.stringify(variables) });
  if (msgService) params.set('MessagingServiceSid', msgService);
  else params.set('From', waAddr(from));
  return twilioSend(params, 'template send');
}

// Fetch the body of a previously-sent message (used to give the agent reply context when the
// user quotes/replies to one of our proactive messages — Twilio sends OriginalRepliedMessageSid).
export async function fetchTwilioMessageBody(sid: string): Promise<string | null> {
  const acct = SID(), auth = twilioAuthHeader();
  if (!acct || !auth || !sid) return null;
  try {
    const res = await fetch(`${TWILIO_API_BASE}/2010-04-01/Accounts/${acct}/Messages/${sid}.json`, { headers: { Authorization: auth } });
    if (!res.ok) return null;
    const j = await res.json();
    return (j.body as string) || null;
  } catch { return null; }
}

// Fetch a Twilio PDF attachment (e.g. an invoice/docket the user sends) as base64, so the agent
// can actually READ it. Verifies the %PDF magic bytes; caps size for the document API.
export async function fetchTwilioPdf(url: string): Promise<{ base64: string } | null> {
  const auth = twilioAuthHeader();
  if (!auth) return null;
  try {
    const res = await fetch(url, { headers: { Authorization: auth } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 || buf.length > 25_000_000) return null;
    if (buf.subarray(0, 4).toString('latin1') !== '%PDF') return null;
    return { base64: buf.toString('base64') };
  } catch { return null; }
}

export async function sendWhatsApp(to: string, body: string, mediaUrl?: string): Promise<boolean> {
  const from = FROM();
  const msgService = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
  if (!from && !msgService) { console.error('Twilio env missing'); return false; }
  const params = new URLSearchParams({ To: waAddr(to), Body: body.slice(0, 1550) });
  // Prefer the Messaging Service when configured; otherwise send directly from the number.
  if (msgService) params.set('MessagingServiceSid', msgService);
  else params.set('From', waAddr(from)); // normalise so a missing "whatsapp:" prefix still works
  if (mediaUrl) params.set('MediaUrl', mediaUrl);
  return twilioSend(params, 'send');
}
