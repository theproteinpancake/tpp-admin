/**
 * Convert an image file to WebP format with compression
 * Uses the browser's Canvas API — no external dependencies needed.
 *
 * Features:
 * - Scales down images to a max dimension (default 1200px)
 * - Iteratively reduces quality until file is under target size (default 100KB)
 * - Returns original if already WebP and under target size
 */

const MAX_DIMENSION = 1200;
const TARGET_SIZE_BYTES = 100 * 1024; // 100KB
const INITIAL_QUALITY = 0.82;
const MIN_QUALITY = 0.3;
const QUALITY_STEP = 0.08;

export async function convertToWebP(
  file: File,
  quality: number = INITIAL_QUALITY
): Promise<File> {
  // If already WebP and under target size, return as-is
  if (file.type === 'image/webp' && file.size <= TARGET_SIZE_BYTES) {
    return file;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = async () => {
      try {
        // Calculate scaled dimensions (cap at MAX_DIMENSION)
        let width = img.naturalWidth;
        let height = img.naturalHeight;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        const originalName = file.name.replace(/\.[^.]+$/, '');

        // Iteratively reduce quality until under target size
        let currentQuality = quality;
        let blob: Blob | null = null;

        while (currentQuality >= MIN_QUALITY) {
          blob = await new Promise<Blob | null>((res) =>
            canvas.toBlob((b) => res(b), 'image/webp', currentQuality)
          );

          if (!blob) {
            reject(new Error('Failed to convert image to WebP'));
            URL.revokeObjectURL(url);
            return;
          }

          if (blob.size <= TARGET_SIZE_BYTES) {
            break;
          }

          currentQuality -= QUALITY_STEP;
        }

        if (!blob) {
          reject(new Error('Failed to convert image to WebP'));
          URL.revokeObjectURL(url);
          return;
        }

        const webpFile = new File([blob], `${originalName}.webp`, {
          type: 'image/webp',
        });

        URL.revokeObjectURL(url);
        resolve(webpFile);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for conversion'));
    };

    img.src = url;
  });
}
