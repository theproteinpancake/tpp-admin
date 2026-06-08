import { productImage } from '@/lib/productImage';
import { flavourColor } from '@/lib/flavours';

// Small product render for a flavour. Falls back to a coloured chip when we have no image.
export default function ProductThumb({ flavour, size = 40, className = '' }: { flavour: string | null | undefined; size?: number; className?: string }) {
  const src = productImage(flavour);
  if (!src) {
    return <span className={`inline-block shrink-0 rounded-md ${className}`} style={{ width: size, height: size, background: flavourColor(flavour) }} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={flavour || 'product'} width={size} height={size}
      className={`shrink-0 rounded-md object-contain ${className}`} style={{ width: size, height: size }} />
  );
}
