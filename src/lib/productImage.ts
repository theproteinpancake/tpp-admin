// Map a flavour name → its product render in /public/products (for aesthetic thumbnails).
// GF variants use their own render where we have one, else fall back to the base flavour.
const FILES: Record<string, string> = {
  buttermilk: 'buttermilk.webp',
  saltedcaramel: 'saltedcaramel.webp',
  chocolate: 'chocolate.webp',
  cookiescream: 'cookesandcream.webp',
  maple: 'maple.png',
  cinnamonchurro: 'cinnamonchurro.webp',
  gfbuttermilk: 'gfbuttermilk.webp',
  gfcinnamonchurro: 'gfcininamonchurro.webp',
};

const norm = (s: string) => s.toLowerCase().replace(/&/g, '').replace(/[^a-z]/g, '');

export function productImage(flavour: string | null | undefined): string | null {
  if (!flavour) return null;
  const isGF = /\bgf\b|gluten/i.test(flavour);
  const base = norm(flavour.replace(/^gf\s+/i, '').replace(/gluten\s*free/i, ''));
  // canonicalise a few spellings
  const key = base.includes('cookie') ? 'cookiescream'
    : base.includes('cinnamon') ? 'cinnamonchurro'
    : base.includes('buttermilk') ? 'buttermilk'
    : base.includes('saltedcaramel') || base === 'caramel' ? 'saltedcaramel'
    : base.includes('chocolate') ? 'chocolate'
    : base.includes('maple') && !base.includes('bacon') ? 'maple'
    : base;
  if (isGF && key === 'buttermilk' && FILES.gfbuttermilk) return `/products/${FILES.gfbuttermilk}`;
  if (isGF && key === 'cinnamonchurro' && FILES.gfcinnamonchurro) return `/products/${FILES.gfcinnamonchurro}`;
  return FILES[key] ? `/products/${FILES[key]}` : null;
}
