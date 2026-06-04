import { NextRequest } from 'next/server';
import { askStockAgent } from '@/lib/stockAgent';
import { isAllowed, sendWhatsApp } from '@/lib/whatsapp';

export const maxDuration = 30;

// escape for TwiML XML
const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
const twiml = (msg?: string, media?: string) => {
  const body = msg || media
    ? `<Message>${msg ? `<Body>${xml(msg)}</Body>` : ''}${media ? `<Media>${xml(media)}</Media>` : ''}</Message>`
    : '';
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    { headers: { 'Content-Type': 'text/xml' } });
};

// Twilio inbound WhatsApp webhook.
export async function POST(req: NextRequest) {
  let from = '', body = '';
  try {
    const form = await req.formData();
    from = String(form.get('From') || '');
    body = String(form.get('Body') || '').trim();
  } catch {
    return twiml();
  }

  if (!isAllowed(from)) {
    return twiml('Sorry, this assistant is private.');
  }
  if (!body) return twiml('Send me a question about stock, e.g. “what’s low at Altona?”');

  try {
    const answer = await askStockAgent(body);
    return twiml(answer.text, answer.media);
  } catch (e) {
    console.error('whatsapp agent error', e);
    // best-effort async fallback so the user gets *something*
    await sendWhatsApp(from, 'Hit an error answering that — try again in a moment.').catch(() => {});
    return twiml();
  }
}
