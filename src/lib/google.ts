// Gmail (Google Workspace) OAuth + helpers. Server-side only.
import { supabaseLogistics } from './supabase-logistics';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

// read + drafts + labels (gmail.modify) and send
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'openid', 'email',
].join(' ');

export function googleConfigured() {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

export function googleAuthorizeUrl(state: string) {
  const q = [
    `client_id=${encodeURIComponent(process.env.GOOGLE_CLIENT_ID || '')}`,
    `redirect_uri=${encodeURIComponent(process.env.GOOGLE_REDIRECT_URI || '')}`,
    `response_type=code`,
    `scope=${encodeURIComponent(GOOGLE_SCOPES)}`,
    `access_type=offline`,      // get a refresh token
    `prompt=consent`,           // force refresh token on re-consent
    `state=${encodeURIComponent(state)}`,
  ].join('&');
  return `${AUTH}?${q}`;
}

async function save(t: { access_token: string; refresh_token?: string; expires_in: number; email?: string }) {
  const row: Record<string, unknown> = {
    provider: 'google', access_token: t.access_token,
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (t.refresh_token) row.refresh_token = t.refresh_token;
  if (t.email) row.tenant_name = t.email;
  await supabaseLogistics.from('integration_tokens').upsert(row, { onConflict: 'provider' });
}

export async function googleExchangeCode(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_CLIENT_ID || '', client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: process.env.GOOGLE_REDIRECT_URI || '', grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token failed: ${res.status} ${await res.text()}`);
  const tok = await res.json();
  let email: string | undefined;
  try {
    const p = JSON.parse(Buffer.from((tok.id_token || '..').split('.')[1], 'base64').toString());
    email = p.email;
  } catch { /* ignore */ }
  await save({ ...tok, email });
  return { email };
}

export async function getGoogleConnection() {
  const { data } = await supabaseLogistics.from('integration_tokens').select('*').eq('provider', 'google').maybeSingle();
  return data as null | { access_token: string; refresh_token: string; expires_at: string; tenant_name: string };
}

export async function getGoogleToken(): Promise<string | null> {
  const c = await getGoogleConnection();
  if (!c) return null;
  if (c.access_token && c.expires_at && new Date(c.expires_at).getTime() > Date.now()) return c.access_token;
  if (!c.refresh_token) return null;
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: c.refresh_token, client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '', grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google refresh failed: ${res.status} ${await res.text()}`);
  const tok = await res.json();
  await save(tok);
  return tok.access_token;
}

async function gget(path: string): Promise<any> {
  const token = await getGoogleToken();
  if (!token) throw new Error('Gmail not connected');
  const res = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Search messages (Gmail query syntax), returns lightweight {id, from, subject, snippet, date}
export async function gmailSearch(query: string, max = 10) {
  const list = await gget(`/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
  const ids = (list.messages || []).map((m: any) => m.id);
  const out = [];
  for (const id of ids) {
    const m = await gget(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    const h = (m.payload?.headers || []).reduce((a: any, x: any) => (a[x.name] = x.value, a), {});
    out.push({ id, from: h.From, subject: h.Subject, date: h.Date, snippet: m.snippet });
  }
  return out;
}

export async function gmailGetBody(id: string): Promise<string> {
  const m = await gget(`/messages/${id}?format=full`);
  const walk = (p: any): string => {
    if (p.mimeType === 'text/plain' && p.body?.data) return Buffer.from(p.body.data, 'base64').toString();
    for (const part of p.parts || []) { const r = walk(part); if (r) return r; }
    return '';
  };
  return walk(m.payload || {}).slice(0, 8000);
}

// Find the first PDF attachment on a message and return it as standard base64.
function findPdfPart(p: any): { filename: string; attachmentId: string } | null {
  if (p?.filename && /\.pdf$/i.test(p.filename) && p.body?.attachmentId) {
    return { filename: p.filename, attachmentId: p.body.attachmentId };
  }
  for (const part of p?.parts || []) { const r = findPdfPart(part); if (r) return r; }
  return null;
}

export async function gmailGetPdfAttachment(messageId: string): Promise<{ filename: string; base64: string } | null> {
  const m = await gget(`/messages/${messageId}?format=full`);
  const f = findPdfPart(m.payload || {});
  if (!f) return null;
  const att = await gget(`/messages/${messageId}/attachments/${f.attachmentId}`);
  const std = (att.data as string).replace(/-/g, '+').replace(/_/g, '/'); // url-safe -> std base64
  return { filename: f.filename, base64: std };
}

function rawMessage(to: string, subject: string, body: string, from?: string) {
  const lines = [
    from ? `From: ${from}` : '', `To: ${to}`, `Subject: ${subject}`,
    'Content-Type: text/plain; charset=UTF-8', '', body,
  ].filter(Boolean).join('\r\n');
  return Buffer.from(lines).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Create a DRAFT (does not send). Returns draft id.
export async function gmailCreateDraft(to: string, subject: string, body: string): Promise<string> {
  const token = await getGoogleToken();
  if (!token) throw new Error('Gmail not connected');
  const res = await fetch(`${GMAIL}/drafts`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw: rawMessage(to, subject, body) } }),
  });
  if (!res.ok) throw new Error(`Gmail draft failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

// Send an existing draft.
export async function gmailSendDraft(draftId: string): Promise<void> {
  const token = await getGoogleToken();
  if (!token) throw new Error('Gmail not connected');
  const res = await fetch(`${GMAIL}/drafts/send`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: draftId }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
}
