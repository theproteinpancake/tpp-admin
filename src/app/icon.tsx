import { ImageResponse } from 'next/og';
import { smileEl } from '@/lib/smileIcon';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(smileEl(64), size);
}
