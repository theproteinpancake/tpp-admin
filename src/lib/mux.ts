import Mux from '@mux/mux-node';

// Initialize Mux client
const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID!,
  tokenSecret: process.env.MUX_TOKEN_SECRET!,
});

export const { video } = mux;

/**
 * Create a direct upload URL for videos
 * This allows the client to upload directly to Mux
 */
export async function createDirectUpload() {
  const upload = await video.uploads.create({
    cors_origin: '*',
    new_asset_settings: {
      playback_policy: ['public'],
      encoding_tier: 'baseline',
    },
  });

  return {
    uploadUrl: upload.url,
    uploadId: upload.id,
  };
}

/**
 * Get an asset by ID
 */
export async function getAsset(assetId: string) {
  return video.assets.retrieve(assetId);
}

/**
 * Get upload status
 */
export async function getUploadStatus(uploadId: string) {
  return video.uploads.retrieve(uploadId);
}

/**
 * Delete an asset
 */
export async function deleteAsset(assetId: string) {
  return video.assets.delete(assetId);
}

/**
 * Get playback URL for a video
 */
export function getPlaybackUrl(playbackId: string) {
  return `https://stream.mux.com/${playbackId}.m3u8`;
}

/**
 * Get thumbnail URL for a video
 */
export function getThumbnailUrl(playbackId: string, options?: {
  time?: number;
  width?: number;
  height?: number;
}) {
  const params = new URLSearchParams();
  if (options?.time) params.set('time', options.time.toString());
  if (options?.width) params.set('width', options.width.toString());
  if (options?.height) params.set('height', options.height.toString());

  const queryString = params.toString();
  return `https://image.mux.com/${playbackId}/thumbnail.jpg${queryString ? '?' + queryString : ''}`;
}

/**
 * Get MP4 download URL for a video (requires mp4_support: 'standard')
 */
export function getMp4Url(playbackId: string, quality: 'high' | 'medium' | 'low' = 'high') {
  return `https://stream.mux.com/${playbackId}/${quality}.mp4`;
}

/**
 * Enable MP4 support on an existing asset (triggers static rendition creation)
 */
export async function enableMp4Support(assetId: string) {
  // The Mux API supports mp4_support but the SDK types are incomplete
  return video.assets.update(assetId, {
    mp4_support: 'standard',
  } as Parameters<typeof video.assets.update>[1]);
}

/**
 * Extract playback ID from a Mux stream URL
 */
export function extractPlaybackId(videoUrl: string): string | null {
  const match = videoUrl.match(/stream\.mux\.com\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Find asset ID by playback ID
 */
export async function findAssetByPlaybackId(playbackId: string) {
  // List recent assets and find the one with this playback ID
  const assets = await video.assets.list({ limit: 100 });
  for (const asset of assets.data || []) {
    if (asset.playback_ids?.some(p => p.id === playbackId)) {
      return asset;
    }
  }
  return null;
}

/**
 * Get animated GIF URL for a video
 */
export function getGifUrl(playbackId: string, options?: {
  start?: number;
  end?: number;
  width?: number;
  fps?: number;
}) {
  const params = new URLSearchParams();
  if (options?.start) params.set('start', options.start.toString());
  if (options?.end) params.set('end', options.end.toString());
  if (options?.width) params.set('width', options.width.toString());
  if (options?.fps) params.set('fps', options.fps.toString());

  const queryString = params.toString();
  return `https://image.mux.com/${playbackId}/animated.gif${queryString ? '?' + queryString : ''}`;
}
