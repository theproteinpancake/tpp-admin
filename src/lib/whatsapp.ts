// Twilio WhatsApp send helper + allowlist (server-side).
const SID = () => process.env.TWILIO_ACCOUNT_SID || '';
const TOKEN = () => process.env.TWILIO_AUTH_TOKEN || '';
const FROM = () => process.env.TWILIO_WHATSAPP_FROM || '';
// Account is pinned to the AU1 region — REST calls must hit the regional edge,
// not the default US1 host. Override with TWILIO_API_BASE if the region changes.
export const TWILIO_API_BASE = process.env.TWILIO_API_BASE || 'https://api.au1.twilio.com';

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

export async function sendWhatsApp(to: string, body: string, mediaUrl?: string): Promise<boolean> {
  const sid = SID(), token = TOKEN(), from = FROM();
  if (!sid || !token || !from) { console.error('Twilio env missing'); return false; }
  const params = new URLSearchParams({ To: waAddr(to), From: from, Body: body.slice(0, 1550) });
  if (mediaUrl) params.set('MediaUrl', mediaUrl);
  const res = await fetch(`${TWILIO_API_BASE}/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  if (!res.ok) { console.error('Twilio send failed', res.status, await res.text()); return false; }
  return true;
}
