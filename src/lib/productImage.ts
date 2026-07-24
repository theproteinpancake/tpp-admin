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
  // gear + syrup (matched by product NAME — these have no flavour)
  syrup: 'syrup.png',
  flipper: 'flipper.png',
  scraper: 'scraper.png',
  pancakepan: 'pancakepan.png',
  wafflemaker: 'wafflemaker.png',
};

const norm = (s: string) => s.toLowerCase().replace(/&/g, '').replace(/[^a-z]/g, '');

export function productImage(flavour: string | null | undefined): string | null {
  if (!flavour) return null;
  const isGF = /\bgf\b|gluten/i.test(flavour);
  const base = norm(flavour.replace(/^gf\s+/i, '').replace(/gluten\s*free/i, ''));
  // canonicalise a few spellings
  // syrup/gear names first — "Sugar Free Maple Syrup" must not fall into the 'maple' flavour
  const key = base.includes('syrup') ? 'syrup'
    : base.includes('waffle') ? 'wafflemaker'
    : base.includes('flipper') ? 'flipper'
    : base.includes('scraper') ? 'scraper'
    : base.includes('pancakepan') ? 'pancakepan'
    : base.includes('cookie') ? 'cookiescream'
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
