// TPP brand flavour colours (from Pantone spec). GF variants share the base colour.
export const FLAVOUR_COLOR: Record<string, string> = {
  'Buttermilk': '#7EAFD3',          // Buttermilk Blue
  'Salted Caramel': '#bd6930',      // Caramel
  'Chocolate': '#692e00',           // Chocolate
  'Cookies & Cream': '#211b25',     // Dark Cookie
  'Maple': '#fbb033',               // Light Orange
  'Maple Bacon': '#DB5B42',
  'Cinnamon Churro': '#9D442B',     // Dark Brown
};

const DEFAULT = '#C4814A'; // caramel fallback (syrup, accessories)

export function flavourColor(flavour: string | null | undefined): string {
  if (!flavour) return DEFAULT;
  const base = flavour.replace(/^GF\s+/i, '').trim(); // GF Buttermilk -> Buttermilk
  return FLAVOUR_COLOR[base] ?? DEFAULT;
}
