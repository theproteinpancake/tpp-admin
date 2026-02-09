import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { generateBlogHtml } from '@/lib/blog-html';
import { generateMetaTitle, generateMetaDescription } from '@/lib/seo-utils';

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

    // Generate SEO-optimized blog HTML
    const blogContent = generateBlogHtml(recipe);

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

    // Use SEO-optimized title if available, otherwise auto-generate
    const articleTitle = recipe.meta_title || generateMetaTitle(recipe);
    const metaDescription = recipe.meta_description || generateMetaDescription(recipe);

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
            title: articleTitle,
            author: 'The Protein Pancake',
            tags: recipe.tags?.join(', ') || '',
            body_html: blogContent,
            summary_html: metaDescription,
            published: false, // Create as draft
            handle: recipe.slug,
            // Add featured image to the article's image field (for previews)
            ...(recipe.featured_image && {
              image: {
                src: recipe.featured_image,
                alt: articleTitle,
              },
            }),
            metafields: [
              {
                namespace: 'tpp',
                key: 'recipe_id',
                value: recipeId,
                type: 'single_line_text_field',
              },
              {
                namespace: 'global',
                key: 'description_tag',
                value: metaDescription,
                type: 'single_line_text_field',
              },
              {
                namespace: 'global',
                key: 'title_tag',
                value: articleTitle,
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
