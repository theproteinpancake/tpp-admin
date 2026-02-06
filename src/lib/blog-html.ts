/**
 * Blog HTML Generator
 *
 * Generates SEO-optimized HTML for Shopify recipe blog posts.
 * Includes Schema.org Recipe structured data, YouTube embed,
 * full nutrition panel, and on-brand styling.
 */

interface RecipeData {
  title: string;
  slug: string;
  description: string | null;
  featured_image: string | null;
  category: string;
  tags: string[];
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  servings: number;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  ingredients: { amount: string; unit: string; item: string; notes?: string }[];
  instructions: string[];
  tips: string | null;
  rating: number | null;
  review_count: number | null;
  youtube_video_id: string | null;
}

// Brand colors
const BRAND = {
  caramel: '#bd6930',
  cream: '#F9F4E8',
  darkText: '#bd6930',
  lightBg: '#F9F4E8',
  tipsYellow: '#FFF9E6',
  tipsBorder: '#F5E6B8',
  white: '#FFFFFF',
  border: '#E8DCC8',
  starGold: '#D97706',
  lightGray: '#F3EDE2',
};

/**
 * Convert minutes to ISO 8601 duration (e.g., PT15M)
 */
function toIsoDuration(minutes: number | null): string {
  if (!minutes) return 'PT0M';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `PT${hours}H${mins}M`;
  if (hours > 0) return `PT${hours}H`;
  return `PT${mins}M`;
}

/**
 * Generate Schema.org Recipe JSON-LD for rich search results
 */
function generateRecipeSchema(recipe: RecipeData): string {
  const totalTime = (recipe.prep_time_minutes || 0) + (recipe.cook_time_minutes || 0);

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org/',
    '@type': 'Recipe',
    name: recipe.title,
    description: recipe.description || `${recipe.title} - A high-protein recipe by The Protein Pancake`,
    author: {
      '@type': 'Organization',
      name: 'The Protein Pancake',
      url: 'https://theproteinpancake.com.au',
    },
    prepTime: toIsoDuration(recipe.prep_time_minutes),
    cookTime: toIsoDuration(recipe.cook_time_minutes),
    totalTime: toIsoDuration(totalTime),
    recipeYield: `${recipe.servings} serving${recipe.servings !== 1 ? 's' : ''}`,
    recipeCategory: recipe.category,
    recipeCuisine: 'High Protein',
    keywords: recipe.tags?.join(', ') || recipe.category,
    recipeIngredient: recipe.ingredients?.map(
      (ing) => `${ing.amount} ${ing.unit} ${ing.item}${ing.notes ? ` (${ing.notes})` : ''}`
    ) || [],
    recipeInstructions: recipe.instructions?.map((step, idx) => ({
      '@type': 'HowToStep',
      position: idx + 1,
      text: step,
    })) || [],
  };

  // Add image if available
  if (recipe.featured_image) {
    schema.image = [recipe.featured_image];
  }

  // Add nutrition if available
  if (recipe.calories || recipe.protein || recipe.carbs || recipe.fat) {
    schema.nutrition = {
      '@type': 'NutritionInformation',
      ...(recipe.calories && { calories: `${recipe.calories} calories` }),
      ...(recipe.protein && { proteinContent: `${recipe.protein}g` }),
      ...(recipe.carbs && { carbohydrateContent: `${recipe.carbs}g` }),
      ...(recipe.fat && { fatContent: `${recipe.fat}g` }),
    };
  }

  // Add rating if available
  if (recipe.rating && recipe.rating > 0) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: recipe.rating.toFixed(1),
      bestRating: '5',
      ...(recipe.review_count && { ratingCount: recipe.review_count }),
    };
  }

  // Add video if YouTube upload exists
  if (recipe.youtube_video_id) {
    schema.video = {
      '@type': 'VideoObject',
      name: recipe.title,
      description: recipe.description || recipe.title,
      thumbnailUrl: `https://img.youtube.com/vi/${recipe.youtube_video_id}/maxresdefault.jpg`,
      contentUrl: `https://www.youtube.com/watch?v=${recipe.youtube_video_id}`,
      embedUrl: `https://www.youtube.com/embed/${recipe.youtube_video_id}`,
      uploadDate: new Date().toISOString().split('T')[0],
    };
  }

  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

/**
 * Generate the full blog HTML for a recipe
 */
export function generateBlogHtml(recipe: RecipeData): string {
  const totalTime = (recipe.prep_time_minutes || 0) + (recipe.cook_time_minutes || 0);

  // Schema.org JSON-LD
  const schemaMarkup = generateRecipeSchema(recipe);

  // Star rating HTML
  const ratingHtml = recipe.rating && recipe.rating > 0 ? `
  <div style="margin: 16px 0; font-size: 18px; text-align: center;">
    <span style="color: ${BRAND.starGold}; letter-spacing: 2px; font-size: 22px;">${'★'.repeat(Math.round(recipe.rating))}${'☆'.repeat(5 - Math.round(recipe.rating))}</span>
    <span style="color: ${BRAND.caramel}; font-size: 14px; margin-left: 8px;">${recipe.rating.toFixed(1)} / 5${recipe.review_count ? ` (${recipe.review_count} reviews)` : ''}</span>
  </div>` : '';

  // Ingredients list
  const ingredientsList = recipe.ingredients
    ?.map((ing) =>
      `<li style="padding: 6px 0; color: ${BRAND.darkText}; border-bottom: 1px solid ${BRAND.border};">${ing.amount} ${ing.unit} ${ing.item}${ing.notes ? ` <em>(${ing.notes})</em>` : ''}</li>`
    )
    .join('\n') || '';

  // Instructions list
  const instructionsList = recipe.instructions
    ?.map((step, idx) =>
      `<li style="padding: 10px 0; color: ${BRAND.darkText}; line-height: 1.6; border-bottom: 1px solid ${BRAND.border};"><strong style="color: ${BRAND.caramel};">Step ${idx + 1}:</strong> ${step}</li>`
    )
    .join('\n') || '';

  // YouTube embed (between Ingredients and Instructions)
  const youtubeEmbed = recipe.youtube_video_id ? `
  <div style="margin: 32px 0; text-align: center;">
    <div style="position: relative; padding-bottom: 177.78%; height: 0; overflow: hidden; max-width: 360px; margin: 0 auto; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
      <iframe
        src="https://www.youtube.com/embed/${recipe.youtube_video_id}"
        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; border-radius: 12px;"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        title="${recipe.title} - Video Recipe"
        loading="lazy"
      ></iframe>
    </div>
    <p style="color: ${BRAND.caramel}; font-size: 14px; margin-top: 12px; font-style: italic;">Watch the full recipe video</p>
  </div>` : '';

  // Full Nutrition Facts panel (below tips)
  const hasNutrition = recipe.calories || recipe.protein || recipe.carbs || recipe.fat;
  const nutritionPanel = hasNutrition ? `
  <div style="max-width: 340px; margin: 32px auto; border: 2px solid ${BRAND.caramel}; border-radius: 12px; overflow: hidden;">
    <div style="background: ${BRAND.caramel}; padding: 16px 20px;">
      <h2 style="margin: 0; color: ${BRAND.white}; font-size: 22px; font-weight: bold; text-align: center;">Nutrition Facts</h2>
    </div>
    <div style="padding: 16px 20px; background: ${BRAND.white};">
      <p style="color: ${BRAND.caramel}; font-size: 14px; margin: 0 0 4px 0; font-weight: 600;">Amount per serving</p>
      <p style="color: ${BRAND.caramel}; font-size: 13px; margin: 0 0 12px 0;">Serves ${recipe.servings}</p>
      <div style="border-top: 8px solid ${BRAND.caramel}; padding-top: 8px;">
        ${recipe.calories != null ? `
        <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid ${BRAND.border};">
          <span style="font-weight: bold; color: ${BRAND.caramel}; font-size: 18px;">Calories</span>
          <span style="font-weight: bold; color: ${BRAND.caramel}; font-size: 18px;">${Math.round(recipe.calories)}</span>
        </div>` : ''}
        <div style="border-bottom: 4px solid ${BRAND.caramel}; margin: 4px 0;"></div>
        ${recipe.fat != null ? `
        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid ${BRAND.border};">
          <span style="font-weight: bold; color: ${BRAND.caramel};">Total Fat</span>
          <span style="color: ${BRAND.caramel};">${recipe.fat}g</span>
        </div>` : ''}
        ${recipe.carbs != null ? `
        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid ${BRAND.border};">
          <span style="font-weight: bold; color: ${BRAND.caramel};">Total Carbohydrates</span>
          <span style="color: ${BRAND.caramel};">${recipe.carbs}g</span>
        </div>` : ''}
        ${recipe.protein != null ? `
        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid ${BRAND.border};">
          <span style="font-weight: bold; color: ${BRAND.caramel};">Protein</span>
          <span style="font-weight: bold; color: ${BRAND.caramel};">${recipe.protein}g</span>
        </div>` : ''}
      </div>
      <p style="color: ${BRAND.caramel}; font-size: 11px; margin: 12px 0 0 0; line-height: 1.4;">* Percent Daily Values are based on a 2,000 calorie diet. Your daily values may be higher or lower depending on your calorie needs.</p>
    </div>
  </div>` : '';

  // Tips section
  const tipsHtml = recipe.tips ? `
  <div style="background: ${BRAND.tipsYellow}; border: 1px solid ${BRAND.tipsBorder}; border-radius: 12px; padding: 20px 24px; margin: 24px 0;">
    <h2 style="color: ${BRAND.caramel}; font-size: 20px; margin: 0 0 8px 0;">💡 Tips</h2>
    <p style="color: ${BRAND.caramel}; margin: 0; line-height: 1.6;">${recipe.tips}</p>
  </div>` : '';

  // Quick nutrition summary (in the top section)
  const quickNutrition = hasNutrition ? `
  <div style="background: ${BRAND.cream}; border-radius: 12px; padding: 20px 24px; margin: 16px 0;">
    <h2 style="color: ${BRAND.caramel}; font-size: 20px; margin: 0 0 12px 0;">Nutrition (per serving)</h2>
    <div style="display: flex; flex-wrap: wrap; gap: 16px;">
      ${recipe.calories ? `<div style="text-align: center; flex: 1; min-width: 70px;"><div style="font-size: 22px; font-weight: bold; color: ${BRAND.caramel};">${Math.round(recipe.calories)}</div><div style="font-size: 12px; color: ${BRAND.caramel}; text-transform: uppercase; letter-spacing: 0.5px;">Calories</div></div>` : ''}
      ${recipe.protein ? `<div style="text-align: center; flex: 1; min-width: 70px;"><div style="font-size: 22px; font-weight: bold; color: ${BRAND.caramel};">${recipe.protein}g</div><div style="font-size: 12px; color: ${BRAND.caramel}; text-transform: uppercase; letter-spacing: 0.5px;">Protein</div></div>` : ''}
      ${recipe.carbs ? `<div style="text-align: center; flex: 1; min-width: 70px;"><div style="font-size: 22px; font-weight: bold; color: ${BRAND.caramel};">${recipe.carbs}g</div><div style="font-size: 12px; color: ${BRAND.caramel}; text-transform: uppercase; letter-spacing: 0.5px;">Carbs</div></div>` : ''}
      ${recipe.fat ? `<div style="text-align: center; flex: 1; min-width: 70px;"><div style="font-size: 22px; font-weight: bold; color: ${BRAND.caramel};">${recipe.fat}g</div><div style="font-size: 12px; color: ${BRAND.caramel}; text-transform: uppercase; letter-spacing: 0.5px;">Fat</div></div>` : ''}
    </div>
  </div>` : '';

  // Build the full blog HTML
  return `
${schemaMarkup}
<div class="recipe-post" style="max-width: 680px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: ${BRAND.darkText}; line-height: 1.6;">

  ${recipe.description ? `<p style="font-size: 16px; color: ${BRAND.darkText}; line-height: 1.7; margin-bottom: 20px;">${recipe.description}</p>` : ''}

  ${ratingHtml}

  <!-- Prep / Cook / Serves -->
  <div style="background: ${BRAND.cream}; border-radius: 12px; padding: 16px 24px; margin: 16px 0; display: flex; justify-content: center; gap: 24px; flex-wrap: wrap;">
    ${recipe.prep_time_minutes ? `<span style="color: ${BRAND.darkText}; font-size: 15px;">⏱️ <strong>Prep:</strong> ${recipe.prep_time_minutes} min</span>` : ''}
    ${recipe.cook_time_minutes ? `<span style="color: ${BRAND.darkText}; font-size: 15px;">🔥 <strong>Cook:</strong> ${recipe.cook_time_minutes} min</span>` : ''}
    <span style="color: ${BRAND.darkText}; font-size: 15px;">🍽️ <strong>Serves:</strong> ${recipe.servings}</span>
    ${totalTime > 0 ? `<span style="color: ${BRAND.darkText}; font-size: 15px;">⏰ <strong>Total:</strong> ${totalTime} min</span>` : ''}
  </div>

  ${quickNutrition}

  <!-- Ingredients -->
  <h2 style="color: ${BRAND.caramel}; font-size: 24px; margin: 32px 0 16px 0; padding-bottom: 8px; border-bottom: 2px solid ${BRAND.caramel};">Ingredients</h2>
  <ul style="list-style: none; padding: 0; margin: 0 0 24px 0;">
    ${ingredientsList}
  </ul>

  <!-- YouTube Video (between Ingredients & Instructions) -->
  ${youtubeEmbed}

  <!-- Instructions -->
  <h2 style="color: ${BRAND.caramel}; font-size: 24px; margin: 32px 0 16px 0; padding-bottom: 8px; border-bottom: 2px solid ${BRAND.caramel};">Instructions</h2>
  <ol style="padding-left: 20px; margin: 0 0 24px 0;">
    ${instructionsList}
  </ol>

  <!-- Tips -->
  ${tipsHtml}

  <!-- Full Nutrition Panel -->
  ${nutritionPanel}

  <!-- CTA -->
  <div style="text-align: center; margin: 32px 0; padding: 24px; background: ${BRAND.cream}; border-radius: 12px;">
    <p style="color: ${BRAND.caramel}; font-size: 16px; margin: 0 0 8px 0; font-weight: bold;">Made this recipe? 🥞</p>
    <p style="color: ${BRAND.caramel}; font-size: 14px; margin: 0;">Tag us <strong>@theproteinpancake</strong> on Instagram!</p>
  </div>

</div>
  `.trim();
}
