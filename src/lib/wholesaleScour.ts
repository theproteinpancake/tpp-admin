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
import { sendWhatsApp, KATE_NUMBER } from './whatsapp';

const INBOXES: { acc: string | undefined; tag: string }[] = [{ acc: 'kate', tag: 'kate' }, { acc: undefined, tag: 'luke' }];
// candidate POs: order-ish subject OR an attachment, recent, not our own sends
const QUERY = 'newer_than:2d -in:sent -from:theproteinpancake.co (subject:order OR subject:"purchase order" OR subject:PO OR "purchase order" OR "please order" OR has:attachment)';

const parseAddr = (from: string) => { const m = /<([^>]+)>/.exec(from || ''); return (m ? m[1] : (from || '')).trim(); };
const isUs = (from: string) => /theproteinpancake\.co/i.test(from || '');

// Build the OOS reply-draft body (swap / partial), folding in any restock ETA.
async function oosDraftBody(custName: string | null, oos: { flavour: string }[]): Promise<string> {
  const parts: string[] = [];
  for (const o of oos) {
    const eta = await getRestockPhrase(o.flavour).catch(() => null);
    parts.push(eta ? `${o.flavour} (${eta})` : o.flavour);
  }
  const list = parts.join(', ');
  const hi = custName ? `Hi ${custName.split(/\s|,/)[0]},` : 'Hi there,';
  return [
    hi,
    '',
    `Thanks so much for your order! Unfortunately we're currently out of stock on ${list}.`,
    '',
    'Would you like to either:',
    `  1) Swap ${oos.length > 1 ? 'them' : 'it'} for another flavour, or`,
    `  2) Have us send the rest of your order now and follow up with the ${oos.length > 1 ? 'remaining flavours' : list.replace(/\s*\([^)]*\)/, '')} once back in stock?`,
    '',
    "Just let me know which you'd prefer and we'll get it sorted straight away.",
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

    // For an OOS PO we auto-draft the stockist reply (in the inbox the PO landed in).
    let draftId: string | null = null;
    if (oosCase) {
      try {
        draftId = await gmailCreateReplyDraft({
          account, to: parseAddr(c.from), subject: c.subject, threadId: c.threadId, inReplyTo: c.messageId,
          body: await oosDraftBody(a!.customer_name, a!.oos),
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

    // build Kate's WhatsApp ping
    const cust = a!.customer_name || 'a customer';
    const lineStr = a!.lines.map((l) => `• ${l.flavour} ×${l.cartons}`).join('\n');
    let msg: string;
    if (!a!.customer_on_file) {
      msg = `🛒 *New PO* from ${cust}${a!.po_number ? ` (#${a!.po_number})` : ''}\n${lineStr}\n\n🆕 They're NOT on file in Xero yet — add them first (name, ship-to, email, ABN), then reply and I'll process it.\nShip to: ${a!.ship_to || '—'}`;
    } else if (a!.fulfillable) {
      msg = `🛒 *New PO* from ${cust}${a!.po_number ? ` (#${a!.po_number})` : ''}\n${lineStr}\n📦 ${a!.boxes.join(' + ')} · ${a!.free_shipping ? 'free shipping' : '+$15 freight'}\n\n✅ Stock's good. Reply "*process ${cust}*" and I'll create the ShipBob order + draft the Xero invoice.`;
    } else {
      const oos = a!.oos.map((o) => o.flavour).join(', ');
      const draftLine = draftId
        ? `\n\n✍️ I've *drafted a reply* to them in your inbox (swap or send-the-rest) — review & send, or reply here and I'll tweak it.`
        : `\n\nReply and I'll draft a note asking them to swap or send the rest without it.`;
      msg = `🛒 *New PO* from ${cust}${a!.po_number ? ` (#${a!.po_number})` : ''}\n${lineStr}\n\n⚠️ We're *OOS ${oos}*.${draftLine}`;
    }
    const ok = await sendWhatsApp(KATE_NUMBER, msg);
    if (ok) notified++;
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
      const ok = await sendWhatsApp(KATE_NUMBER, `↩️ *${cust} replied* about their OOS order:\n"${(latest.snippet || '').slice(0, 200)}"\n\nWant me to process the swap / send the rest? Reply "*process ${cust}*" or tell me what they chose.`);
      if (ok) { replyPings++; await supabaseLogistics.from('wholesale_po_log').update({ reply_notified_at: new Date().toISOString() }).eq('id', w.id); }
    }
  } catch { /* reply-watch is best-effort */ }

  return { scanned: candidates.length, new_pos: newPos, notified, reply_pings: replyPings };
}
