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
  let q = url.searchParams.get('q') || '';
  let pdfB64 = '';
  if (req.method === 'POST') {
    const b = await req.json().catch(() => ({} as any));
    q = b.q || q;
    pdfB64 = b.pdf_base64 || '';
  }
  if (!q && !pdfB64) return NextResponse.json({ error: 'pass ?q= (or POST {q, pdf_base64})' }, { status: 400 });
  const docs = pdfB64 ? [{ base64: pdfB64, filename: 'attachment.pdf' }] : undefined;
  const res = await askStockAgent(q, undefined, undefined, undefined, docs);
  return NextResponse.json({ ok: true, q, answer: res.text });
}

export const GET = handle;
export const POST = handle;
