/**
 * API Route: POST /api/process
 * Madam Yen IMS — Core Processing Pipeline
 *
 * Flow: Receive image → Optimize → Upload to Supabase Storage → Enqueue OCR job → Trigger worker
 * Zero local storage at every step.
 */

import { NextRequest, NextResponse } from 'next/server';
import { optimizeImage, preValidate } from '@/lib/image-processor';
import { queueOcrJob, triggerOcrWorker } from '@/lib/ocr-jobs';
import { uploadOcrJobImage } from '@/lib/storage-service';

export const runtime = 'nodejs'; // Required for sharp + buffer operations
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  console.log('[API] POST /api/process — new request');

  try {
    // ── Step 1: Parse multipart form data ──────────────────────────────
    const formData = await request.formData();
    const file = formData.get('image') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No image file provided.' }, { status: 400 });
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type;

    console.log(`[API] Received: ${file.name} (${(inputBuffer.length / 1024).toFixed(0)}KB, ${mimeType})`);

    // ── Step 2: Pre-validate ───────────────────────────────────────────
    const validation = preValidate(inputBuffer, mimeType);
    if (!validation.valid) {
      return NextResponse.json({
        error: validation.warning ?? 'Ảnh không hợp lệ.',
        step: 'validation',
      }, { status: 422 });
    }

    // ── Step 3: Optimize image (sharp, Buffer-only) ────────────────────
    console.log('[API] Optimizing image...');
    const optimized = await optimizeImage(inputBuffer);
    console.log(`[API] Optimized: ${optimized.width}x${optimized.height}px, ${optimized.sizeKB.toFixed(0)}KB`);

    // Return optimized preview to client for "Looks good?" confirmation
    // If query param ?preview=1 is set, return optimized image for preview
    const isPreview = request.nextUrl.searchParams.get('preview') === '1';
    if (isPreview) {
      return new NextResponse(new Uint8Array(optimized.buffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'X-Image-Size-KB': optimized.sizeKB.toFixed(0),
          'X-Image-Width': String(optimized.width),
          'X-Image-Height': String(optimized.height),
        },
      });
    }

    // ── Step 4: Upload optimized image and enqueue job ─────────────────
    const jobId = crypto.randomUUID();
    console.log(`[API] Uploading optimized image for OCR job ${jobId}...`);
    let upload;
    try {
      upload = await uploadOcrJobImage(optimized.buffer, jobId);
    } catch (storageError) {
      const msg = (storageError as Error).message;
      console.error('[API] Storage upload failed:', msg);
      return NextResponse.json({
        error: `Upload ảnh thất bại: ${msg}`,
        step: 'storage',
      }, { status: 502 });
    }

    try {
      await queueOcrJob({
        id: jobId,
        bucket: upload.bucket,
        path: upload.path,
        publicUrl: upload.publicUrl,
        maxAttempts: 3,
      });
    } catch (jobError) {
      const msg = (jobError as Error).message;
      console.error('[API] OCR job creation failed:', msg);
      return NextResponse.json({
        error: `Không tạo được OCR job: ${msg}`,
        step: 'queue',
      }, { status: 500 });
    }

    console.log(`[API] OCR job queued: ${jobId}`);
    let triggered = false;
    try {
      triggered = await triggerOcrWorker(jobId);
    } catch (err) {
      console.error('[API] Worker trigger threw:', (err as Error).message);
    }

    // ── Step 5: Return immediately ─────────────────────────────────────
    return NextResponse.json({
      success: true,
      jobId,
      status: 'queued',
      triggered,
      imageUrl: upload.publicUrl,
      meta: {
        originalSizeKB: (inputBuffer.length / 1024).toFixed(0),
        optimizedSizeKB: optimized.sizeKB.toFixed(0),
        dimensions: `${optimized.width}x${optimized.height}`,
      },
    }, { status: 202 });

  } catch (err) {
    const msg = (err as Error).message;
    console.error('[API] Unhandled error:', msg);
    return NextResponse.json({
      error: `Server error: ${msg}`,
      step: 'unknown',
    }, { status: 500 });
  }
}
