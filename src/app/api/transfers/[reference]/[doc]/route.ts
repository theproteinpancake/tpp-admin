import { NextRequest } from 'next/server';
import { getTransfer } from '@/lib/transfers';
import { TRANSFER_DOCS, type TransferDocKey } from '@/lib/transferPdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Public so the dashboard can link/download and Twilio can fetch as WhatsApp media.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ reference: string; doc: string }> }) {
  const { reference, doc } = await params;
  const spec = TRANSFER_DOCS[doc as TransferDocKey];
  if (!spec) return new Response('Unknown document', { status: 404 });

  const transfer = await getTransfer(reference);
  if (!transfer) return new Response('Transfer not found', { status: 404 });

  const pdf = await spec.render(transfer);
  const filename = `${spec.label.replace(/\s+/g, '_')}_${reference}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
