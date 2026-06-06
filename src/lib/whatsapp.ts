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

export async function sendWhatsApp(to: string, body: string, mediaUrl?: string): Promise<boolean> {
  const sid = SID(), from = FROM();
  const auth = twilioAuthHeader();
  const msgService = process.env.TWILIO_MESSAGING_SERVICE_SID || '';
  if (!sid || !auth || (!from && !msgService)) { console.error('Twilio env missing'); return false; }
  const params = new URLSearchParams({ To: waAddr(to), Body: body.slice(0, 1550) });
  // Prefer the Messaging Service when configured; otherwise send directly from the number.
  if (msgService) params.set('MessagingServiceSid', msgService);
  else params.set('From', waAddr(from)); // normalise so a missing "whatsapp:" prefix still works
  if (mediaUrl) params.set('MediaUrl', mediaUrl);
  const res = await fetch(`${TWILIO_API_BASE}/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  if (!res.ok) { console.error('Twilio send failed', res.status, await res.text()); return false; }
  return true;
}
