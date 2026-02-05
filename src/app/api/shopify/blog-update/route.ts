import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'theproteinpancake.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

export async function POST(request: Request) {
  try {
    const { recipeId } = await request.json();

    if (!SHOPIFY_ACCESS_TOKEN) {
      return NextResponse.json(
        { error: 'Shopify integration not configured' },
        { status: 500 }
      );
    }

    // Fetch the recipe from Supabase
    const { data: recipe, error } = await supabase
      .from('recipes')
      .select('*')
      .eq('id', recipeId)
      .single();

    if (error || !recipe) {
      return NextResponse.json(
        { error: 'Recipe not found' },
        { status: 404 }
      );
    }

    // Check if recipe has a Shopify article ID
    if (!recipe.shopify_article_id) {
      return NextResponse.json(
        { error: 'This recipe has not been published to Shopify yet. Use "Create Blog Draft" first.' },
        { status: 400 }
      );
    }

    // Format ingredients for blog post
    const ingredientsList = recipe.ingredients
      ?.map((ing: { amount: string; unit: string; item: string; notes?: string }) =>
        `<li>${ing.amount} ${ing.unit} ${ing.item}${ing.notes ? ` (${ing.notes})` : ''}</li>`
      )
      .join('\n') || '';

    // Format instructions for blog post
    const instructionsList = recipe.instructions
      ?.map((step: string, idx: number) => `<li><strong>Step ${idx + 1}:</strong> ${step}</li>`)
      .join('\n') || '';

    // Generate star rating HTML if rating exists
    const ratingHtml = recipe.rating ? `
  <div class="recipe-rating" style="margin: 16px 0; font-size: 18px;">
    <span class="stars" style="color: #D97706; letter-spacing: 2px;">${'★'.repeat(Math.round(recipe.rating))}${'☆'.repeat(5 - Math.round(recipe.rating))}</span>
    <span class="rating-text" style="color: #6B7280; font-size: 14px; margin-left: 8px;">${recipe.rating.toFixed(1)} / 5${recipe.review_count ? ` (${recipe.review_count} reviews)` : ''}</span>
  </div>` : '';

    // Build the blog post HTML
    const blogContent = `
<div class="recipe-post">
  ${recipe.description ? `<p class="recipe-intro">${recipe.description}</p>` : ''}
  ${ratingHtml}

  <div class="recipe-meta">
    <span>⏱️ Prep: ${recipe.prep_time_minutes} min</span>
    <span>🔥 Cook: ${recipe.cook_time_minutes} min</span>
    <span>🍽️ Serves: ${recipe.servings}</span>
  </div>

  ${recipe.protein || recipe.calories ? `
  <div class="recipe-nutrition">
    <h3>Nutrition (per serving)</h3>
    <ul>
      ${recipe.calories ? `<li>Calories: ${recipe.calories}</li>` : ''}
      ${recipe.protein ? `<li>Protein: ${recipe.protein}g</li>` : ''}
      ${recipe.carbs ? `<li>Carbs: ${recipe.carbs}g</li>` : ''}
      ${recipe.fat ? `<li>Fat: ${recipe.fat}g</li>` : ''}
    </ul>
  </div>
  ` : ''}

  <h3>Ingredients</h3>
  <ul class="recipe-ingredients">
    ${ingredientsList}
  </ul>

  <h3>Instructions</h3>
  <ol class="recipe-instructions">
    ${instructionsList}
  </ol>

  ${recipe.tips ? `
  <div class="recipe-tips">
    <h3>💡 Tips</h3>
    <p>${recipe.tips}</p>
  </div>
  ` : ''}
</div>
    `.trim();

    // First, find the blog that contains this article
    const blogsResponse = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/blogs.json`,
      {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!blogsResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch Shopify blogs' },
        { status: 500 }
      );
    }

    const { blogs } = await blogsResponse.json();

    // Find the blog containing the article
    let targetBlogId: number | null = null;

    for (const blog of blogs) {
      // Try to fetch the article from this blog
      const articleCheck = await fetch(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/blogs/${blog.id}/articles/${recipe.shopify_article_id}.json`,
        {
          method: 'GET',
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json',
          },
        }
      );

      if (articleCheck.ok) {
        targetBlogId = blog.id;
        break;
      }
    }

    if (!targetBlogId) {
      // Article not found - clear the stale ID and prompt to create new
      await supabase
        .from('recipes')
        .update({ shopify_article_id: null })
        .eq('id', recipeId);

      return NextResponse.json(
        { error: 'The linked Shopify article was not found. It may have been deleted. Please create a new blog draft.' },
        { status: 404 }
      );
    }

    // Update the existing article
    const updateResponse = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/blogs/${targetBlogId}/articles/${recipe.shopify_article_id}.json`,
      {
        method: 'PUT',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          article: {
            id: recipe.shopify_article_id,
            title: recipe.title,
            body_html: blogContent,
            tags: recipe.tags?.join(', ') || '',
            // Update featured image if changed
            ...(recipe.featured_image && {
              image: {
                src: recipe.featured_image,
                alt: recipe.title,
              },
            }),
          },
        }),
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('Failed to update article:', updateResponse.status, errorText);
      return NextResponse.json(
        { error: `Failed to update blog post: ${errorText}` },
        { status: 500 }
      );
    }

    const { article } = await updateResponse.json();

    return NextResponse.json({
      success: true,
      articleId: article.id,
      articleUrl: `https://${SHOPIFY_STORE_DOMAIN}/admin/blogs/${targetBlogId}/articles/${article.id}`,
      message: 'Blog post updated successfully!',
    });

  } catch (error) {
    console.error('Blog update error:', error);
    return NextResponse.json(
      { error: 'Failed to update blog post' },
      { status: 500 }
    );
  }
}
