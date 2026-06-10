// Hourly wholesale PO scour: scans Kate's + Luke's inboxes for NEW customer POs,
// parses them, checks stock + existing orders/invoices, and pings Kate on WhatsApp.
// For OOS POs it also auto-drafts a reply to the stockist (swap / partial) and later
// watches the thread for their reply. Each source email is processed once
// (wholesale_po_log.email_message_id dedup).
import { supabaseLogistics } from './supabase-logistics';
import { gmailSearch, gmailGetBody, gmailGetAllAttachments, gmailGetThreadLatest, gmailCreateReplyDraft } from './google';
import { processWholesalePOMulti } from './wholesalePO';
import { getRestockPhrase } from './restock';
import { xlsxToText } from './xlsx';
import { sendWhatsApp, sendWhatsAppTemplate, waAddr, KATE_NUMBER } from './whatsapp';
import { getConfig } from './settings';
import { getTemplateSid } from './waTemplates';
import { recordProactiveContext } from './stockAgent';

const INBOXES: { acc: string | undefined; tag: string }[] = [{ acc: 'kate', tag: 'kate' }, { acc: undefined, tag: 'luke' }];
// candidate POs: order-ish subject OR an attachment, recent, not our own sends
const QUERY = 'newer_than:2d -in:sent -from:theproteinpancake.co (subject:order OR subject:"purchase order" OR subject:PO OR "purchase order" OR "please order" OR "order the following" OR "can i order" OR "like to order" OR "place an order" OR "i order" OR "can i please order" OR "can i get" OR has:attachment)';

const parseAddr = (from: string) => { const m = /<([^>]+)>/.exec(from || ''); return (m ? m[1] : (from || '')).trim(); };
const isUs = (from: string) => /theproteinpancake\.co/i.test(from || '');

// OOS reply drafts — TWO variants by MOQ (4 cartons). Greeting is a neutral time-of-day line
// (no name) — parsed customer names are too unreliable to address directly.
const MOQ_CARTONS = 4;
const greeting = () => (new Date(Date.now() + 10 * 3600_000).getUTCHours() < 12 ? 'Good morning,' : 'Good afternoon,'); // AEST
async function oosListWithEta(oos: { flavour: string }[]): Promise<string> {
  const parts: string[] = [];
  for (const o of oos) {
    const eta = await getRestockPhrase(o.flavour).catch(() => null);
    parts.push(eta ? `${o.flavour} (${eta})` : o.flavour);
  }
  return parts.join(', ');
}
// In-stock portion is UNDER MOQ → ask them: swap to in-stock flavours, or backorder the lot.
async function oosBelowMoqBody(oos: { flavour: string }[]): Promise<string> {
  const list = await oosListWithEta(oos);
  return [
    greeting(),
    '',
    `Thanks so much for your order! Unfortunately we're currently out of stock on ${list}.`,
    '',
    'Would you like to either:',
    `  1) Swap ${oos.length > 1 ? 'them' : 'it'} for another flavour that's in stock, or`,
    `  2) Have us pop your order on backorder and send it in full once ${oos.length > 1 ? "they're" : "it's"} back in stock?`,
    '',
    "Just let me know which you'd prefer and we'll get it sorted straight away.",
    '',
    'Thanks!',
    'Kate',
  ].join('\n');
}
// In-stock portion MEETS MOQ → we fulfil excluding the OOS lines and just let them know.
async function oosOverMoqBody(oos: { flavour: string }[]): Promise<string> {
  const list = await oosListWithEta(oos);
  return [
    greeting(),
    '',
    `Thanks so much for your order! Unfortunately we're currently out of stock on ${list}, so we've processed and invoiced your order excluding ${oos.length > 1 ? 'those' : 'it'} — the rest is on its way to you now.`,
    '',
    `Feel free to pop ${oos.length > 1 ? 'them' : 'it'} on your next order — happy to prioritise it once ${oos.length > 1 ? "they're" : "it's"} back in stock.`,
    '',
    'Thanks!',
    'Kate',
  ].join('\n');
}

export async function runWholesalePoScour(): Promise<{ scanned: number; new_pos: number; notified: number; reply_pings: number; error?: string }> {
  // ---------- PASS 1: new candidate emails ----------
  const { data: seenRows } = await supabaseLogistics.from('wholesale_po_log').select('email_message_id').not('email_message_id', 'is', null);
  const seen = new Set((seenRows ?? []).map((r: any) => r.email_message_id));

  const candidates: { id: string; threadId?: string; messageId?: string; inbox: string; from: string; subject: string }[] = [];
  for (const { acc, tag } of INBOXES) {
    try {
      const hits = await gmailSearch(QUERY, 12, acc);
      for (const h of hits) if (!seen.has(h.id)) candidates.push({ id: h.id, threadId: h.threadId, messageId: h.messageId, inbox: tag, from: h.from, subject: h.subject });
    } catch { /* skip inbox that errors */ }
  }

  let newPos = 0, notified = 0;
  for (const c of candidates.slice(0, 12)) {
    const account = c.inbox === 'luke' ? undefined : 'kate';
    let assessment: Awaited<ReturnType<typeof processWholesalePOMulti>> | null = null;
    try {
      const [body, atts] = await Promise.all([
        gmailGetBody(c.id, account).catch(() => ''),
        gmailGetAllAttachments(c.id, account).catch(() => []),
      ]);
      const pdfs = atts.filter((a) => /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.filename)).map((a) => ({ filename: a.filename, base64: a.base64 }));
      const csvTexts = atts.filter((a) => /csv|text\/plain/i.test(a.mimeType) || /\.(csv|tsv|txt)$/i.test(a.filename)).map((a) => `--- ${a.filename} ---\n${Buffer.from(a.base64, 'base64').toString('utf-8').slice(0, 5000)}`);
      const xlsxAtts = atts.filter((a) => /spreadsheetml|ms-excel/i.test(a.mimeType) || /\.xlsx?$/i.test(a.filename));
      const xlsxTexts = (await Promise.all(xlsxAtts.map((a) => xlsxToText(a.base64, a.filename)))).filter(Boolean);
      const text = [body, ...csvTexts, ...xlsxTexts].filter(Boolean).join('\n\n');
      if (text || pdfs.length) assessment = await processWholesalePOMulti({ text, pdfs });
    } catch { /* parse failure → treat as non-PO */ }

    const isPO = !!assessment && assessment.lines.length > 0;
    const a = assessment;
    const handled = isPO && a!.already_processed;
    const oosCase = isPO && !handled && !a!.fulfillable && a!.customer_on_file && a!.oos.length > 0;
    // MOQ rule: in-stock cartons (fully-available lines only) decide the OOS path —
    //  ≥4 → fulfil excluding the OOS lines + inform them; <4 → ask swap-or-backorder.
    const inStockCartons = isPO ? a!.lines.filter((l) => l.ok).reduce((s, l) => s + l.cartons, 0) : 0;
    const meetsMoq = inStockCartons >= MOQ_CARTONS;

    // Auto-draft the stockist reply — ALWAYS from Kate's inbox (she owns wholesale), even when
    // the PO landed in Luke's. A Gmail threadId is mailbox-specific, so cross-inbox we omit it;
    // the In-Reply-To header (global Message-ID) still threads the reply for the customer.
    let draftId: string | null = null;
    if (oosCase) {
      try {
        draftId = await gmailCreateReplyDraft({
          account: 'kate', to: parseAddr(c.from), subject: c.subject,
          threadId: c.inbox === 'kate' ? c.threadId : undefined, inReplyTo: c.messageId,
          body: meetsMoq ? await oosOverMoqBody(a!.oos) : await oosBelowMoqBody(a!.oos),
        });
      } catch { /* draft is best-effort; Kate can still action manually */ }
    }

    // record so we never re-process this email
    try {
      await supabaseLogistics.from('wholesale_po_log').insert({
        email_message_id: c.id, inbox: c.inbox, thread_id: c.threadId || null, from_email: parseAddr(c.from) || null,
        po_number: a?.po_number || null, customer_name: a?.customer_name || null, draft_id: draftId,
        status: !isPO ? 'ignored' : (handled ? 'duplicate' : (a!.fulfillable ? 'notified' : 'oos')),
        notified_at: isPO && !handled ? new Date().toISOString() : null,
      });
    } catch { /* best-effort */ }
    if (!isPO) continue;
    newPos++;
    if (handled) continue; // don't re-ping for handled POs

    // build Kate's WhatsApp ping — `action` is a single-line version for the template variable.
    const cust = a!.customer_name || 'a customer';
    const lineStr = a!.lines.map((l) => `• ${l.flavour} ×${l.cartons}`).join('\n');
    const lineInline = a!.lines.map((l) => `${l.flavour} ×${l.cartons}`).join(', ') || '—';
    let msg: string, action: string;
    if (!a!.customer_on_file) {
      action = `🆕 Not in Xero yet — add them (name, ship-to, email, ABN), then reply and I'll process it.`;
      msg = `🛒 *New PO* from ${cust}${a!.po_number ? ` (#${a!.po_number})` : ''}\n${lineStr}\n\n${action}\nShip to: ${a!.ship_to || '—'}`;
    } else if (a!.fulfillable) {
      action = `✅ Stock's good — reply "process ${cust}" and I'll create the ShipBob order + draft the Xero invoice.`;
      msg = `🛒 *New PO* from ${cust}${a!.po_number ? ` (#${a!.po_number})` : ''}\n${lineStr}\n📦 ${a!.boxes.join(' + ')} · ${a!.free_shipping ? 'free shipping' : '+$15 freight'}\n\n${action}`;
    } else if (meetsMoq) {
      // ≥4 in-stock cartons: fulfil excluding OOS, customer just gets a heads-up.
      const oos = a!.oos.map((o) => o.flavour).join(', ');
      action = `⚠️ OOS ${oos}, but ${inStockCartons} in-stock cartons meets MOQ — reply "process ${cust}" and I'll create the ShipBob order + Xero invoice EXCLUDING ${oos}.${draftId ? ` The we've-left-it-off email is drafted in your inbox — send it once processed.` : ''}`;
      msg = `🛒 *New PO* from ${cust}${a!.po_number ? ` (#${a!.po_number})` : ''}\n${lineStr}\n\n${action}`;
    } else {
      // <4 in-stock cartons: under MOQ — ask them to swap or backorder.
      const oos = a!.oos.map((o) => o.flavour).join(', ');
      action = `⚠️ OOS ${oos} leaves only ${inStockCartons} in-stock carton${inStockCartons === 1 ? '' : 's'} (under the 4-carton MOQ).${draftId ? ` I've drafted a swap-or-backorder ask in your inbox — review & send.` : ` Reply and I'll draft a swap-or-backorder ask.`}`;
      msg = `🛒 *New PO* from ${cust}${a!.po_number ? ` (#${a!.po_number})` : ''}\n${lineStr}\n\n${action}`;
    }
    // Fire via the approved template so it lands instantly even outside the 24h window;
    // fall back to the free-form message (works when Kate's window is open) until the
    // template SID is configured + approved.
    const poTemplate = process.env.TWILIO_WHOLESALE_PO_TEMPLATE_SID || (await getConfig('wholesale_po_template_sid')) || '';
    let ok = false;
    if (poTemplate) {
      ok = await sendWhatsAppTemplate(KATE_NUMBER, poTemplate, {
        '1': `${cust}${a!.po_number ? ` (#${a!.po_number})` : ''}`.slice(0, 120),
        '2': lineInline.slice(0, 600),
        '3': action.slice(0, 600),
      });
    }
    if (!ok) ok = await sendWhatsApp(KATE_NUMBER, msg);
    if (ok) {
      notified++;
      // give the agent memory of this alert so Kate's reply ("process it", "remove X and proceed") has context
      const oosNames = a!.oos.map((o) => o.flavour).join(', ');
      const state = !a!.customer_on_file ? 'Customer is NOT on file in Xero yet.'
        : a!.fulfillable ? `In stock — ready to create the ShipBob order + draft Xero invoice on confirmation. Box: ${a!.boxes.join(' + ')}, ${a!.free_shipping ? 'free shipping' : '+$15 freight'}.`
        : meetsMoq ? `OOS: ${oosNames}, but the ${inStockCartons} in-stock cartons MEET the 4-carton MOQ. If Kate says "process", process EXCLUDING ${oosNames} (pass them as exclude). A we've-left-it-off email is drafted in Kate's inbox for after processing.`
        : `OOS: ${oosNames} — in-stock portion (${inStockCartons}) is UNDER the 4-carton MOQ, so we asked the stockist to swap or backorder (draft in Kate's inbox). If Kate says they chose a swap, process with the swap; if backorder, leave it parked until restock — do not process now.`;
      const ctx = `Wholesale PO from ${cust}${a!.po_number ? ` (PO ${a!.po_number})` : ''}.\nLines: ${lineInline}.\n${state}\nShip to: ${a!.ship_to || '—'}.`;
      await recordProactiveContext(waAddr(KATE_NUMBER), ctx).catch(() => {});
    }
  }

  // ---------- PASS 2: watch OOS threads for stockist replies ----------
  let replyPings = 0;
  try {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data: waiting } = await supabaseLogistics
      .from('wholesale_po_log')
      .select('id, inbox, thread_id, customer_name, notified_at')
      .eq('status', 'oos').is('reply_notified_at', null).not('thread_id', 'is', null).gte('created_at', since);
    for (const w of (waiting ?? []) as any[]) {
      const account = w.inbox === 'luke' ? undefined : 'kate';
      const latest = await gmailGetThreadLatest(w.thread_id, account);
      if (!latest || isUs(latest.from)) continue; // newest msg is ours → no reply yet
      const after = w.notified_at ? new Date(w.notified_at).getTime() : 0;
      if (latest.internalDate <= after) continue; // not newer than our notify
      const cust = w.customer_name || 'a stockist';
      const snippet = (latest.snippet || '').replace(/\s+/g, ' ').slice(0, 280);
      const tpl = await getTemplateSid('tpp_wholesale_reply');
      let ok = false;
      if (tpl) ok = await sendWhatsAppTemplate(KATE_NUMBER, tpl, { '1': cust, '2': snippet || '(see the thread)', '3': `Reply "process ${cust}" to action the swap / send-the-rest, or tell me what they chose.` });
      if (!ok) ok = await sendWhatsApp(KATE_NUMBER, `↩️ *${cust} replied* about their OOS order:\n"${snippet}"\n\nReply "*process ${cust}*" or tell me what they chose.`);
      if (ok) {
        replyPings++;
        await supabaseLogistics.from('wholesale_po_log').update({ reply_notified_at: new Date().toISOString() }).eq('id', w.id);
        await recordProactiveContext(waAddr(KATE_NUMBER), `${cust} replied about their out-of-stock order with: "${snippet}". Awaiting Kate's instruction to process the swap / send-the-rest for ${cust}.`).catch(() => {});
      }
    }
  } catch { /* reply-watch is best-effort */ }

  return { scanned: candidates.length, new_pos: newPos, notified, reply_pings: replyPings };
}
