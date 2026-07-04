import { NextResponse } from 'next/server';
import { updateRecipeBlog } from '@/lib/blogPublish';

// Thin wrapper — the logic lives in lib/blogPublish so server code (e.g. the YouTube upload
// route) can call it directly instead of HTTP-fetching this route (which middleware blocks
// for cookieless server-to-server calls).
export async function POST(request: Request) {
  try {
    const { recipeId } = await request.json();
    const result = await updateRecipeBlog(recipeId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({
      success: true,
      articleId: result.articleId,
      articleUrl: result.articleUrl,
      message: 'Blog post updated successfully!',
    });
  } catch (error) {
    console.error('Blog update error:', error);
    return NextResponse.json({ error: 'Failed to update blog post' }, { status: 500 });
  }
}
