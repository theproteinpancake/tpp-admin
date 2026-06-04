import { NextRequest } from 'next/server';
import { after } from 'next/server';
import { askStockAgent } from '@/lib/stockAgent';
import { isAllowed, sendWhatsApp } from '@/lib/whatsapp';

export const maxDuration = 120; // agent + docket parse can take ~30s

const empty = () =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });

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
      const answer = await askStockAgent(body);
      await sendWhatsApp(from, answer.text, answer.media);
    } catch (e) {
      console.error('whatsapp agent error', e);
      await sendWhatsApp(from, '⚠️ Hit an error on that one — try again in a moment.').catch(() => {});
    }
  });

  return empty();
}
