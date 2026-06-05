import { NextRequest } from 'next/server';
import { after } from 'next/server';
import { askStockAgent } from '@/lib/stockAgent';
import { isAllowed, sendWhatsApp } from '@/lib/whatsapp';

export const maxDuration = 120; // agent + docket parse can take ~30s

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
const reply = (msg?: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${xml(msg)}</Message>` : ''}</Response>`,
    { headers: { 'Content-Type': 'text/xml' } });
const empty = () => reply();

// Only the genuinely heavy tasks (PDF parse/generate, Xero/ShipBob writes) get a "brb".
// Fast read queries (stock, expiry, billing, forecast) just return the answer in <30s.
const SLOW = /docket|packing|slip|\bwro\b|transfer|\bdocs?\b|draft|approve|received|delivered|landed|mark|^(yes|yep|send|confirm|do it|go ahead)\b/i;

// Twilio inbound WhatsApp webhook. Twilio drops the reply if we don't respond in
// ~15s, so we ACK immediately and do the (slower) agent work + send via REST after().
export async function POST(req: NextRequest) {
  let from = '', body = '';
  try {
    const form = await req.formData();
    from = String(form.get('From') || '');
    body = String(form.get('Body') || '').trim();
  } catch {
    return empty();
  }

  if (!isAllowed(from) || !body) return empty();

  after(async () => {
    try {
      const answer = await askStockAgent(body, from);
      await sendWhatsApp(from, answer.text, answer.media);
    } catch (e) {
      console.error('whatsapp agent error', e);
      await sendWhatsApp(from, '⚠️ Hit an error on that one — try again in a moment.').catch(() => {});
    }
  });

  // Most replies land in <30s (no ack needed). Only the genuinely heavy tasks
  // (docket/WRO/PO draft/transfer/doc-gen) get a quick witty ack.
  return SLOW.test(body) ? reply('brb 👀') : empty();
}
