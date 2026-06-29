import { NextRequest } from 'next/server';
import { getTransfer } from '@/lib/transfers';
import { TRANSFER_DOCS, type TransferDocKey } from '@/lib/transferPdf';
import { getWROLabels } from '@/lib/shipbob';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Public so the dashboard can link/download and Twilio can fetch as WhatsApp media.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ reference: string; doc: string }> }) {
  const { reference, doc } = await params;

  // The Manchester WRO label (fetched live from ShipBob via the stored WRO id) — to attach to the AU order.
  if (doc === 'wro-label') {
    const transfer = await getTransfer(reference);
    if (!transfer?.shipbob_wro_id) return new Response('No WRO created for this transfer yet', { status: 404 });
    const b64 = await getWROLabels('MANCHESTER', Number(transfer.shipbob_wro_id)).catch(() => null);
    if (!b64) return new Response('WRO label not available yet', { status: 404 });
    return new Response(new Uint8Array(Buffer.from(b64, 'base64')), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="WRO-${transfer.shipbob_wro_id}-label_${reference}.pdf"`, 'Cache-Control': 'no-store' },
    });
  }

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
