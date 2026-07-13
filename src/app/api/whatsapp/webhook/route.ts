import { NextRequest } from 'next/server';
import { after } from 'next/server';
import { askStockAgent, type AgentImage, type AgentDoc } from '@/lib/stockAgent';
import { isAllowed, sendWhatsApp, fetchTwilioMedia, fetchTwilioMessageBody, fetchTwilioPdf } from '@/lib/whatsapp';
import { supabaseLogistics } from '@/lib/supabase-logistics';

export const maxDuration = 180; // debounce window + agent + docket parse

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
const reply = (msg?: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${xml(msg)}</Message>` : ''}</Response>`,
    { headers: { 'Content-Type': 'text/xml' } });
const empty = () => reply();

// WhatsApp delivers a multi-image message (and often image + caption) as SEPARATE Twilio
// webhooks. One agent run per webhook meant one USER message → several replies, the later ones
// missing the caption/context ("random second reply" bug — hit both Luke and Kate). So: every
// piece parks in wa_inbound_buffer; after this window the LATEST arrival processes the whole
// batch as one message. Text-only messages with no pending siblings skip the wait entirely.
const DEBOUNCE_MS = 8_000;

// Twilio inbound WhatsApp webhook. Twilio drops the reply if we don't respond in
// ~15s, so we ACK immediately and do the (slower) agent work + send via REST after().
export async function POST(req: NextRequest) {
  let from = '', body = '', repliedSid = '';
  const mediaUrls: string[] = [];
  const pdfUrls: string[] = [];
  try {
    const form = await req.formData();
    from = String(form.get('From') || '');
    body = String(form.get('Body') || '').trim();
    repliedSid = String(form.get('OriginalRepliedMessageSid') || ''); // set when the user quotes/replies
    const n = Number(form.get('NumMedia') || 0);
    for (let i = 0; i < n; i++) {
      const url = String(form.get(`MediaUrl${i}`) || '');
      const type = String(form.get(`MediaContentType${i}`) || '');
      if (url && type.startsWith('image/')) mediaUrls.push(url);
      else if (url && /pdf/i.test(type)) pdfUrls.push(url); // invoices, dockets, packing slips
    }
  } catch {
    return empty();
  }

  if (!isAllowed(from) || (!body && mediaUrls.length === 0 && pdfUrls.length === 0)) return empty();

  // Park this piece in the buffer before ACKing, so a sibling webhook can see it immediately.
  let myId: string | null = null;
  let myCreated: string | null = null;
  try {
    const { data } = await supabaseLogistics.from('wa_inbound_buffer').insert({
      phone: from, body: body || null, media_urls: mediaUrls, pdf_urls: pdfUrls, replied_sid: repliedSid || null,
    }).select('id, created_at').single();
    myId = (data as any)?.id ?? null;
    myCreated = (data as any)?.created_at ?? null;
  } catch { /* buffer down → fall back to processing this piece alone */ }

  after(async () => {
    try {
      let batch: { body: string | null; media_urls: string[]; pdf_urls: string[]; replied_sid: string | null }[] = [
        { body, media_urls: mediaUrls, pdf_urls: pdfUrls, replied_sid: repliedSid || null },
      ];

      if (myId && myCreated) {
        // Text-only with nothing else pending → answer immediately (no latency tax on normal chat).
        let wait = mediaUrls.length > 0 || pdfUrls.length > 0;
        if (!wait) {
          const { count } = await supabaseLogistics.from('wa_inbound_buffer')
            .select('id', { count: 'exact', head: true })
            .eq('phone', from).eq('processed', false).neq('id', myId);
          wait = (count ?? 0) > 0;
        }
        if (wait) await new Promise((r) => setTimeout(r, DEBOUNCE_MS));

        // If a NEWER piece arrived while we slept, it owns the batch (its own window covers us).
        const { data: newer } = await supabaseLogistics.from('wa_inbound_buffer')
          .select('id').eq('phone', from).eq('processed', false).gt('created_at', myCreated).limit(1);
        if ((newer ?? []).length) return;

        // Atomic claim: whoever flips processed=false rows wins; a racing sibling gets zero rows.
        const { data: claimed } = await supabaseLogistics.from('wa_inbound_buffer')
          .update({ processed: true })
          .eq('phone', from).eq('processed', false)
          .select('body, media_urls, pdf_urls, replied_sid, created_at');
        if (!claimed?.length) return; // someone else claimed the batch (incl. our piece)
        batch = (claimed as any[]).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        // opportunistic prune — the buffer is only for the debounce window
        await supabaseLogistics.from('wa_inbound_buffer').delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString()).then(() => {}, () => {});
      }

      const mergedBody = batch.map((p) => (p.body || '').trim()).filter(Boolean).join('\n');
      const allMedia = batch.flatMap((p) => (p.media_urls as string[]) || []);
      const allPdfs = batch.flatMap((p) => (p.pdf_urls as string[]) || []);
      const quotedSid = batch.map((p) => p.replied_sid).find(Boolean) || '';

      // fetch any attached screenshots (vision) + PDFs (invoices/dockets) so the agent reads them
      const images: AgentImage[] = [];
      let skippedImages = Math.max(0, allMedia.length - 4); // beyond the 4-image cap
      for (const url of allMedia.slice(0, 4)) {
        const m = await fetchTwilioMedia(url);
        if (m) images.push(m);
        else skippedImages++; // over the vision size limit or unsupported format
      }
      const docs: AgentDoc[] = [];
      for (const url of allPdfs.slice(0, 3)) {
        const d = await fetchTwilioPdf(url);
        if (d) docs.push({ base64: d.base64, filename: 'attachment.pdf' });
      }
      const quoted = quotedSid ? await fetchTwilioMessageBody(quotedSid).catch(() => null) : null;
      // A dropped image must be VISIBLE to the model — silently ignoring it reads to the user
      // as "the agent ignored my screenshot" (it can't act on what it never saw).
      const agentBody = skippedImages
        ? `${mergedBody ? mergedBody + '\n\n' : ''}[system note: ${skippedImages} attached image${skippedImages > 1 ? 's' : ''} could NOT be read (too large or unsupported format). Tell the user which image(s) you did read, and ask them to re-send the rest as smaller screenshots.]`
        : mergedBody;
      const answer = await askStockAgent(agentBody, from, images.length ? images : undefined, quoted || undefined, docs.length ? docs : undefined);
      // media is a LIST (e.g. two PO previews drafted in one run) — text rides with the first,
      // the rest follow as their own messages so nothing is silently dropped.
      const [firstMedia, ...restMedia] = answer.media ?? [];
      await sendWhatsApp(from, answer.text, firstMedia);
      for (const m of restMedia) await sendWhatsApp(from, '📎', m);
    } catch (e) {
      console.error('whatsapp agent error', e);
      const raw = String((e as any)?.message || e);
      let msg = '⚠️ Hit a snag on that one — give it another go in a moment. (Luke\'s been pinged if it persists.)';
      if (/credit balance|Plans & Billing|insufficient.*quota/i.test(raw)) msg = '⚠️ The assistant\'s AI credits have run out — Luke needs to top up the Anthropic account. Back to normal as soon as that\'s sorted! 🙏';
      else if (/overloaded|rate.?limit|429|529/i.test(raw)) msg = '⚠️ The AI is a bit overloaded right now — try again in a minute. 🙏';
      else if (/gmail|google/i.test(raw)) msg = '⚠️ Couldn\'t reach the inbox just now — try again shortly (Gmail may need reconnecting in Settings).';
      await sendWhatsApp(from, msg).catch(() => {});
    }
  });

  // The full reply is sent from the async task above; no interim ack (Kate found "brb 👀" noisy).
  return empty();
}
