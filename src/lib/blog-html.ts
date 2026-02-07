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
  saturated_fat: number | null;
  sugars: number | null;
  fiber: number | null;
  sodium: number | null;
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
  tipsYellow: '#FFF9E6',
  tipsBorder: '#F5E6B8',
  white: '#FFFFFF',
  border: '#E8DCC8',
  starGold: '#D97706',
};

// Standard Daily Values for %DV calculation (based on 2,000 cal diet)
const DAILY_VALUES = {
  calories: 2000,
  fat: 78,         // 78g
  saturatedFat: 20, // 20g
  carbs: 275,      // 275g
  fiber: 28,       // 28g
  protein: 50,     // 50g
  sodium: 2300,    // 2300mg
};

/**
 * Calculate %DV for a nutrient
 */
function calcDV(amount: number | null, dailyValue: number): string {
  if (amount == null) return '—';
  return `${Math.round((amount / dailyValue) * 100)}%`;
}

/**
 * Convert kcal to kJ (1 kcal = 4.184 kJ)
 */
function kcalToKj(kcal: number): number {
  return Math.round(kcal * 4.184);
}

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
      ...(recipe.saturated_fat && { saturatedFatContent: `${recipe.saturated_fat}g` }),
      ...(recipe.sugars && { sugarContent: `${recipe.sugars}g` }),
      ...(recipe.fiber && { fiberContent: `${recipe.fiber}g` }),
      ...(recipe.sodium && { sodiumContent: `${recipe.sodium}mg` }),
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

// Shared font stack — Recoleta with fallbacks
const FONT = `'Recoleta', 'Georgia', serif`;

/**
 * Generate a single row in the nutrition facts table
 */
function nutritionRow(label: string, amount: string, dv: string, bold: boolean = false, indent: boolean = false): string {
  const labelStyle = `color: ${BRAND.caramel}; ${bold ? 'font-weight: bold;' : ''} ${indent ? 'padding-left: 16px;' : ''}`;
  return `
    <tr style="border-bottom: 1px solid ${BRAND.border};">
      <td style="padding: 8px 4px; ${labelStyle} font-family: ${FONT};">${label}</td>
      <td style="padding: 8px 4px; color: ${BRAND.caramel}; text-align: center; font-family: ${FONT};">${amount}</td>
      <td style="padding: 8px 4px; color: ${BRAND.caramel}; text-align: right; font-weight: bold; font-family: ${FONT};">${dv}</td>
    </tr>`;
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
    <span style="color: ${BRAND.caramel}; font-size: 14px; margin-left: 8px; font-family: ${FONT};">${recipe.rating.toFixed(1)} / 5${recipe.review_count ? ` (${recipe.review_count} reviews)` : ''}</span>
  </div>` : '';

  // Ingredients list
  const ingredientsList = recipe.ingredients
    ?.map((ing) =>
      `<li style="padding: 6px 0; color: ${BRAND.darkText}; border-bottom: 1px solid ${BRAND.border}; font-family: ${FONT};">${ing.amount} ${ing.unit} ${ing.item}${ing.notes ? ` <em>(${ing.notes})</em>` : ''}</li>`
    )
    .join('\n') || '';

  // Instructions list
  const instructionsList = recipe.instructions
    ?.map((step, idx) =>
      `<li style="padding: 10px 0; color: ${BRAND.darkText}; line-height: 1.6; border-bottom: 1px solid ${BRAND.border}; font-family: ${FONT};"><strong style="color: ${BRAND.caramel};">Step ${idx + 1}:</strong> ${step}</li>`
    )
    .join('\n') || '';

  // YouTube embed — fixed size for Shorts (9:16 aspect ratio, capped dimensions)
  const youtubeEmbed = recipe.youtube_video_id ? `
  <div style="margin: 32px 0; text-align: center;">
    <iframe
      width="315"
      height="560"
      src="https://www.youtube.com/embed/${recipe.youtube_video_id}"
      style="border: none; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 100%;"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
      title="${recipe.title} - Video Recipe"
      loading="lazy"
    ></iframe>
    <p style="color: ${BRAND.caramel}; font-size: 14px; margin-top: 12px; font-style: italic; font-family: ${FONT};">Watch the full recipe video</p>
  </div>` : '';

  // Full Nutritional Information table (below tips)
  const hasNutrition = recipe.calories || recipe.protein || recipe.carbs || recipe.fat;
  const nutritionPanel = hasNutrition ? `
  <div style="max-width: 420px; margin: 32px auto; border: 2px solid ${BRAND.caramel}; border-radius: 12px; overflow: hidden;">
    <div style="background: ${BRAND.caramel}; padding: 16px 20px;">
      <h2 style="margin: 0; color: ${BRAND.white}; font-size: 22px; font-weight: bold; text-align: center; font-family: ${FONT};">Nutritional Information</h2>
    </div>
    <div style="padding: 20px; background: ${BRAND.cream};">
      <p style="color: ${BRAND.caramel}; font-size: 14px; margin: 0 0 4px 0; font-weight: 600; font-family: ${FONT};">Amount per serving</p>
      <p style="color: ${BRAND.caramel}; font-size: 13px; margin: 0 0 16px 0; font-family: ${FONT};">Serves ${recipe.servings}</p>

      <table style="width: 100%; border-collapse: collapse; border-top: 3px solid ${BRAND.caramel};">
        <thead>
          <tr style="border-bottom: 2px solid ${BRAND.caramel};">
            <th style="padding: 8px 4px; text-align: left; color: ${BRAND.caramel}; font-family: ${FONT}; font-size: 13px;">Nutrient</th>
            <th style="padding: 8px 4px; text-align: center; color: ${BRAND.caramel}; font-family: ${FONT}; font-size: 13px;">Amount per Serve</th>
            <th style="padding: 8px 4px; text-align: right; color: ${BRAND.caramel}; font-family: ${FONT}; font-size: 13px;">% Daily Value</th>
          </tr>
        </thead>
        <tbody>
          ${recipe.calories != null ? nutritionRow('Energy', `${Math.round(recipe.calories)} kcal (${kcalToKj(recipe.calories)} kJ)`, calcDV(recipe.calories, DAILY_VALUES.calories), true) : ''}
          ${recipe.protein != null ? nutritionRow('Protein', `${recipe.protein}g`, calcDV(recipe.protein, DAILY_VALUES.protein), true) : ''}
          ${recipe.fat != null ? nutritionRow('Total Fat', `${recipe.fat}g`, calcDV(recipe.fat, DAILY_VALUES.fat), true) : ''}
          ${recipe.saturated_fat != null ? nutritionRow('Saturated Fat', `${recipe.saturated_fat}g`, calcDV(recipe.saturated_fat, DAILY_VALUES.saturatedFat), false, true) : ''}
          ${recipe.carbs != null ? nutritionRow('Carbohydrates', `${recipe.carbs}g`, calcDV(recipe.carbs, DAILY_VALUES.carbs), true) : ''}
          ${recipe.sugars != null ? nutritionRow('Sugars', `${recipe.sugars}g`, '—', false, true) : ''}
          ${recipe.fiber != null ? nutritionRow('Dietary Fiber', `${recipe.fiber}g`, calcDV(recipe.fiber, DAILY_VALUES.fiber), false, true) : ''}
          ${recipe.sodium != null ? nutritionRow('Sodium', `${recipe.sodium}mg`, calcDV(recipe.sodium, DAILY_VALUES.sodium), true) : ''}
        </tbody>
      </table>

      <p style="color: ${BRAND.caramel}; font-size: 11px; margin: 16px 0 0 0; line-height: 1.5; font-family: ${FONT};">* Percent Daily Values (%DV) are based on a 2,000 calorie diet. Your daily values may be higher or lower depending on your calorie needs. Values are estimates based on recipe ingredients.</p>
    </div>
  </div>` : '';

  // Tips section
  const tipsHtml = recipe.tips ? `
  <div style="background: ${BRAND.tipsYellow}; border: 1px solid ${BRAND.tipsBorder}; border-radius: 12px; padding: 20px 24px; margin: 24px 0;">
    <h2 style="color: ${BRAND.caramel}; font-size: 20px; margin: 0 0 8px 0; font-family: ${FONT};">💡 Tips</h2>
    <p style="color: ${BRAND.caramel}; margin: 0; line-height: 1.6; font-family: ${FONT};">${recipe.tips}</p>
  </div>` : '';

  // Quick nutrition summary — using table for consistent alignment
  const quickNutrition = hasNutrition ? `
  <div style="background: ${BRAND.cream}; border-radius: 12px; padding: 20px 24px; margin: 16px 0;">
    <h2 style="color: ${BRAND.caramel}; font-size: 20px; margin: 0 0 16px 0; font-family: ${FONT};">Nutrition (per serving)</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        ${recipe.calories ? `<td style="text-align: center; padding: 0 8px; vertical-align: top;">
          <div style="font-size: 24px; font-weight: bold; color: ${BRAND.caramel}; font-family: ${FONT}; line-height: 1.2;">${Math.round(recipe.calories)}</div>
          <div style="font-size: 11px; color: ${BRAND.caramel}; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; font-family: ${FONT};">Calories</div>
        </td>` : ''}
        ${recipe.protein ? `<td style="text-align: center; padding: 0 8px; vertical-align: top;">
          <div style="font-size: 24px; font-weight: bold; color: ${BRAND.caramel}; font-family: ${FONT}; line-height: 1.2;">${recipe.protein}g</div>
          <div style="font-size: 11px; color: ${BRAND.caramel}; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; font-family: ${FONT};">Protein</div>
        </td>` : ''}
        ${recipe.carbs ? `<td style="text-align: center; padding: 0 8px; vertical-align: top;">
          <div style="font-size: 24px; font-weight: bold; color: ${BRAND.caramel}; font-family: ${FONT}; line-height: 1.2;">${recipe.carbs}g</div>
          <div style="font-size: 11px; color: ${BRAND.caramel}; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; font-family: ${FONT};">Carbs</div>
        </td>` : ''}
        ${recipe.fat ? `<td style="text-align: center; padding: 0 8px; vertical-align: top;">
          <div style="font-size: 24px; font-weight: bold; color: ${BRAND.caramel}; font-family: ${FONT}; line-height: 1.2;">${recipe.fat}g</div>
          <div style="font-size: 11px; color: ${BRAND.caramel}; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; font-family: ${FONT};">Fat</div>
        </td>` : ''}
      </tr>
    </table>
  </div>` : '';

  // Build the full blog HTML
  return `
${schemaMarkup}
<div class="recipe-post" style="max-width: 680px; margin: 0 auto; font-family: ${FONT}; color: ${BRAND.darkText}; line-height: 1.6;">

  ${recipe.description ? `<p style="font-size: 16px; color: ${BRAND.darkText}; line-height: 1.7; margin-bottom: 20px; font-family: ${FONT};">${recipe.description}</p>` : ''}

  ${ratingHtml}

  <!-- Prep / Cook / Serves -->
  <div style="background: ${BRAND.cream}; border-radius: 12px; padding: 16px 24px; margin: 16px 0; display: flex; justify-content: center; gap: 24px; flex-wrap: wrap;">
    ${recipe.prep_time_minutes ? `<span style="color: ${BRAND.darkText}; font-size: 15px; font-family: ${FONT};">⏱️ <strong>Prep:</strong> ${recipe.prep_time_minutes} min</span>` : ''}
    ${recipe.cook_time_minutes ? `<span style="color: ${BRAND.darkText}; font-size: 15px; font-family: ${FONT};">🔥 <strong>Cook:</strong> ${recipe.cook_time_minutes} min</span>` : ''}
    <span style="color: ${BRAND.darkText}; font-size: 15px; font-family: ${FONT};">🍽️ <strong>Serves:</strong> ${recipe.servings}</span>
    ${totalTime > 0 ? `<span style="color: ${BRAND.darkText}; font-size: 15px; font-family: ${FONT};">⏰ <strong>Total:</strong> ${totalTime} min</span>` : ''}
  </div>

  ${quickNutrition}

  <!-- Ingredients -->
  <h2 style="color: ${BRAND.caramel}; font-size: 24px; margin: 32px 0 16px 0; padding-bottom: 8px; border-bottom: 2px solid ${BRAND.caramel}; font-family: ${FONT};">Ingredients</h2>
  <ul style="list-style: none; padding: 0; margin: 0 0 24px 0;">
    ${ingredientsList}
  </ul>

  <!-- YouTube Video (between Ingredients & Instructions) -->
  ${youtubeEmbed}

  <!-- Instructions -->
  <h2 style="color: ${BRAND.caramel}; font-size: 24px; margin: 32px 0 16px 0; padding-bottom: 8px; border-bottom: 2px solid ${BRAND.caramel}; font-family: ${FONT};">Instructions</h2>
  <ol style="padding-left: 20px; margin: 0 0 24px 0;">
    ${instructionsList}
  </ol>

  <!-- Tips -->
  ${tipsHtml}

  <!-- Full Nutritional Information -->
  ${nutritionPanel}

  <!-- CTA -->
  <div style="text-align: center; margin: 32px 0; padding: 24px; background: ${BRAND.cream}; border-radius: 12px;">
    <p style="color: ${BRAND.caramel}; font-size: 16px; margin: 0 0 8px 0; font-weight: bold; font-family: ${FONT};">Made this recipe? 🥞</p>
    <p style="color: ${BRAND.caramel}; font-size: 14px; margin: 0; font-family: ${FONT};">Tag us <strong>@theproteinpancake</strong> on Instagram!</p>
  </div>

</div>
  `.trim();
}
