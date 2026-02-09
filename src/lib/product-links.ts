/**
 * TPP Product Internal Linking
 * Maps product names/keywords to their Shopify PDP URLs for internal linking in blog posts.
 * Used to auto-link ingredient mentions in blog post HTML.
 */

const STORE_URL = 'https://theproteinpancake.com.au';

interface ProductLink {
  keywords: string[];  // Terms to match in ingredient text
  url: string;         // Full product URL
  displayName: string; // How to display the link text
}

const TPP_PRODUCT_LINKS: ProductLink[] = [
  {
    keywords: ['buttermilk pancake mix', 'buttermilk mix', 'buttermilk pancakes mix', 'tpp buttermilk'],
    url: `${STORE_URL}/products/buttermilk-protein-pancake-mix`,
    displayName: 'Buttermilk Protein Pancake Mix',
  },
  {
    keywords: ['cookies & cream mix', 'cookies and cream mix', 'cookies cream mix', 'cookies & cream pancake mix'],
    url: `${STORE_URL}/products/cookies-cream-protein-pancake-mix`,
    displayName: 'Cookies & Cream Protein Pancake Mix',
  },
  {
    keywords: ['chocolate pancake mix', 'chocolate mix', 'tpp chocolate'],
    url: `${STORE_URL}/products/chocolate-protein-pancake-mix`,
    displayName: 'Chocolate Protein Pancake Mix',
  },
  {
    keywords: ['cinnamon churro mix', 'churro mix', 'cinnamon churro pancake mix'],
    url: `${STORE_URL}/products/cinnamon-churro-protein-pancake-mix`,
    displayName: 'Cinnamon Churro Protein Pancake Mix',
  },
  {
    keywords: ['salted caramel mix', 'caramel mix', 'salted caramel pancake mix'],
    url: `${STORE_URL}/products/salted-caramel-protein-pancake-mix`,
    displayName: 'Salted Caramel Protein Pancake Mix',
  },
  {
    keywords: ['maple pancake mix', 'maple mix', 'tpp maple'],
    url: `${STORE_URL}/products/maple-protein-pancake-mix`,
    displayName: 'Maple Protein Pancake Mix',
  },
  {
    keywords: ['gluten free buttermilk', 'gf buttermilk', 'gluten free mix'],
    url: `${STORE_URL}/products/gluten-free-buttermilk-protein-pancake-mix`,
    displayName: 'Gluten Free Buttermilk Protein Pancake Mix',
  },
  {
    keywords: ['gluten free cinnamon churro', 'gf cinnamon churro', 'gf churro'],
    url: `${STORE_URL}/products/gluten-free-cinnamon-churro-protein-pancake-mix`,
    displayName: 'Gluten Free Cinnamon Churro Protein Pancake Mix',
  },
  {
    keywords: ['sugar free maple syrup', 'maple syrup', 'tpp syrup', 'sugar free syrup'],
    url: `${STORE_URL}/products/sugar-free-maple-flavoured-syrup`,
    displayName: 'Sugar Free Maple Flavoured Syrup',
  },
];

/**
 * Check if an ingredient item mentions a TPP product and return linked HTML.
 * Returns the original text if no match, or an <a> tag if it matches.
 */
export function linkifyIngredient(itemText: string): string {
  const itemLower = itemText.toLowerCase();

  for (const product of TPP_PRODUCT_LINKS) {
    for (const keyword of product.keywords) {
      if (itemLower.includes(keyword)) {
        // Wrap the matching text in a link
        return `<a href="${product.url}" style="color: #bd6930; text-decoration: underline; font-weight: 600;" target="_blank" rel="noopener">${itemText}</a>`;
      }
    }
  }

  // Also catch generic "protein pancake mix" or "TPP mix"
  if (itemLower.includes('protein pancake mix') || itemLower.includes('tpp mix') || itemLower.includes('pancake mix')) {
    return `<a href="${STORE_URL}/collections/all" style="color: #bd6930; text-decoration: underline; font-weight: 600;" target="_blank" rel="noopener">${itemText}</a>`;
  }

  return itemText;
}

export { TPP_PRODUCT_LINKS };
