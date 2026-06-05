import { NextRequest, NextResponse } from 'next/server';
import { askStockAgent } from '@/lib/stockAgent';

export const maxDuration = 120;

// In-dashboard assistant — same agent brain as WhatsApp, no Twilio. Auth-gated by middleware.
export async function POST(req: NextRequest) {
  let message = '';
  try { ({ message } = await req.json()); } catch { /* ignore */ }
  if (!message || !message.trim()) return NextResponse.json({ text: 'Ask me anything about stock, POs, transfers, expiry, shipping or billing.' });
  try {
    const answer = await askStockAgent(message.trim(), 'web-dashboard');
    return NextResponse.json({ text: answer.text, media: answer.media ?? null });
  } catch (e) {
    return NextResponse.json({ text: '⚠️ Hit an error on that one — try again.', error: String(e).slice(0, 200) }, { status: 200 });
  }
}
