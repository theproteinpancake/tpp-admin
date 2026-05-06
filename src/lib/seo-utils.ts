/**
 * SEO Utilities
 * Auto-generate optimized meta titles, descriptions, and keywords for recipes.
 * All functions are defensive — they handle null, undefined, and unexpected inputs.
 */

interface SeoRecipeInput {
  title: string;
  category: string;
  tags?: string[];
  prep_time_minutes?: number | null;
  cook_time_minutes?: number | null;
  calories?: number | null;
  protein?: number | null;
  servings?: number;
  ingredients?: { item: string }[];
}

// Generate SEO-optimized meta title
// e.g. "Cookies & Cream Protein Waffles | High Protein Breakfast Recipe"
export function generateMetaTitle(recipe: SeoRecipeInput): string {
  try {
    const title = recipe?.title || '';
    const category = recipe?.category || 'recipe';

    if (!title) return '';

    // Add "Protein" to the title if not already present
    let enhancedTitle = title;
    if (!enhancedTitle.toLowerCase().includes('protein')) {
      // Insert "Protein" before common food words
      const foodWords = ['pancakes', 'waffles', 'crepes', 'muffins', 'cookies', 'brownies', 'bars', 'bites', 'bowl', 'smoothie', 'shake', 'oats', 'porridge'];
      for (const word of foodWords) {
        const regex = new RegExp(`(${word})`, 'i');
        if (enhancedTitle.toLowerCase().includes(word)) {
          enhancedTitle = enhancedTitle.replace(regex, `Protein $1`);
          break;
        }
      }
    }

    // Capitalize category
    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);

    return `${enhancedTitle} | High Protein ${categoryLabel} Recipe`;
  } catch {
    return recipe?.title || '';
  }
}

// Generate meta description (155-160 chars)
// e.g. "Make perfect Cookies & Cream protein waffles in just 8 min - 23g protein, 506 calories. Easy high-protein breakfast recipe using TPP mix."
export function generateMetaDescription(recipe: SeoRecipeInput): string {
  try {
    const title = recipe?.title || '';
    const category = recipe?.category || 'recipe';

    if (!title) return '';

    const totalTime = (Number(recipe.prep_time_minutes) || 0) + (Number(recipe.cook_time_minutes) || 0);
    const timeStr = totalTime > 0 ? `in just ${totalTime} min` : 'quickly';

    const parts: string[] = [];
    const protein = Number(recipe.protein) || 0;
    const calories = Number(recipe.calories) || 0;
    if (protein > 0) parts.push(`${Math.round(protein)}g protein`);
    if (calories > 0) parts.push(`${Math.round(calories)} calories`);
    const macroStr = parts.length > 0 ? ` - ${parts.join(', ')}` : '';

    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);

    const desc = `Make perfect ${title} ${timeStr}${macroStr}. Easy high-protein ${categoryLabel.toLowerCase()} recipe using The Protein Pancake mix.`;

    // Cap at 160 characters
    if (desc.length <= 160) return desc;

    // Shorter fallback
    const short = `Make ${title} ${timeStr}${macroStr}. High-protein ${categoryLabel.toLowerCase()} recipe by The Protein Pancake.`;
    return short.slice(0, 160);
  } catch {
    return '';
  }
}

// Generate focused SEO keywords (max 5)
// Google recommends a small number of genuine, relevant keywords — not keyword stuffing.
// e.g. "protein waffles, high protein breakfast, cookies and cream recipe"
export function generateSeoKeywords(recipe: SeoRecipeInput): string {
  try {
    const title = recipe?.title || '';
    const category = recipe?.category || '';

    if (!title) return '';

    const keywords: string[] = [];
    const titleLower = title.toLowerCase();

    // 1. Primary keyword: the recipe title itself (or protein variant)
    if (titleLower.includes('protein')) {
      keywords.push(titleLower);
    } else {
      keywords.push(`protein ${titleLower}`);
    }

    // 2. Category keyword: "high protein [category]"
    if (category) {
      keywords.push(`high protein ${category.toLowerCase()}`);
    }

    // 3. Food type keyword if present in title
    const foodTypes = ['pancakes', 'waffles', 'crepes', 'muffins', 'cookies', 'brownies', 'bars', 'bites', 'bowl', 'smoothie', 'shake', 'oats', 'porridge'];
    for (const food of foodTypes) {
      if (titleLower.includes(food)) {
        keywords.push(`protein ${food} recipe`);
        break;
      }
    }

    // 4. Flavour keyword if present in title
    const flavours = ['chocolate', 'vanilla', 'strawberry', 'blueberry', 'banana', 'peanut butter', 'cookies and cream', 'cookies & cream', 'salted caramel', 'cinnamon', 'maple', 'matcha', 'tiramisu', 'lemon'];
    for (const flavour of flavours) {
      if (titleLower.includes(flavour)) {
        keywords.push(flavour);
        break;
      }
    }

    // 5. One tag if available and not already covered
    if (Array.isArray(recipe.tags) && recipe.tags.length > 0) {
      const tag = recipe.tags[0].toLowerCase();
      if (!keywords.some(k => k.includes(tag))) {
        keywords.push(tag);
      }
    }

    // Deduplicate and cap at 5
    const unique = Array.from(new Set(keywords)).slice(0, 5);
    return unique.join(', ');
  } catch {
    return '';
  }
}
