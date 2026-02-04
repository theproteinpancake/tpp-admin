import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'theproteinpancake.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

export async function POST(request: Request) {
  try {
    const { recipeId } = await request.json();

    if (!SHOPIFY_ACCESS_TOKEN) {
      console.error('Missing SHOPIFY_ACCESS_TOKEN');
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

    // Build the blog post HTML (image is added via the image field, not in body)
    const blogContent = `
<div class="recipe-post">
  ${recipe.description ? `<p class="recipe-intro">${recipe.description}</p>` : ''}

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

    // Create draft blog post via Shopify Admin API (using stable API version)
    const shopifyResponse = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/blogs.json`,
      {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!shopifyResponse.ok) {
      const errorText = await shopifyResponse.text();
      console.error('Failed to fetch blogs:', shopifyResponse.status, errorText);

      if (shopifyResponse.status === 401 || shopifyResponse.status === 403) {
        return NextResponse.json(
          { error: 'Shopify authentication failed. Please check your access token has read_content and write_content scopes.' },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { error: `Failed to connect to Shopify: ${shopifyResponse.status} - ${errorText}` },
        { status: 500 }
      );
    }

    const { blogs } = await shopifyResponse.json();

    console.log('Shopify blogs found:', blogs?.map((b: { id: number; handle: string; title: string }) => ({ id: b.id, handle: b.handle, title: b.title })));

    // Find the main blog (usually called "News" or "Blog" or "Recipes")
    const targetBlog = blogs.find((b: { handle: string }) =>
      b.handle === 'recipes' || b.handle === 'news' || b.handle === 'blog'
    ) || blogs[0];

    if (!targetBlog) {
      return NextResponse.json(
        { error: 'No blog found in Shopify store. Please create a blog first in Shopify Admin → Online Store → Blog Posts.' },
        { status: 404 }
      );
    }

    console.log('Using blog:', targetBlog.handle, targetBlog.id);

    // Create the article as a draft
    const articleResponse = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/blogs/${targetBlog.id}/articles.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          article: {
            title: recipe.title,
            author: 'The Protein Pancake',
            tags: recipe.tags?.join(', ') || '',
            body_html: blogContent,
            published: false, // Create as draft
            handle: recipe.slug,
            // Add featured image to the article's image field (for previews)
            ...(recipe.featured_image && {
              image: {
                src: recipe.featured_image,
                alt: recipe.title,
              },
            }),
            metafields: [
              {
                namespace: 'tpp',
                key: 'recipe_id',
                value: recipeId,
                type: 'single_line_text_field',
              },
            ],
          },
        }),
      }
    );

    if (!articleResponse.ok) {
      const errorText = await articleResponse.text();
      console.error('Failed to create article:', articleResponse.status, errorText);

      if (articleResponse.status === 401 || articleResponse.status === 403) {
        return NextResponse.json(
          { error: 'Permission denied. Please ensure your Shopify app has write_content scope enabled.' },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { error: `Failed to create blog draft: ${errorText}` },
        { status: 500 }
      );
    }

    const { article } = await articleResponse.json();

    // Update recipe with Shopify article ID for future syncs
    await supabase
      .from('recipes')
      .update({ shopify_article_id: article.id })
      .eq('id', recipeId);

    return NextResponse.json({
      success: true,
      articleId: article.id,
      articleUrl: `https://${SHOPIFY_STORE_DOMAIN}/admin/blogs/${targetBlog.id}/articles/${article.id}`,
    });

  } catch (error) {
    console.error('Blog draft error:', error);
    return NextResponse.json(
      { error: 'Failed to create blog draft' },
      { status: 500 }
    );
  }
}
