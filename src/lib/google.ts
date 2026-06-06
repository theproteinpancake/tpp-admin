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

// redirectUri lets the caller use the CURRENT origin (avoids env drift after a domain
// move). Must exactly match an Authorized redirect URI in the Google Cloud OAuth client.
export function googleRedirectUri(override?: string) {
  return override || process.env.GOOGLE_REDIRECT_URI || '';
}
export function googleAuthorizeUrl(state: string, redirectUri?: string) {
  const q = [
    `client_id=${encodeURIComponent(process.env.GOOGLE_CLIENT_ID || '')}`,
    `redirect_uri=${encodeURIComponent(googleRedirectUri(redirectUri))}`,
    `response_type=code`,
    `scope=${encodeURIComponent(GOOGLE_SCOPES)}`,
    `access_type=offline`,      // get a refresh token
    `prompt=consent`,           // force refresh token on re-consent
    `state=${encodeURIComponent(state)}`,
  ].join('&');
  return `${AUTH}?${q}`;
}

// provider key: 'google' = primary (Luke/ops), 'google_kate' = Kate's inbox, etc.
export function googleProvider(account?: string) { return account ? `google_${account}` : 'google'; }

async function save(t: { access_token: string; refresh_token?: string; expires_in: number; email?: string }, provider = 'google') {
  const row: Record<string, unknown> = {
    provider, access_token: t.access_token,
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (t.refresh_token) row.refresh_token = t.refresh_token;
  if (t.email) row.tenant_name = t.email;
  await supabaseLogistics.from('integration_tokens').upsert(row, { onConflict: 'provider' });
}

export async function googleExchangeCode(code: string, account?: string, redirectUri?: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_CLIENT_ID || '', client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: googleRedirectUri(redirectUri), grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token failed: ${res.status} ${await res.text()}`);
  const tok = await res.json();
  let email: string | undefined;
  try {
    const p = JSON.parse(Buffer.from((tok.id_token || '..').split('.')[1], 'base64').toString());
    email = p.email;
  } catch { /* ignore */ }
  await save({ ...tok, email }, googleProvider(account));
  return { email, provider: googleProvider(account) };
}

export async function getGoogleConnection(account?: string) {
  const { data } = await supabaseLogistics.from('integration_tokens').select('*').eq('provider', googleProvider(account)).maybeSingle();
  return data as null | { access_token: string; refresh_token: string; expires_at: string; tenant_name: string };
}

export async function getGoogleToken(account?: string): Promise<string | null> {
  const c = await getGoogleConnection(account);
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
  await save(tok, googleProvider(account));
  return tok.access_token;
}

async function gget(path: string, account?: string): Promise<any> {
  const token = await getGoogleToken(account);
  if (!token) throw new Error(account ? `Gmail (${account}) not connected` : 'Gmail not connected');
  const res = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Search messages (Gmail query syntax), returns lightweight {id, from, subject, snippet, date}
export async function gmailSearch(query: string, max = 10, account?: string) {
  const list = await gget(`/messages?q=${encodeURIComponent(query)}&maxResults=${max}`, account);
  const ids = (list.messages || []).map((m: any) => m.id);
  const out = [];
  for (const id of ids) {
    const m = await gget(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, account);
    const h = (m.payload?.headers || []).reduce((a: any, x: any) => (a[x.name] = x.value, a), {});
    out.push({ id, from: h.From, subject: h.Subject, date: h.Date, snippet: m.snippet });
  }
  return out;
}

export async function gmailGetBody(id: string, account?: string): Promise<string> {
  const m = await gget(`/messages/${id}?format=full`, account);
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

export interface MailAttachment { filename: string; base64: string; mime?: string }

function b64url(s: string) { return Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

// RFC 2047 encode a header value if it contains non-ASCII (else it mojibakes in the header).
function encHeader(s: string) {
  return /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf-8').toString('base64')}?=` : s;
}

function rawMessage(to: string, subject: string, body: string, attachment?: MailAttachment, cc?: string) {
  subject = encHeader(subject);
  const ccLine = cc ? [`Cc: ${cc}`] : [];
  if (!attachment) {
    const lines = [`To: ${to}`, ...ccLine, `Subject: ${subject}`, 'Content-Type: text/plain; charset=UTF-8', '', body].join('\r\n');
    return b64url(lines);
  }
  const boundary = 'tpp_' + Math.random().toString(36).slice(2);
  const wrapped = attachment.base64.replace(/[\r\n]/g, '').replace(/(.{76})/g, '$1\r\n');
  const lines = [
    `To: ${to}`, ...ccLine, `Subject: ${subject}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', '', body, '',
    `--${boundary}`,
    `Content-Type: ${attachment.mime || 'application/pdf'}; name="${attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.filename}"`, '',
    wrapped, '', `--${boundary}--`,
  ].join('\r\n');
  return b64url(lines);
}

// Create a DRAFT (does not send), optionally with a PDF attachment + CC. Returns draft id.
export async function gmailCreateDraft(to: string, subject: string, body: string, attachment?: MailAttachment, cc?: string): Promise<string> {
  const token = await getGoogleToken();
  if (!token) throw new Error('Gmail not connected');
  const res = await fetch(`${GMAIL}/drafts`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw: rawMessage(to, subject, body, attachment, cc) } }),
  });
  if (!res.ok) throw new Error(`Gmail draft failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

// Send an email immediately (To + optional Cc + optional PDF). Returns the sent message id.
export async function gmailSend(to: string, subject: string, body: string, opts: { cc?: string; attachment?: MailAttachment } = {}): Promise<string> {
  const token = await getGoogleToken();
  if (!token) throw new Error('Gmail not connected');
  const res = await fetch(`${GMAIL}/messages/send`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: rawMessage(to, subject, body, opts.attachment, opts.cc) }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
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
