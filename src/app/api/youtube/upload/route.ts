import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { extractPlaybackId, getMp4Url, findAssetByPlaybackId, enableMp4Support } from '@/lib/mux';
import { uploadToYouTube, isYouTubeConfigured } from '@/lib/youtube';

export const maxDuration = 300; // 5 min timeout for video upload

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

    // Extract Mux playback ID from the video URL
    const playbackId = extractPlaybackId(recipe.video_url);
    if (!playbackId) {
      return NextResponse.json(
        { error: 'Could not extract Mux playback ID from video URL' },
        { status: 400 }
      );
    }

    console.log(`[YouTube Upload] Recipe: ${recipe.title}, Playback ID: ${playbackId}`);

    // Ensure MP4 support is enabled on the Mux asset
    try {
      const asset = await findAssetByPlaybackId(playbackId);
      if (asset && asset.mp4_support !== 'standard') {
        console.log('[YouTube Upload] Enabling MP4 support on Mux asset...');
        await enableMp4Support(asset.id);
        // Wait a moment for rendition to start
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (err) {
      console.log('[YouTube Upload] Could not check/enable MP4 support:', err);
      // Continue anyway - the MP4 URL might still work
    }

    // Download the MP4 from Mux
    const mp4Url = getMp4Url(playbackId, 'high');
    console.log(`[YouTube Upload] Downloading MP4: ${mp4Url}`);

    let videoBuffer: Buffer;
    let retries = 0;
    const maxRetries = 10;

    while (retries < maxRetries) {
      const mp4Response = await fetch(mp4Url);

      if (mp4Response.ok) {
        const arrayBuffer = await mp4Response.arrayBuffer();
        videoBuffer = Buffer.from(arrayBuffer);
        console.log(`[YouTube Upload] Downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB`);
        break;
      }

      if (mp4Response.status === 412) {
        // MP4 rendition not ready yet - wait and retry
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
          videoBuffer = Buffer.from(arrayBuffer);
          console.log(`[YouTube Upload] Downloaded (medium): ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB`);
          break;
        }
      }

      retries++;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    if (!videoBuffer!) {
      return NextResponse.json(
        {
          error: 'Could not download video from Mux. The MP4 rendition may not be ready yet. ' +
                 'Try again in a minute, or check that the video was uploaded correctly.'
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
