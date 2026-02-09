import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use service role key for server-side operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://nnwfuylkrouuitjcdswj.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle CORS preflight
export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { recipe_slug, rating, author_name, comment_text } = body;

    // Validate
    if (!recipe_slug || !rating || !author_name || !comment_text) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: 'Rating must be between 1 and 5' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Find recipe by slug
    const { data: recipe, error: recipeError } = await supabaseAdmin
      .from('recipes')
      .select('id, rating, review_count')
      .eq('slug', recipe_slug)
      .single();

    if (recipeError || !recipe) {
      return NextResponse.json(
        { error: 'Recipe not found' },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // Insert the comment/review
    const { error: commentError } = await supabaseAdmin
      .from('recipe_comments')
      .insert({
        recipe_id: recipe.id,
        author_name: author_name.trim().slice(0, 100),
        comment_text: comment_text.trim().slice(0, 1000),
      });

    if (commentError) {
      console.error('[Reviews] Insert error:', commentError);
      return NextResponse.json(
        { error: 'Failed to submit review' },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Recalculate aggregate rating
    const currentRating = recipe.rating || 0;
    const currentCount = recipe.review_count || 0;
    const newCount = currentCount + 1;
    const newRating = ((currentRating * currentCount) + rating) / newCount;

    await supabaseAdmin
      .from('recipes')
      .update({
        rating: parseFloat(newRating.toFixed(1)),
        review_count: newCount,
      })
      .eq('id', recipe.id);

    return NextResponse.json(
      {
        success: true,
        rating: parseFloat(newRating.toFixed(1)),
        review_count: newCount,
      },
      { headers: CORS_HEADERS }
    );

  } catch (error) {
    console.error('[Reviews] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
