#!/usr/bin/env node
/**
 * Shopify Blog Post HTML Generator
 * The Protein Pancake - On-Brand Recipe Pages
 *
 * Generates beautiful, SEO-optimised HTML for Shopify blog posts
 * with full nutritional panel, branded colours, and video embedding.
 *
 * Usage:
 *   node scripts/generate-blog-html.js                     # Generate all recipes
 *   node scripts/generate-blog-html.js --slug classic-buttermilk-protein-pancakes
 *   node scripts/generate-blog-html.js --output ./blog-html/
 *
 * Brand Colours:
 *   Cream background:  #F9F4E8
 *   Brand orange text:  #bd6930
 *   Dark text:          #3D2C1E
 *   Accent caramel:     #C4813C
 *   Light border:       #E8DCC8
 */

const fs = require('fs');
const path = require('path');

// ─── Brand Colours ───────────────────────────────────────────────
const COLORS = {
  cream: '#F9F4E8',
  orange: '#bd6930',
  dark: '#3D2C1E',
  caramel: '#C4813C',
  border: '#E8DCC8',
  white: '#FFFFFF',
  lightCream: '#FDF8F0',
  greenAccent: '#5B8C3E',
};

// ─── Generate HTML for a single recipe ───────────────────────────
function generateRecipeHTML(recipe) {
  const totalTime = (recipe.prep_time_minutes || 0) + (recipe.cook_time_minutes || 0);
  const tips = Array.isArray(recipe.tips) ? recipe.tips : (recipe.tips ? [recipe.tips] : []);
  const videoEmbedUrl = getVideoEmbedUrl(recipe.video_url);

  return `
<!-- TPP Recipe: ${recipe.title} -->
<!-- Generated: ${new Date().toISOString().split('T')[0]} -->

<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; color: ${COLORS.dark};">

  <!-- Recipe Description -->
  ${recipe.description ? `
  <div style="margin-bottom: 28px; padding: 20px 24px; background: ${COLORS.cream}; border-radius: 12px; border-left: 4px solid ${COLORS.orange};">
    <p style="font-size: 17px; line-height: 1.65; color: ${COLORS.orange}; margin: 0; font-style: italic;">
      ${recipe.description}
    </p>
  </div>
  ` : ''}

  <!-- NIP / Prep Time Section -->
  <div style="background: ${COLORS.cream}; border-radius: 12px; padding: 20px 24px; margin-bottom: 28px; border: 1px solid ${COLORS.border};">
    <div style="display: flex; justify-content: space-around; text-align: center; flex-wrap: wrap; gap: 12px;">
      ${recipe.prep_time_minutes ? `
      <div style="min-width: 80px;">
        <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.orange}; font-weight: 600; margin-bottom: 4px;">Prep</div>
        <div style="font-size: 22px; font-weight: 700; color: ${COLORS.orange};">${recipe.prep_time_minutes} min</div>
      </div>
      ` : ''}
      ${recipe.cook_time_minutes ? `
      <div style="min-width: 80px;">
        <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.orange}; font-weight: 600; margin-bottom: 4px;">Cook</div>
        <div style="font-size: 22px; font-weight: 700; color: ${COLORS.orange};">${recipe.cook_time_minutes} min</div>
      </div>
      ` : ''}
      ${totalTime > 0 ? `
      <div style="min-width: 80px;">
        <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.orange}; font-weight: 600; margin-bottom: 4px;">Total</div>
        <div style="font-size: 22px; font-weight: 700; color: ${COLORS.orange};">${totalTime} min</div>
      </div>
      ` : ''}
      ${recipe.servings ? `
      <div style="min-width: 80px;">
        <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.orange}; font-weight: 600; margin-bottom: 4px;">Servings</div>
        <div style="font-size: 22px; font-weight: 700; color: ${COLORS.orange};">${recipe.servings}</div>
      </div>
      ` : ''}
      ${recipe.difficulty ? `
      <div style="min-width: 80px;">
        <div style="font-size: 13px; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.orange}; font-weight: 600; margin-bottom: 4px;">Difficulty</div>
        <div style="font-size: 22px; font-weight: 700; color: ${COLORS.orange};">${recipe.difficulty}</div>
      </div>
      ` : ''}
    </div>
  </div>

  <!-- Quick Macros Bar -->
  ${recipe.calories ? `
  <div style="display: flex; justify-content: space-around; text-align: center; margin-bottom: 28px; padding: 16px; background: ${COLORS.cream}; border-radius: 12px; border: 1px solid ${COLORS.border};">
    ${recipe.calories ? `
    <div>
      <div style="font-size: 24px; font-weight: 700; color: ${COLORS.orange};">${Math.round(recipe.calories)}</div>
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.orange};">Calories</div>
    </div>
    ` : ''}
    ${recipe.protein ? `
    <div>
      <div style="font-size: 24px; font-weight: 700; color: ${COLORS.orange};">${Math.round(recipe.protein)}g</div>
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.orange};">Protein</div>
    </div>
    ` : ''}
    ${recipe.carbs ? `
    <div>
      <div style="font-size: 24px; font-weight: 700; color: ${COLORS.orange};">${Math.round(recipe.carbs)}g</div>
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.orange};">Carbs</div>
    </div>
    ` : ''}
    ${recipe.fat ? `
    <div>
      <div style="font-size: 24px; font-weight: 700; color: ${COLORS.orange};">${Math.round(recipe.fat)}g</div>
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: ${COLORS.orange};">Fat</div>
    </div>
    ` : ''}
  </div>
  ` : ''}

  <!-- Video Embed -->
  ${videoEmbedUrl ? `
  <div style="margin-bottom: 28px; border-radius: 12px; overflow: hidden; border: 1px solid ${COLORS.border};">
    <div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden;">
      <iframe
        src="${videoEmbedUrl}"
        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        loading="lazy"
        title="${recipe.title} - Video Recipe"
      ></iframe>
    </div>
  </div>
  ` : ''}

  <!-- Ingredients Section -->
  <div style="margin-bottom: 28px;">
    <h2 style="font-size: 22px; font-weight: 700; color: ${COLORS.dark}; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid ${COLORS.orange};">
      Ingredients
    </h2>
    <ul style="list-style: none; padding: 0; margin: 0;">
      ${(recipe.ingredients || []).map(ing => {
        const amount = ing.amount || '';
        const unit = (ing.unit && ing.unit !== 'undefined') ? ing.unit : '';
        const item = ing.item || ing;
        const notes = ing.notes ? ` (${ing.notes})` : '';
        return `
      <li style="padding: 10px 0; border-bottom: 1px solid ${COLORS.border}; display: flex; align-items: baseline; gap: 8px;">
        <span style="color: ${COLORS.orange}; font-size: 18px; flex-shrink: 0;">&#8226;</span>
        <span>
          ${amount || unit ? `<strong style="color: ${COLORS.dark};">${amount}${unit ? ' ' + unit : ''}</strong> ` : ''}
          <span style="color: ${COLORS.dark};">${typeof item === 'string' ? item : item}</span>
          ${notes ? `<span style="color: ${COLORS.caramel}; font-style: italic;">${notes}</span>` : ''}
        </span>
      </li>`;
      }).join('')}
    </ul>
  </div>

  <!-- Method / Instructions -->
  <div style="margin-bottom: 28px;">
    <h2 style="font-size: 22px; font-weight: 700; color: ${COLORS.dark}; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid ${COLORS.orange};">
      Method
    </h2>
    <ol style="padding-left: 0; margin: 0; counter-reset: step-counter; list-style: none;">
      ${(recipe.instructions || []).map((step, i) => `
      <li style="padding: 14px 0 14px 48px; border-bottom: 1px solid ${COLORS.border}; position: relative; line-height: 1.6; color: ${COLORS.dark};">
        <span style="position: absolute; left: 0; top: 12px; width: 32px; height: 32px; background: ${COLORS.orange}; color: ${COLORS.white}; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px;">${i + 1}</span>
        ${step}
      </li>`).join('')}
    </ol>
  </div>

  <!-- Tips -->
  ${tips.length > 0 ? `
  <div style="margin-bottom: 28px; padding: 20px 24px; background: ${COLORS.cream}; border-radius: 12px; border: 1px solid ${COLORS.border};">
    <h3 style="font-size: 18px; font-weight: 700; color: ${COLORS.orange}; margin: 0 0 12px 0;">
      Tips & Tricks
    </h3>
    <ul style="list-style: none; padding: 0; margin: 0;">
      ${tips.map(tip => `
      <li style="padding: 6px 0; color: ${COLORS.orange}; line-height: 1.5;">
        <span style="margin-right: 8px;">💡</span> ${tip}
      </li>`).join('')}
    </ul>
  </div>
  ` : ''}

  <!-- ═══════════════════════════════════════════════════════════════ -->
  <!-- FULL NUTRITIONAL INFORMATION PANEL (SEO) -->
  <!-- ═══════════════════════════════════════════════════════════════ -->
  ${generateNutritionalPanel(recipe)}

  <!-- Schema.org Recipe Structured Data (SEO) -->
  ${generateSchemaMarkup(recipe)}

</div>
`;
}

// ─── Nutritional Information Panel ───────────────────────────────
function generateNutritionalPanel(recipe) {
  if (!recipe.calories && !recipe.protein) return '';

  // Calculate derived values
  const servings = recipe.servings || 1;
  const calories = Math.round(recipe.calories || 0);
  const protein = Math.round(recipe.protein || 0);
  const carbs = Math.round(recipe.carbs || 0);
  const fat = Math.round(recipe.fat || 0);
  const fiber = Math.round(recipe.fiber || 0);
  const sugar = Math.round(recipe.sugar || 0);

  // Estimated values (if not in master data)
  const saturatedFat = recipe.saturated_fat ? Math.round(recipe.saturated_fat) : Math.round(fat * 0.35);
  const sodium = recipe.sodium ? Math.round(recipe.sodium) : null;
  const cholesterol = recipe.cholesterol ? Math.round(recipe.cholesterol) : null;

  // % Daily Values (based on 2,000 cal diet, Australian NRVs)
  const dvCalories = Math.round((calories / 2000) * 100);
  const dvProtein = Math.round((protein / 50) * 100);
  const dvCarbs = Math.round((carbs / 310) * 100);
  const dvFat = Math.round((fat / 70) * 100);
  const dvSatFat = Math.round((saturatedFat / 24) * 100);
  const dvFiber = Math.round((fiber / 30) * 100);

  return `
  <div style="margin-bottom: 28px; border: 2px solid ${COLORS.dark}; border-radius: 12px; overflow: hidden;">
    <!-- Panel Header -->
    <div style="background: ${COLORS.dark}; padding: 16px 20px;">
      <h2 style="font-size: 22px; font-weight: 800; color: ${COLORS.white}; margin: 0; text-transform: uppercase; letter-spacing: 1px;">
        Nutritional Information
      </h2>
      <p style="font-size: 13px; color: rgba(255,255,255,0.7); margin: 4px 0 0 0;">
        Per serving${servings > 1 ? ` (makes ${servings} servings)` : ''}
      </p>
    </div>

    <!-- Main Nutrition Table -->
    <div style="padding: 0;">
      <!-- Energy / Calories -->
      <div style="display: flex; justify-content: space-between; padding: 14px 20px; background: ${COLORS.cream}; border-bottom: 2px solid ${COLORS.dark};">
        <div>
          <span style="font-size: 18px; font-weight: 700; color: ${COLORS.orange};">Energy</span>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 22px; font-weight: 800; color: ${COLORS.orange};">${calories}</span>
          <span style="font-size: 14px; color: ${COLORS.orange};"> cal</span>
          <span style="font-size: 13px; color: ${COLORS.caramel}; margin-left: 8px;">(${Math.round(calories * 4.184)} kJ)</span>
        </div>
      </div>

      <!-- Protein (highlighted) -->
      <div style="display: flex; justify-content: space-between; padding: 12px 20px; background: ${COLORS.cream}; border-bottom: 1px solid ${COLORS.border};">
        <span style="font-weight: 700; color: ${COLORS.orange}; font-size: 16px;">Protein</span>
        <div>
          <span style="font-weight: 700; color: ${COLORS.orange}; font-size: 16px;">${protein}g</span>
          <span style="font-size: 12px; color: ${COLORS.caramel}; margin-left: 8px;">${dvProtein}% DV</span>
        </div>
      </div>

      <!-- Total Fat -->
      <div style="display: flex; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid ${COLORS.border};">
        <span style="font-weight: 700; color: ${COLORS.dark};">Total Fat</span>
        <div>
          <span style="font-weight: 600; color: ${COLORS.dark};">${fat}g</span>
          <span style="font-size: 12px; color: ${COLORS.caramel}; margin-left: 8px;">${dvFat}% DV</span>
        </div>
      </div>

      <!-- Saturated Fat -->
      <div style="display: flex; justify-content: space-between; padding: 10px 20px 10px 36px; border-bottom: 1px solid ${COLORS.border}; background: ${COLORS.lightCream};">
        <span style="color: ${COLORS.dark};">Saturated Fat</span>
        <div>
          <span style="color: ${COLORS.dark};">${saturatedFat}g</span>
          <span style="font-size: 12px; color: ${COLORS.caramel}; margin-left: 8px;">${dvSatFat}% DV</span>
        </div>
      </div>

      <!-- Total Carbohydrates -->
      <div style="display: flex; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid ${COLORS.border};">
        <span style="font-weight: 700; color: ${COLORS.dark};">Total Carbohydrates</span>
        <div>
          <span style="font-weight: 600; color: ${COLORS.dark};">${carbs}g</span>
          <span style="font-size: 12px; color: ${COLORS.caramel}; margin-left: 8px;">${dvCarbs}% DV</span>
        </div>
      </div>

      ${fiber > 0 ? `
      <!-- Dietary Fibre -->
      <div style="display: flex; justify-content: space-between; padding: 10px 20px 10px 36px; border-bottom: 1px solid ${COLORS.border}; background: ${COLORS.lightCream};">
        <span style="color: ${COLORS.dark};">Dietary Fibre</span>
        <div>
          <span style="color: ${COLORS.dark};">${fiber}g</span>
          <span style="font-size: 12px; color: ${COLORS.caramel}; margin-left: 8px;">${dvFiber}% DV</span>
        </div>
      </div>
      ` : ''}

      ${sugar > 0 ? `
      <!-- Sugars -->
      <div style="display: flex; justify-content: space-between; padding: 10px 20px 10px 36px; border-bottom: 1px solid ${COLORS.border}; background: ${COLORS.lightCream};">
        <span style="color: ${COLORS.dark};">Sugars</span>
        <span style="color: ${COLORS.dark};">${sugar}g</span>
      </div>
      ` : ''}

      ${sodium !== null ? `
      <!-- Sodium -->
      <div style="display: flex; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid ${COLORS.border};">
        <span style="font-weight: 700; color: ${COLORS.dark};">Sodium</span>
        <span style="font-weight: 600; color: ${COLORS.dark};">${sodium}mg</span>
      </div>
      ` : ''}

      ${cholesterol !== null ? `
      <!-- Cholesterol -->
      <div style="display: flex; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid ${COLORS.border};">
        <span style="font-weight: 700; color: ${COLORS.dark};">Cholesterol</span>
        <span style="font-weight: 600; color: ${COLORS.dark};">${cholesterol}mg</span>
      </div>
      ` : ''}

    </div>

    <!-- Panel Footer -->
    <div style="padding: 12px 20px; background: ${COLORS.cream}; border-top: 1px solid ${COLORS.border};">
      <p style="font-size: 11px; color: ${COLORS.orange}; margin: 0; line-height: 1.5;">
        * Percent Daily Values are based on a 2,000 calorie diet. Your daily values may be higher or lower depending on your calorie needs. Nutritional information is estimated and may vary based on preparation method and ingredient brands used.
      </p>
    </div>
  </div>
  `;
}

// ─── Schema.org Recipe Structured Data ───────────────────────────
function generateSchemaMarkup(recipe) {
  const totalTime = (recipe.prep_time_minutes || 0) + (recipe.cook_time_minutes || 0);

  const schema = {
    '@context': 'https://schema.org/',
    '@type': 'Recipe',
    name: recipe.title,
    description: recipe.description || '',
    author: {
      '@type': 'Organization',
      name: 'The Protein Pancake',
      url: 'https://theproteinpancake.co',
    },
    datePublished: recipe.created_at || new Date().toISOString().split('T')[0],
    image: recipe.featured_image || '',
    prepTime: recipe.prep_time_minutes ? `PT${recipe.prep_time_minutes}M` : undefined,
    cookTime: recipe.cook_time_minutes ? `PT${recipe.cook_time_minutes}M` : undefined,
    totalTime: totalTime > 0 ? `PT${totalTime}M` : undefined,
    recipeYield: recipe.servings ? `${recipe.servings} serving${recipe.servings > 1 ? 's' : ''}` : undefined,
    recipeCategory: recipe.category || 'Breakfast',
    recipeCuisine: 'Australian',
    keywords: (recipe.tags || []).join(', '),
    recipeIngredient: (recipe.ingredients || []).map(ing => {
      if (typeof ing === 'string') return ing;
      const unit = (ing.unit && ing.unit !== 'undefined') ? ing.unit : '';
      return `${ing.amount || ''} ${unit ? unit + ' ' : ''}${ing.item}`.trim();
    }),
    recipeInstructions: (recipe.instructions || []).map((step, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      text: step,
    })),
    nutrition: {
      '@type': 'NutritionInformation',
      calories: recipe.calories ? `${Math.round(recipe.calories)} cal` : undefined,
      proteinContent: recipe.protein ? `${Math.round(recipe.protein)}g` : undefined,
      carbohydrateContent: recipe.carbs ? `${Math.round(recipe.carbs)}g` : undefined,
      fatContent: recipe.fat ? `${Math.round(recipe.fat)}g` : undefined,
      fiberContent: recipe.fiber ? `${Math.round(recipe.fiber)}g` : undefined,
      sugarContent: recipe.sugar ? `${Math.round(recipe.sugar)}g` : undefined,
    },
    video: recipe.video_url ? {
      '@type': 'VideoObject',
      name: `${recipe.title} - Recipe Video`,
      description: recipe.description || `How to make ${recipe.title}`,
      contentUrl: recipe.video_url,
      thumbnailUrl: recipe.featured_image || '',
      uploadDate: recipe.created_at || new Date().toISOString().split('T')[0],
    } : undefined,
  };

  // Remove undefined values
  const clean = JSON.parse(JSON.stringify(schema));

  return `
  <script type="application/ld+json">
${JSON.stringify(clean, null, 2)}
  </script>
  `;
}

// ─── Video URL helpers ───────────────────────────────────────────
function getVideoEmbedUrl(videoUrl) {
  if (!videoUrl) return null;

  // YouTube
  const ytMatch = videoUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?rel=0&modestbranding=1`;

  // Vimeo
  const vimeoMatch = videoUrl.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;

  // Direct MP4 - return null (can't iframe an MP4)
  if (videoUrl.endsWith('.mp4')) return null;

  return null;
}

function getYouTubeId(videoUrl) {
  if (!videoUrl) return null;
  const match = videoUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// ─── Main CLI ────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const slugArg = args.indexOf('--slug');
  const outputArg = args.indexOf('--output');

  const slug = slugArg >= 0 ? args[slugArg + 1] : null;
  const outputDir = outputArg >= 0 ? args[outputArg + 1] : path.join(__dirname, 'blog-html');

  // Load recipes
  const masterPath = path.join(__dirname, 'recipes-master.json');
  if (!fs.existsSync(masterPath)) {
    console.error('Error: recipes-master.json not found. Run scrape-recipes.js first.');
    process.exit(1);
  }

  const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
  let recipes = master.recipes || [];

  if (slug) {
    recipes = recipes.filter(r => r.slug === slug);
    if (recipes.length === 0) {
      console.error(`No recipe found with slug: ${slug}`);
      process.exit(1);
    }
  }

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\n🥞 The Protein Pancake - Blog HTML Generator`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`Generating HTML for ${recipes.length} recipe(s)...\n`);

  let generated = 0;
  for (const recipe of recipes) {
    try {
      const html = generateRecipeHTML(recipe);
      const filename = `${recipe.slug || recipe.id}.html`;
      const filepath = path.join(outputDir, filename);
      fs.writeFileSync(filepath, html.trim(), 'utf8');
      console.log(`  ✅ ${recipe.title} → ${filename}`);
      generated++;
    } catch (err) {
      console.error(`  ❌ ${recipe.title}: ${err.message}`);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Generated ${generated}/${recipes.length} recipe HTML files`);
  console.log(`Output: ${outputDir}\n`);

  // Print usage hint
  console.log(`📋 To use: Copy the HTML content from any file and paste it`);
  console.log(`   into your Shopify blog post editor (HTML mode).\n`);
}

// Export for programmatic use
module.exports = { generateRecipeHTML, generateNutritionalPanel, generateSchemaMarkup, getVideoEmbedUrl };

// Run if called directly
if (require.main === module) {
  main();
}
