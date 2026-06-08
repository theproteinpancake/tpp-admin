import { ImageResponse } from 'next/og';
import { smileEl } from '@/lib/smileIcon';

// PWA manifest icons (e.g. /icons/192, /icons/512).
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const s = Math.min(1024, Math.max(16, Number(size) || 192));
  return new ImageResponse(smileEl(s), { width: s, height: s });
}
