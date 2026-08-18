import { NextRequest } from 'next/server';
import { getWROLabels } from '@/lib/shipbob';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Serves a WRO's pallet-labels PDF at a public URL so Twilio can attach it to a WhatsApp
// message (same pattern as po-image and the transfer docs: /api/whatsapp/* is public because
// Twilio must fetch media unauthenticated). ShipBob is briefly read-after-write laggy on a
// fresh WRO, so a couple of short retries cover the create → send window.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wroId = Number(id);
  if (!Number.isInteger(wroId) || wroId <= 0) return new Response('bad id', { status: 400 });
  const site = new URL(_req.url).searchParams.get('site') === 'MANCHESTER' ? 'MANCHESTER' : 'ALTONA';

  let b64: string | null = null;
  for (let attempt = 0; attempt < 3 && !b64; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 4000));
    b64 = await getWROLabels(site, wroId).catch(() => null);
  }
  if (!b64) return new Response('labels not available yet', { status: 404 });
  return new Response(new Uint8Array(Buffer.from(b64, 'base64')), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="WRO-${wroId}-pallet-labels.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
