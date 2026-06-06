import { NextRequest } from 'next/server';
import { after } from 'next/server';
import { askStockAgent, type AgentImage } from '@/lib/stockAgent';
import { isAllowed, sendWhatsApp, fetchTwilioMedia } from '@/lib/whatsapp';

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
  let from = '', body = '';
  const mediaUrls: string[] = [];
  try {
    const form = await req.formData();
    from = String(form.get('From') || '');
    body = String(form.get('Body') || '').trim();
    const n = Number(form.get('NumMedia') || 0);
    for (let i = 0; i < n; i++) {
      const url = String(form.get(`MediaUrl${i}`) || '');
      const type = String(form.get(`MediaContentType${i}`) || '');
      if (url && type.startsWith('image/')) mediaUrls.push(url);
    }
  } catch {
    return empty();
  }

  if (!isAllowed(from) || (!body && mediaUrls.length === 0)) return empty();

  after(async () => {
    try {
      // fetch any attached screenshots for the agent's vision
      const images: AgentImage[] = [];
      for (const url of mediaUrls.slice(0, 4)) {
        const m = await fetchTwilioMedia(url);
        if (m) images.push(m);
      }
      const answer = await askStockAgent(body, from, images.length ? images : undefined);
      await sendWhatsApp(from, answer.text, answer.media);
    } catch (e) {
      console.error('whatsapp agent error', e);
      await sendWhatsApp(from, `⚠️ Hit a snag: ${String((e as any)?.message || e).slice(0, 200)}`).catch(() => {});
    }
  });

  // Images (vision + possible order) and heavy tasks get a quick ack; fast reads don't.
  return (mediaUrls.length > 0 || SLOW.test(body)) ? reply('brb 👀') : empty();
}
