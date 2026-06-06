// Daily Gmail scour: reads the logistics inbox (Maersk freight, ABC co-packer, ShipBob 3PL),
// uses Claude to extract the current status of each open job + whether the founder must act,
// and stores them as insights that feed the Action Center + morning brief.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { gmailSearch } from './google';

const MODEL = 'claude-sonnet-4-6';

const QUERIES: { category: string; q: string }[] = [
  { category: 'maersk', q: 'from:(lns.maersk.com OR maersk.com OR damco.com) newer_than:14d' },
  { category: 'abc', q: 'from:abcblending.com.au newer_than:21d' },
  { category: 'shipbob', q: 'from:shipbob.com (WRO OR receiving OR inbound OR billing OR invoice OR storage OR claim) newer_than:14d' },
  // Luke's OWN replies — so a thread he's already actioned/resolved isn't re-flagged.
  { category: 'sent', q: 'in:sent (to:abcblending.com.au OR to:shipbob.com OR to:maersk.com OR to:damco.com) newer_than:21d' },
];

export interface GmailInsight {
  source_key: string; category: string; subject: string; summary: string;
  action: string | null; needs_action: boolean; last_msg_date: string | null;
}

const normKey = (subject: string) => subject.replace(/^(re|fw|fwd):\s*/gi, '').replace(/\s+/g, ' ').trim().slice(0, 120).toLowerCase();

export async function runScour(): Promise<{ scanned: number; insights: number; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { scanned: 0, insights: 0, error: 'no api key' };

  // gather recent emails across the logistics senders
  const emails: { category: string; from: string; subject: string; date: string; snippet: string }[] = [];
  for (const { category, q } of QUERIES) {
    try {
      const msgs = await gmailSearch(q, 12);
      for (const m of msgs) emails.push({ category, from: m.from, subject: m.subject, date: m.date, snippet: m.snippet });
    } catch { /* skip a failing query */ }
  }
  if (!emails.length) return { scanned: 0, insights: 0 };

  // CURRENT OPS STATE (source of truth) so the triage can reconcile email chatter
  // against reality — e.g. "waiting on paperwork" but the PO is already received/billed.
  const stateLines: string[] = [];
  try {
    const { data: pos } = await supabaseLogistics.from('purchase_orders')
      .select('po_number, reference, status, wro_status, xero_status, updated_at')
      .order('updated_at', { ascending: false }).limit(30);
    for (const p of (pos ?? []) as any[]) {
      stateLines.push(`PO ${p.po_number || '?'} "${p.reference || ''}" — status=${p.status}${p.xero_status ? `, xero=${p.xero_status}` : ''}${p.wro_status ? `, wro=${p.wro_status}` : ''}`);
    }
    const { data: trs } = await supabaseLogistics.from('internal_transfers').select('reference, status');
    for (const t of (trs ?? []) as any[]) stateLines.push(`Transfer ${t.reference} — status=${t.status}`);
  } catch { /* state optional */ }
  const stateBlock = stateLines.length ? `\n\nCURRENT OPS STATE (source of truth — reconcile against this):\n${stateLines.join('\n')}` : '';

  // one Claude pass to triage into per-job insights
  const client = new Anthropic({ apiKey });
  const list = emails.map((e, i) => `${i + 1}. [${e.category}] ${e.date} — ${e.from}\n   Subject: ${e.subject}\n   ${e.snippet}`).join('\n');
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 1500,
    system: `You triage the logistics inbox for The Protein Pancake (a pancake-mix brand). Senders: Maersk (sea freight of AU→UK pallets), ABC Blending (AU co-packer who makes the mix and sends packing slips/dockets), ShipBob (3PL — WROs, receiving, billing).
Group the emails into ongoing JOBS (one per shipment/topic) and for each return the CURRENT status and whether the founder must act.
Rules: ignore auto-replies, out-of-office, marketing, and anything not logistics-operational. Only flag needs_action=true when the founder personally must do something (sign a doc, pay, book a slot, create a WRO, reply). Be concise.
IMPORTANT — ShipBob receiving: if a ShipBob email says goods / a WRO / an inbound shipment have been RECEIVED or receiving is COMPLETE at a fulfilment centre, set needs_action=true and make the action "Mark the matching transfer/PO as received" (name the shipment/WRO if shown) — this is how we confirm stock has actually landed.
IMPORTANT — sent mail = already handled: some emails are marked [sent] (from Luke). If Luke has already REPLIED to or RESOLVED a thread (e.g. sent the paperwork/labels, paid the invoice, made a decision, answered the request), set that job's needs_action=false — do NOT keep flagging it as waiting on Luke. Never create a job whose only message is a [sent] email; use sent mail only as evidence a thread is resolved. Only flag needs_action=true for things STILL genuinely waiting on Luke with no reply from him.
IMPORTANT — reconcile against ops state: you are given the CURRENT OPS STATE (POs + transfers with live status). If an email implies something is still pending but the ops state shows it's DONE — e.g. the matching PO is status=received or xero=BILLED or wro=Completed, or the transfer is received — then the job is COMPLETE: set needs_action=false and say so in the summary (e.g. "GF Cinnamon — received at ShipBob ✓"). Match by flavour/PO number/reference. Trust the ops state over stale email wording.
Return ONLY a JSON array, no prose: [{"source_key": "<short topic>", "category": "maersk|abc|shipbob", "summary": "<=140 char status", "needs_action": true|false, "action": "<=90 char next step or empty"}]`,
    messages: [{ role: 'user', content: `Recent logistics emails:\n\n${list}${stateBlock}` }],
  });
  const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  let parsed: any[] = [];
  try { parsed = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)); } catch { return { scanned: emails.length, insights: 0, error: 'parse failed' }; }

  const rows = parsed.filter((p) => p && p.source_key && p.summary).map((p) => {
    const key = normKey(String(p.source_key));
    const match = emails.find((e) => normKey(e.subject).includes(key.slice(0, 20)) || key.includes(normKey(e.subject).slice(0, 20)));
    return {
      source_key: key,
      category: ['maersk', 'abc', 'shipbob'].includes(p.category) ? p.category : 'other',
      subject: match?.subject ?? String(p.source_key).slice(0, 120),
      summary: String(p.summary).slice(0, 200),
      action: p.action ? String(p.action).slice(0, 120) : null,
      needs_action: !!p.needs_action,
      last_msg_date: match?.date ? new Date(match.date).toISOString() : null,
      dismissed: false,
      detected_at: new Date().toISOString(),
    };
  });
  if (rows.length) await supabaseLogistics.from('gmail_insights').upsert(rows, { onConflict: 'source_key' });
  return { scanned: emails.length, insights: rows.length };
}

export async function getGmailInsights(): Promise<GmailInsight[]> {
  const { data } = await supabaseLogistics
    .from('gmail_insights')
    .select('source_key,category,subject,summary,action,needs_action,last_msg_date')
    .eq('dismissed', false)
    .gt('detected_at', new Date(Date.now() - 21 * 86400_000).toISOString())
    .order('needs_action', { ascending: false })
    .order('last_msg_date', { ascending: false })
    .limit(15);
  return (data ?? []) as GmailInsight[];
}
