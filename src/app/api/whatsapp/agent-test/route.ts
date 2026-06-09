import { NextRequest, NextResponse } from 'next/server';
import { askStockAgent } from '@/lib/stockAgent';

export const maxDuration = 120;

// Cron-secret-guarded harness to ask the owner agent a question WITHOUT sending WhatsApp or
// touching anyone's conversation history (no phone passed). For testing tool wiring/answers.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const given = req.headers.get('x-cron-secret') || url.searchParams.get('secret');
  if (secret && given !== secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const q = url.searchParams.get('q') || '';
  if (!q) return NextResponse.json({ error: 'pass ?q=' }, { status: 400 });
  const res = await askStockAgent(q);
  return NextResponse.json({ ok: true, q, answer: res.text });
}

export const GET = handle;
export const POST = handle;
