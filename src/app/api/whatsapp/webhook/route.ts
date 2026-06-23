import { NextRequest } from 'next/server';
import { after } from 'next/server';
import { askStockAgent, type AgentImage, type AgentDoc } from '@/lib/stockAgent';
import { isAllowed, sendWhatsApp, fetchTwilioMedia, fetchTwilioMessageBody, fetchTwilioPdf } from '@/lib/whatsapp';

export const maxDuration = 120; // agent + docket parse can take ~30s

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
const reply = (msg?: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${xml(msg)}</Message>` : ''}</Response>`,
    { headers: { 'Content-Type': 'text/xml' } });
const empty = () => reply();

// Only the genuinely heavy tasks (PDF parse/generate, Xero/ShipBob writes) get a "brb".
// Fast read queries (stock, expiry, billing, forecast) just return the answer in <30s.
const SLOW = /docket|packing|slip|\bwro\b|transfer|\bdocs?\b|draft|approve|received|delivered|landed|mark|carton|wholesale|\bpo\b|order|invoice|^(yes|yep|send|confirm|do it|go ahead)\b/i;

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

  after(async () => {
    try {
      // fetch any attached screenshots (vision) + PDFs (invoices/dockets) so the agent reads them
      const images: AgentImage[] = [];
      for (const url of mediaUrls.slice(0, 4)) {
        const m = await fetchTwilioMedia(url);
        if (m) images.push(m);
      }
      const docs: AgentDoc[] = [];
      for (const url of pdfUrls.slice(0, 3)) {
        const d = await fetchTwilioPdf(url);
        if (d) docs.push({ base64: d.base64, filename: 'attachment.pdf' });
      }
      const quoted = repliedSid ? await fetchTwilioMessageBody(repliedSid).catch(() => null) : null;
      const answer = await askStockAgent(body, from, images.length ? images : undefined, quoted || undefined, docs.length ? docs : undefined);
      await sendWhatsApp(from, answer.text, answer.media);
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
