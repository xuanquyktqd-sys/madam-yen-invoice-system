/**
 * Image Processor — Madam Yen IMS
 * Skill: image-optimizer.md
 *
 * Rules:
 *  - Target: 200KB–500KB output
 *  - Max width: 2000px (keep aspect ratio)
 *  - Quality: 75%
 *  - Strip all EXIF metadata (GPS, camera info)
 *  - Zero local disk writes — Buffer only
 */

import sharp from 'sharp';

export type OptimizeResult = {
  buffer: Buffer;
  sizeKB: number;
  width: number;
  height: number;
  format: string;
};

const MAX_WIDTH_PX = 2000;
const QUALITY = 75;
const TARGET_MAX_KB = 500;
const TARGET_MIN_KB = 50; // Below this -> likely corrupt/blank

/**
 * Validate raw file before processing.
 * Returns { valid, warning } — never throws.
 */
export function preValidate(buffer: Buffer, mimeType: string): { valid: boolean; warning?: string } {
  const sizeKB = buffer.length / 1024;

  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'].includes(mimeType)) {
    return { valid: false, warning: `Unsupported format: ${mimeType}. Please use JPG, PNG, WEBP, or HEIC.` };
  }

  if (sizeKB < TARGET_MIN_KB) {
    return {
      valid: true, // Allow but warn
      warning: `This image is very small (${sizeKB.toFixed(0)}KB) and may be missing details. Consider retaking it.`,
    };
  }

  return { valid: true };
}

/**
 * Optimize image:
 *  1. Resize to max 2000px width (keep ratio)
 *  2. Convert to JPEG progressive
 *  3. Quality 75%, strip all metadata
 *  4. Return Buffer — NO disk I/O
 */
export async function optimizeImage(inputBuffer: Buffer): Promise<OptimizeResult> {
  const image = sharp(inputBuffer, { failOn: 'none' })
    .rotate() // Auto-rotate from EXIF before stripping
    .resize({ width: MAX_WIDTH_PX, withoutEnlargement: true })
    .jpeg({
      quality: QUALITY,
      progressive: true,
      mozjpeg: true,
    })
    .withMetadata({}); // Strips all EXIF (GPS, camera info)

  const outputBuffer = await image.toBuffer();
  const metadata = await sharp(outputBuffer).metadata();

  const sizeKB = outputBuffer.length / 1024;

  // If still too big, do a second pass at lower quality
  if (sizeKB > TARGET_MAX_KB) {
    const secondPass = await sharp(outputBuffer)
      .jpeg({ quality: 60, progressive: true, mozjpeg: true })
      .withMetadata({})
      .toBuffer();

    const secondMeta = await sharp(secondPass).metadata();
    return {
      buffer: secondPass,
      sizeKB: secondPass.length / 1024,
      width: secondMeta.width ?? 0,
      height: secondMeta.height ?? 0,
      format: 'jpeg',
    };
  }

  return {
    buffer: outputBuffer,
    sizeKB,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    format: 'jpeg',
  };
}
