import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { generateBlogHtml } from '@/lib/blog-html';

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

    // Generate SEO-optimized blog HTML
    const blogContent = generateBlogHtml(recipe);

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
