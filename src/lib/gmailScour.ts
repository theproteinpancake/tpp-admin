// Daily Gmail scour: reads the logistics inbox (Maersk freight, ABC co-packer, ShipBob 3PL),
// uses Claude to extract the current status of each open job + whether the founder must act,
// and stores them as insights that feed the Action Center + morning brief.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { gmailSearch } from './google';
import { getTemplateSid } from './waTemplates';
import { sendWhatsAppTemplate, allowedNumbers, senderRole } from './whatsapp';

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

export async function runScour(): Promise<{ scanned: number; insights: number; events_fired?: number; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { scanned: 0, insights: 0, error: 'no api key' };

  // gather recent emails across the logistics senders (keep threadId — it's the STABLE key,
  // unlike the LLM topic which drifts wording each run and breaks dismissals)
  const emails: { category: string; threadId: string; from: string; subject: string; date: string; snippet: string }[] = [];
  for (const { category, q } of QUERIES) {
    try {
      const msgs = await gmailSearch(q, 12);
      for (const m of msgs) emails.push({ category, threadId: m.threadId, from: m.from, subject: m.subject, date: m.date, snippet: m.snippet });
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
For each job include "email_index": the number (from the list) of the PRIMARY email this job is about.
ALSO detect concrete STATE CHANGES as "events" (may be empty) — ONLY when an email shows the change has happened NOW (never an ETA/forecast):
 • transfer_update — a Maersk email shows a pallet/transfer changed status: {"type":"transfer_update","reference":"INTERNAL2","new_status":"in_transit|customs|arrived|received","detail":"<=120 char what changed e.g. cleared customs, requesting booking slot"}
 • wro_received — a ShipBob email confirms a WRO / inbound shipment was RECEIVED into inventory at a fulfilment centre: {"type":"wro_received","po_ref":"<PO reference or flavour named in the email>","location":"Altona|Manchester","detail":"<=120 char"}
Return ONLY a JSON object, no prose: {"jobs":[{"email_index":<n>,"source_key":"<topic>","category":"maersk|abc|shipbob","summary":"<=140 char","needs_action":true|false,"action":"<=90 char or empty"}],"events":[ ... ]}`,
    messages: [{ role: 'user', content: `Recent logistics emails:\n\n${list}${stateBlock}` }],
  });
  const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  let obj: any = {};
  try { obj = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { return { scanned: emails.length, insights: 0, error: 'parse failed' }; }
  const parsed: any[] = Array.isArray(obj.jobs) ? obj.jobs : [];
  const events: any[] = Array.isArray(obj.events) ? obj.events : [];

  const rows = parsed.filter((p) => p && p.summary).map((p) => {
    // Stable key = the email's thread id. Fall back to a normalised topic only if the index is missing.
    const idx = Number(p.email_index) - 1;
    const e = idx >= 0 && idx < emails.length ? emails[idx] : undefined;
    const key = e?.threadId ? `thread:${e.threadId}` : normKey(String(p.source_key || p.summary));
    return {
      source_key: key,
      category: ['maersk', 'abc', 'shipbob'].includes(p.category) ? p.category : (e?.category || 'other'),
      subject: e?.subject ?? String(p.source_key || '').slice(0, 120),
      summary: String(p.summary).slice(0, 200),
      action: p.action ? String(p.action).slice(0, 120) : null,
      needs_action: !!p.needs_action,
      last_msg_date: e?.date ? new Date(e.date).toISOString() : null,
      detected_at: new Date().toISOString(),
    };
  }).filter((r) => !emails.find((e) => `thread:${e.threadId}` === r.source_key && e.category === 'sent')); // never a job whose key is a sent-only thread

  if (rows.length) {
    // PRESERVE the founder's dismissals — never reset `dismissed` back to false on re-scour.
    const keys = Array.from(new Set(rows.map((r) => r.source_key)));
    const { data: prev } = await supabaseLogistics.from('gmail_insights').select('source_key, dismissed').in('source_key', keys);
    const dmap = new Map((prev ?? []).map((d: any) => [d.source_key, !!d.dismissed]));
    const payload = rows.map((r) => ({ ...r, dismissed: dmap.get(r.source_key) ?? false }));
    await supabaseLogistics.from('gmail_insights').upsert(payload, { onConflict: 'source_key' });
    // Drop legacy topic-keyed rows (pre thread-id) so they don't double up with the stable ones.
    try { await supabaseLogistics.from('gmail_insights').delete().not('source_key', 'like', 'thread:%'); } catch { /* best-effort */ }
  }

  // Real-time event pings: apply the detected state change to the DB and notify the owner —
  // deduped by DB state (we only ping when the change is genuinely new).
  const eventsFired = await applyEvents(events).catch(() => 0);
  return { scanned: emails.length, insights: rows.length, events_fired: eventsFired };
}

const TRANSFER_STATES = ['in_transit', 'customs', 'arrived', 'received'];
function transferNext(status: string): string {
  return status === 'customs' ? 'Confirm any customs paperwork, then watch for the delivery slot.'
    : status === 'arrived' ? 'Awaiting ShipBob receiving into inventory.'
    : status === 'received' ? 'Counted into inventory — now sellable.'
    : 'In transit — tracking to the next milestone.';
}

// Apply detected state-changes + fire the templated owner ping. DB state is the dedup: a
// transfer only pings when its status actually changes; a WRO only when the PO isn't already received.
async function applyEvents(events: any[]): Promise<number> {
  if (!events.length) return 0;
  const owners = allowedNumbers().filter((to) => senderRole(to) === 'owner');
  if (!owners.length) return 0;
  let fired = 0;
  const ping = async (tplKey: string, vars: Record<string, string>) => {
    const sid = await getTemplateSid(tplKey);
    if (!sid) return false;
    let ok = false;
    for (const to of owners) { if (await sendWhatsAppTemplate(to, sid, vars)) ok = true; }
    if (ok) fired++;
    return ok;
  };
  for (const ev of events) {
    try {
      if (ev?.type === 'transfer_update' && ev.reference && TRANSFER_STATES.includes(ev.new_status)) {
        const ref = String(ev.reference).trim();
        const { data: t } = await supabaseLogistics.from('internal_transfers').select('reference,status').ilike('reference', ref).maybeSingle();
        if (t && t.status !== ev.new_status) {
          await supabaseLogistics.from('internal_transfers').update({ status: ev.new_status, updated_at: new Date().toISOString() }).ilike('reference', ref);
          await ping('tpp_transfer_update', { '1': t.reference, '2': String(ev.detail || `Status moved to ${ev.new_status}.`).replace(/\s+/g, ' ').slice(0, 280), '3': transferNext(ev.new_status) });
        }
      } else if (ev?.type === 'wro_received' && ev.po_ref) {
        const like = `%${String(ev.po_ref).trim()}%`;
        const { data: pos } = await supabaseLogistics.from('purchase_orders')
          .select('id,po_number,reference,status').or(`reference.ilike.${like},po_number.ilike.${like}`).neq('status', 'received').limit(1);
        const po = (pos ?? [])[0] as any;
        if (po) {
          await supabaseLogistics.from('purchase_orders').update({ status: 'received', wro_status: 'Received', received_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq('id', po.id);
          await ping('tpp_stock_received', { '1': ev.location || 'the fulfilment centre', '2': `${po.po_number || po.reference}${po.reference && po.po_number ? ` — ${po.reference}` : ''}`.slice(0, 280), '3': String(ev.detail || "Received — I've marked the PO as received ✓").replace(/\s+/g, ' ').slice(0, 280) });
        }
      }
    } catch { /* per-event best-effort */ }
  }
  return fired;
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
