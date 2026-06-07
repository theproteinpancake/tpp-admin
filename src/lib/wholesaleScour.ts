// Hourly wholesale PO scour: scans Kate's + Luke's inboxes for NEW customer POs,
// parses them, checks stock + existing orders/invoices, and pings Kate on WhatsApp.
// Each source email is processed once (wholesale_po_log.email_message_id dedup).
import { supabaseLogistics } from './supabase-logistics';
import { gmailSearch, gmailGetBody, gmailGetAllAttachments } from './google';
import { processWholesalePOMulti } from './wholesalePO';
import { sendWhatsApp, KATE_NUMBER } from './whatsapp';

const INBOXES: { acc: string | undefined; tag: string }[] = [{ acc: 'kate', tag: 'kate' }, { acc: undefined, tag: 'luke' }];
// candidate POs: order-ish subject OR an attachment, recent, not our own sends
const QUERY = 'newer_than:2d -in:sent -from:theproteinpancake.co (subject:order OR subject:"purchase order" OR subject:PO OR "purchase order" OR "please order" OR has:attachment)';

export async function runWholesalePoScour(): Promise<{ scanned: number; new_pos: number; notified: number; error?: string }> {
  // already-seen email ids
  const { data: seenRows } = await supabaseLogistics.from('wholesale_po_log').select('email_message_id').not('email_message_id', 'is', null);
  const seen = new Set((seenRows ?? []).map((r: any) => r.email_message_id));

  // gather candidates from both inboxes
  const candidates: { id: string; inbox: string; from: string; subject: string }[] = [];
  for (const { acc, tag } of INBOXES) {
    try {
      const hits = await gmailSearch(QUERY, 12, acc);
      for (const h of hits) if (!seen.has(h.id)) candidates.push({ id: h.id, inbox: tag, from: h.from, subject: h.subject });
    } catch { /* skip inbox that errors */ }
  }
  if (!candidates.length) return { scanned: 0, new_pos: 0, notified: 0 };

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
      const csvTexts = atts.filter((a) => /csv|excel|spreadsheet/i.test(a.mimeType) || /\.(csv|tsv|txt)$/i.test(a.filename)).map((a) => `--- ${a.filename} ---\n${Buffer.from(a.base64, 'base64').toString('utf-8').slice(0, 5000)}`);
      const text = [body, ...csvTexts].filter(Boolean).join('\n\n');
      if (text || pdfs.length) assessment = await processWholesalePOMulti({ text, pdfs });
    } catch { /* parse failure → treat as non-PO */ }

    const isPO = !!assessment && assessment.lines.length > 0;
    // record so we never re-process this email
    try {
      await supabaseLogistics.from('wholesale_po_log').insert({
        email_message_id: c.id, inbox: c.inbox, po_number: assessment?.po_number || null,
        customer_name: assessment?.customer_name || null,
        status: !isPO ? 'ignored' : (assessment!.already_processed ? 'duplicate' : (assessment!.fulfillable ? 'notified' : 'oos')),
        notified_at: isPO && !assessment!.already_processed ? new Date().toISOString() : null,
      });
    } catch { /* best-effort */ }
    if (!isPO) continue;
    newPos++;
    if (assessment!.already_processed) continue; // don't re-ping for handled POs

    // build Kate's WhatsApp ping
    const a = assessment!;
    const cust = a.customer_name || 'a customer';
    const lineStr = a.lines.map((l) => `• ${l.flavour} ×${l.cartons}`).join('\n');
    let msg: string;
    if (!a.customer_on_file) {
      msg = `🛒 *New PO* from ${cust}${a.po_number ? ` (#${a.po_number})` : ''}\n${lineStr}\n\n🆕 They're NOT on file in Xero yet — add them first (name, ship-to, email, ABN), then reply and I'll process it.\nShip to: ${a.ship_to || '—'}`;
    } else if (a.fulfillable) {
      msg = `🛒 *New PO* from ${cust}${a.po_number ? ` (#${a.po_number})` : ''}\n${lineStr}\n📦 ${a.boxes.join(' + ')} · ${a.free_shipping ? 'free shipping' : '+$15 freight'}\n\n✅ Stock's good. Reply "*process ${cust}*" and I'll create the ShipBob order + draft the Xero invoice.`;
    } else {
      const oos = a.oos.map((o) => o.flavour).join(', ');
      msg = `🛒 *New PO* from ${cust}${a.po_number ? ` (#${a.po_number})` : ''}\n${lineStr}\n\n⚠️ We're *OOS ${oos}*. Want me to draft a reply asking them to swap the flavour or send the rest without it? Reply and I'll sort it (I can note when stock's due too).`;
    }
    const ok = await sendWhatsApp(KATE_NUMBER, msg);
    if (ok) notified++;
  }
  return { scanned: candidates.length, new_pos: newPos, notified };
}
