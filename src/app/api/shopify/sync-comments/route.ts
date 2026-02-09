import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'theproteinpancake.myshopify.com';
    const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

    const { recipeId } = await request.json();

    if (!SHOPIFY_ACCESS_TOKEN) {
      return NextResponse.json(
        { error: 'Shopify integration not configured' },
        { status: 500 }
      );
    }

    // Fetch recipe to get Shopify article ID
    const { data: recipe, error: recipeError } = await supabase
      .from('recipes')
      .select('id, shopify_article_id, title')
      .eq('id', recipeId)
      .single();

    if (recipeError || !recipe) {
      return NextResponse.json(
        { error: 'Recipe not found' },
        { status: 404 }
      );
    }

    if (!recipe.shopify_article_id) {
      return NextResponse.json(
        { error: 'Recipe has not been published to Shopify yet' },
        { status: 400 }
      );
    }

    // Fetch comments from Supabase
    const { data: comments, error: commentsError } = await supabase
      .from('recipe_comments')
      .select('*')
      .eq('recipe_id', recipeId)
      .eq('is_deleted', false)
      .is('parent_comment_id', null) // Only top-level comments
      .order('created_at', { ascending: true });

    if (commentsError) {
      return NextResponse.json(
        { error: 'Failed to fetch comments' },
        { status: 500 }
      );
    }

    if (!comments || comments.length === 0) {
      return NextResponse.json({
        success: true,
        synced: 0,
        message: 'No comments to sync',
      });
    }

    // Find the blog containing this article
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
    let targetBlogId: number | null = null;

    for (const blog of blogs) {
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
      return NextResponse.json(
        { error: 'Shopify article not found' },
        { status: 404 }
      );
    }

    // Sync each comment to Shopify
    let synced = 0;
    const errors: string[] = [];

    for (const comment of comments) {
      try {
        const commentResponse = await fetch(
          `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/articles/${recipe.shopify_article_id}/comments.json`,
          {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              comment: {
                author: comment.author_name,
                body: comment.comment_text,
                status: 'published',
              },
            }),
          }
        );

        if (commentResponse.ok) {
          synced++;
        } else {
          const errorText = await commentResponse.text();
          errors.push(`Comment ${comment.id}: ${errorText}`);
        }
      } catch (err: any) {
        errors.push(`Comment ${comment.id}: ${err.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      synced,
      total: comments.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `Synced ${synced}/${comments.length} comments to Shopify`,
    });

  } catch (error) {
    console.error('Comment sync error:', error);
    return NextResponse.json(
      { error: 'Failed to sync comments' },
      { status: 500 }
    );
  }
}
