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

// Read-only Google Ads reporting — separate scope so re-consenting Gmail never touches this,
// and vice versa. Requested only on the account=ads connect flow (provider 'google_ads').
export const GOOGLE_ADS_SCOPES = [
  'https://www.googleapis.com/auth/adwords',
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
export function googleAuthorizeUrl(state: string, redirectUri?: string, scope?: string) {
  const q = [
    `client_id=${encodeURIComponent(process.env.GOOGLE_CLIENT_ID || '')}`,
    `redirect_uri=${encodeURIComponent(googleRedirectUri(redirectUri))}`,
    `response_type=code`,
    `scope=${encodeURIComponent(scope || GOOGLE_SCOPES)}`,
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

async function gpost(path: string, body: unknown, account?: string): Promise<any> {
  const token = await getGoogleToken(account);
  if (!token) throw new Error(account ? `Gmail (${account}) not connected` : 'Gmail not connected');
  const res = await fetch(`${GMAIL}${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gmail POST ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---- "TPP Control" label: applied to every email the agent drafts or sends, so Luke/Kate
// can filter their inboxes for agent work at a glance. Created on first use per account. ----
const CONTROL_LABEL = 'TPP Control';
const _labelIds: Record<string, string> = {};
async function controlLabelId(account?: string): Promise<string | null> {
  const key = account || 'primary';
  if (_labelIds[key]) return _labelIds[key];
  try {
    const list = await gget('/labels', account);
    let id = (list.labels || []).find((l: any) => l.name === CONTROL_LABEL)?.id as string | undefined;
    if (!id) id = (await gpost('/labels', { name: CONTROL_LABEL, labelListVisibility: 'labelShow', messageListVisibility: 'show' }, account))?.id;
    if (id) _labelIds[key] = id;
    return id || null;
  } catch { return null; }
}
// Best-effort — labelling must never break a draft/send.
export async function applyControlLabel(messageId: string | undefined, account?: string): Promise<void> {
  if (!messageId) return;
  try {
    const id = await controlLabelId(account);
    if (id) await gpost(`/messages/${messageId}/modify`, { addLabelIds: [id] }, account);
  } catch { /* cosmetic */ }
}

// Search messages (Gmail query syntax), returns lightweight {id, from, subject, snippet, date}
export async function gmailSearch(query: string, max = 10, account?: string) {
  const list = await gget(`/messages?q=${encodeURIComponent(query)}&maxResults=${max}`, account);
  const msgs = (list.messages || []) as { id: string; threadId: string }[];
  const out = [];
  for (const m0 of msgs) {
    const m = await gget(`/messages/${m0.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=Reply-To`, account);
    const h = (m.payload?.headers || []).reduce((a: any, x: any) => (a[x.name] = x.value, a), {});
    out.push({ id: m0.id, threadId: m.threadId as string, from: h.From, subject: h.Subject, date: h.Date, messageId: h['Message-ID'], replyTo: h['Reply-To'] as string | undefined, snippet: m.snippet });
  }
  return out;
}

// Latest message in a thread (for reply-watching). Returns from/snippet/internalDate (ms).
export async function gmailGetThreadLatest(threadId: string, account?: string): Promise<{ from: string; snippet: string; internalDate: number } | null> {
  try {
    const t = await gget(`/threads/${threadId}?format=metadata&metadataHeaders=From`, account);
    const msgs = (t.messages || []) as any[];
    if (!msgs.length) return null;
    const last = msgs[msgs.length - 1];
    const h = (last.payload?.headers || []).reduce((a: any, x: any) => (a[x.name] = x.value, a), {});
    return { from: h.From || '', snippet: last.snippet || '', internalDate: Number(last.internalDate || 0) };
  } catch { return null; }
}

export async function gmailGetBody(id: string, account?: string): Promise<string> {
  const m = await gget(`/messages/${id}?format=full`, account);
  const findMime = (p: any, mime: string): string => {
    if (p.mimeType === mime && p.body?.data) return Buffer.from(p.body.data, 'base64').toString();
    for (const part of p.parts || []) { const r = findMime(part, mime); if (r) return r; }
    return '';
  };
  const payload = m.payload || {};
  let text = findMime(payload, 'text/plain');
  // fall back to HTML (e.g. emails that are an HTML table only) — strip tags to text
  if (!text.trim()) {
    const html = findMime(payload, 'text/html');
    if (html) text = html.replace(/<\/(td|th|tr|p|div|li|h[1-6])>/gi, ' $& ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  return text.slice(0, 12000);
}

// All attachments on a message (PDF/CSV/etc) as standard base64 + mime.
function collectAttachments(p: any, out: { filename: string; attachmentId: string; mimeType: string }[] = []) {
  if (p?.filename && p.body?.attachmentId) out.push({ filename: p.filename, attachmentId: p.body.attachmentId, mimeType: p.mimeType || '' });
  for (const part of p?.parts || []) collectAttachments(part, out);
  return out;
}
export async function gmailGetAllAttachments(messageId: string, account?: string): Promise<{ filename: string; mimeType: string; base64: string }[]> {
  const m = await gget(`/messages/${messageId}?format=full`, account);
  const parts = collectAttachments(m.payload || {});
  const out: { filename: string; mimeType: string; base64: string }[] = [];
  for (const f of parts) {
    try {
      const att = await gget(`/messages/${messageId}/attachments/${f.attachmentId}`, account);
      const std = (att.data as string).replace(/-/g, '+').replace(/_/g, '/');
      out.push({ filename: f.filename, mimeType: f.mimeType, base64: std });
    } catch { /* skip a failing attachment */ }
  }
  return out;
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

// Accepts a single attachment or an array (multiple PDFs, e.g. invoice + packing list).
function rawMessage(to: string, subject: string, body: string, attachment?: MailAttachment | MailAttachment[], cc?: string) {
  subject = encHeader(subject);
  const ccLine = cc ? [`Cc: ${cc}`] : [];
  const atts = (Array.isArray(attachment) ? attachment : attachment ? [attachment] : []).filter(Boolean);
  if (!atts.length) {
    const lines = [`To: ${to}`, ...ccLine, `Subject: ${subject}`, 'Content-Type: text/plain; charset=UTF-8', '', body].join('\r\n');
    return b64url(lines);
  }
  const boundary = 'tpp_' + Math.random().toString(36).slice(2);
  const parts: string[] = [
    `To: ${to}`, ...ccLine, `Subject: ${subject}`, 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', '', body, '',
  ];
  for (const a of atts) {
    const wrapped = a.base64.replace(/[\r\n]/g, '').replace(/(.{76})/g, '$1\r\n');
    parts.push(
      `--${boundary}`,
      `Content-Type: ${a.mime || 'application/pdf'}; name="${a.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.filename}"`, '',
      wrapped, '',
    );
  }
  parts.push(`--${boundary}--`);
  return b64url(parts.join('\r\n'));
}

// Create a DRAFT (does not send), optionally with PDF attachment(s) + CC. Returns draft id.
export async function gmailCreateDraft(to: string, subject: string, body: string, attachment?: MailAttachment | MailAttachment[], cc?: string): Promise<string> {
  const token = await getGoogleToken();
  if (!token) throw new Error('Gmail not connected');
  const res = await fetch(`${GMAIL}/drafts`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw: rawMessage(to, subject, body, attachment, cc) } }),
  });
  if (!res.ok) throw new Error(`Gmail draft failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  await applyControlLabel(j.message?.id);
  return j.id;
}

// Create a threaded REPLY draft in a specific inbox (does not send). Returns draft id.
// Used for OOS-stockist replies so they sit in the original PO thread for review.
export async function gmailCreateReplyDraft(opts: {
  account?: string; to: string; subject: string; body: string; threadId?: string; inReplyTo?: string; cc?: string;
}): Promise<string> {
  const token = await getGoogleToken(opts.account);
  if (!token) throw new Error(opts.account ? `Gmail (${opts.account}) not connected` : 'Gmail not connected');
  const subj = /^re:/i.test(opts.subject) ? opts.subject : `Re: ${opts.subject}`;
  const ccLine = opts.cc ? [`Cc: ${opts.cc}`] : [];
  const refLines = opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`, `References: ${opts.inReplyTo}`] : [];
  const lines = [`To: ${opts.to}`, ...ccLine, `Subject: ${encHeader(subj)}`, ...refLines, 'Content-Type: text/plain; charset=UTF-8', '', opts.body].join('\r\n');
  const message: Record<string, unknown> = { raw: b64url(lines) };
  if (opts.threadId) message.threadId = opts.threadId;
  const res = await fetch(`${GMAIL}/drafts`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`Gmail reply draft failed: ${res.status} ${await res.text()}`);
  const j = await res.json();
  await applyControlLabel(j.message?.id, opts.account);
  return j.id;
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
  const sent = await res.json();
  await applyControlLabel(sent.id);
  return sent.id;
}

// Send a draft, but VERIFY it's real: the draft must exist AND have a recipient (a To-less
// draft "sends" as a silent no-op), and the response must confirm a SENT message. Returns the
// sent message id + recipient so callers can report a grounded confirmation (never a false "sent").
export async function gmailSendDraft(draftId: string): Promise<{ id: string; to: string }> {
  const token = await getGoogleToken();
  if (!token) throw new Error('Gmail not connected');
  // pre-flight: the draft must still exist and actually have a recipient
  const pre = await fetch(`${GMAIL}/drafts/${draftId}?format=metadata`, { headers: { Authorization: `Bearer ${token}` } });
  if (!pre.ok) throw new Error(`Draft not found (${pre.status}) — it was already sent or deleted, so nothing to send.`);
  const draft = await pre.json();
  const headers = (draft.message?.payload?.headers || []) as { name: string; value: string }[];
  const to = (headers.find((h) => h.name?.toLowerCase() === 'to')?.value || '').trim();
  if (!to) throw new Error('Draft has no recipient — refusing to send (this would be a silent no-op). Re-draft with a To address.');

  const res = await fetch(`${GMAIL}/drafts/send`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: draftId }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${res.status} ${await res.text()}`);
  const sent = await res.json();
  if (!sent?.id || !(sent.labelIds || []).includes('SENT')) throw new Error('Send not confirmed — Gmail did not return a SENT message.');
  await applyControlLabel(sent.id);
  return { id: sent.id, to };
}

// Delete a draft by id (best-effort).
export async function gmailDeleteDraft(draftId: string): Promise<boolean> {
  const token = await getGoogleToken();
  if (!token) return false;
  const res = await fetch(`${GMAIL}/drafts/${draftId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  return res.ok;
}

// Delete every existing draft whose Subject matches exactly — used to supersede prior un-sent
// copies of the SAME order so duplicate drafts never pile up. Returns how many were removed.
export async function gmailDeleteDraftsBySubject(subject: string): Promise<number> {
  const token = await getGoogleToken();
  if (!token) return 0;
  const want = subject.trim().toLowerCase();
  let deleted = 0;
  try {
    const list = await (await fetch(`${GMAIL}/drafts?maxResults=50`, { headers: { Authorization: `Bearer ${token}` } })).json();
    for (const d of (list.drafts || []) as { id: string }[]) {
      try {
        const m = await (await fetch(`${GMAIL}/drafts/${d.id}?format=metadata`, { headers: { Authorization: `Bearer ${token}` } })).json();
        const subj = ((m.message?.payload?.headers || []) as { name: string; value: string }[]).find((h) => h.name?.toLowerCase() === 'subject')?.value || '';
        if (subj.trim().toLowerCase() === want) { if (await gmailDeleteDraft(d.id)) deleted++; }
      } catch { /* skip */ }
    }
  } catch { /* listing failed — nothing deleted */ }
  return deleted;
}
