import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { extractPlaybackId, getMp4Url, findAssetByPlaybackId, enableMp4Support } from '@/lib/mux';
import { uploadToYouTube, isYouTubeConfigured } from '@/lib/youtube';

export const maxDuration = 300; // 5 min timeout for video upload

async function downloadOriginalVideo(url: string): Promise<Buffer | null> {
  try {
    console.log(`[YouTube Upload] Downloading original from Supabase Storage...`);
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log(`[YouTube Upload] Original downloaded: ${(buffer.length / 1024 / 1024).toFixed(1)} MB (full quality)`);
    return buffer;
  } catch (err) {
    console.log('[YouTube Upload] Could not download original:', err);
    return null;
  }
}

async function downloadFromMux(playbackId: string): Promise<Buffer | null> {
  console.log(`[YouTube Upload] Falling back to Mux MP4...`);

  // Ensure MP4 support is enabled on the Mux asset
  try {
    const asset = await findAssetByPlaybackId(playbackId);
    if (asset && asset.mp4_support !== 'standard') {
      console.log('[YouTube Upload] Enabling MP4 support on Mux asset...');
      await enableMp4Support(asset.id);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } catch (err) {
    console.log('[YouTube Upload] Could not check/enable MP4 support:', err);
  }

  const mp4Url = getMp4Url(playbackId, 'high');
  console.log(`[YouTube Upload] Downloading MP4: ${mp4Url}`);

  let retries = 0;
  const maxRetries = 10;

  while (retries < maxRetries) {
    const mp4Response = await fetch(mp4Url);

    if (mp4Response.ok) {
      const arrayBuffer = await mp4Response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      console.log(`[YouTube Upload] Downloaded from Mux: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
      return buffer;
    }

    if (mp4Response.status === 412) {
      retries++;
      console.log(`[YouTube Upload] MP4 not ready yet, waiting... (attempt ${retries}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }

    // Try medium quality as fallback
    if (retries === 0) {
      const mediumUrl = getMp4Url(playbackId, 'medium');
      const medResponse = await fetch(mediumUrl);
      if (medResponse.ok) {
        const arrayBuffer = await medResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        console.log(`[YouTube Upload] Downloaded (medium): ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
        return buffer;
      }
    }

    retries++;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const { recipeId } = await request.json();

    // Check YouTube is configured
    if (!isYouTubeConfigured()) {
      return NextResponse.json(
        {
          error: 'YouTube not configured. Run the initial auth from terminal first:\n' +
                 'node scripts/youtube-upload.js --video <any-video> --slug test'
        },
        { status: 500 }
      );
    }

    // Fetch recipe from Supabase
    const { data: recipe, error } = await supabase
      .from('recipes')
      .select('*')
      .eq('id', recipeId)
      .single();

    if (error || !recipe) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }

    if (!recipe.video_url) {
      return NextResponse.json({ error: 'Recipe has no video uploaded' }, { status: 400 });
    }

    // Check if already uploaded to YouTube
    if (recipe.youtube_video_id) {
      return NextResponse.json({
        success: true,
        alreadyUploaded: true,
        videoId: recipe.youtube_video_id,
        videoUrl: `https://www.youtube.com/watch?v=${recipe.youtube_video_id}`,
        message: 'Video already uploaded to YouTube',
      });
    }

    console.log(`[YouTube Upload] Recipe: ${recipe.title}`);

    // Download video — prefer original (full quality) from Supabase Storage
    let videoBuffer: Buffer | null = null;

    if (recipe.original_video_url) {
      videoBuffer = await downloadOriginalVideo(recipe.original_video_url);
    }

    // Fall back to Mux MP4 if original not available
    if (!videoBuffer) {
      const playbackId = extractPlaybackId(recipe.video_url);
      if (!playbackId) {
        return NextResponse.json(
          { error: 'Could not extract Mux playback ID from video URL' },
          { status: 400 }
        );
      }
      videoBuffer = await downloadFromMux(playbackId);
    }

    if (!videoBuffer) {
      return NextResponse.json(
        {
          error: 'Could not download video. Try re-uploading the video, ' +
                 'or try again in a minute if the video was just uploaded.'
        },
        { status: 500 }
      );
    }

    // Upload to YouTube
    const result = await uploadToYouTube(videoBuffer, {
      title: recipe.title,
      slug: recipe.slug,
      description: recipe.description,
      category: recipe.category,
      tags: recipe.tags || [],
      flavours: recipe.flavours || [],
      prep_time_minutes: recipe.prep_time_minutes,
      cook_time_minutes: recipe.cook_time_minutes,
      servings: recipe.servings,
      calories: recipe.calories,
      protein: recipe.protein,
      carbs: recipe.carbs,
      fat: recipe.fat,
      ingredients: recipe.ingredients || [],
    });

    // Save YouTube video ID to Supabase
    await supabase
      .from('recipes')
      .update({ youtube_video_id: result.videoId })
      .eq('id', recipeId);

    console.log(`[YouTube Upload] Success! ${result.videoUrl}`);

    // Auto-update Shopify blog post with YouTube embed if blog exists
    if (recipe.shopify_article_id) {
      try {
        const baseUrl = request.headers.get('origin') || request.headers.get('host') || '';
        const protocol = baseUrl.startsWith('http') ? '' : 'https://';
        const blogUpdateUrl = `${protocol}${baseUrl}/api/shopify/blog-update`;

        console.log(`[YouTube Upload] Updating Shopify blog with YouTube embed...`);
        const blogResponse = await fetch(blogUpdateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipeId }),
        });

        if (blogResponse.ok) {
          console.log('[YouTube Upload] Shopify blog updated with YouTube embed');
        } else {
          console.log('[YouTube Upload] Shopify blog update failed (non-critical):', await blogResponse.text());
        }
      } catch (blogErr) {
        console.log('[YouTube Upload] Could not update Shopify blog (non-critical):', blogErr);
      }
    }

    return NextResponse.json({
      success: true,
      videoId: result.videoId,
      videoUrl: result.videoUrl,
      embedUrl: result.embedUrl,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[YouTube Upload] Error:', message);
    return NextResponse.json(
      { error: `YouTube upload failed: ${message}` },
      { status: 500 }
    );
  }
}
