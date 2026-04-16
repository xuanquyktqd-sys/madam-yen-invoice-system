/**
 * API Route: POST /api/process
 * Madam Yen IMS — Core Processing Pipeline
 *
 * Flow: Receive image → Optimize → Upload to Supabase Storage → OCR (AI) → Save to DB
 * Zero local storage at every step.
 */

import { NextRequest, NextResponse } from 'next/server';
import { optimizeImage, preValidate } from '@/lib/image-processor';
import { extractInvoiceData } from '@/lib/ocr-service';
import { uploadInvoiceImage } from '@/lib/storage-service';
import { saveInvoice } from '@/lib/db-service';

export const runtime = 'nodejs'; // Required for sharp + buffer operations
export const maxDuration = 60;   // 60s timeout for OCR calls

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

    // ── Step 4: OCR via AI ─────────────────────────────────────────────
    console.log('[API] Running OCR...');
    let invoiceData;
    let ocrMeta: { provider: string; model: string; fallbackUsed: boolean } | null = null;
    try {
      const ocr = await extractInvoiceData(optimized.buffer);
      invoiceData = ocr.data;
      ocrMeta = ocr.meta;
    } catch (ocrError) {
      const msg = (ocrError as Error).message;
      console.error('[API] OCR failed:', msg);
      if (msg === 'MODEL_HIGH_DEMAND') {
        return NextResponse.json({
          error: 'OCR đang quá tải. Vui lòng thử lại sau 1 phút.',
          step: 'ocr',
          retryable: true,
        }, {
          status: 503,
          headers: { 'Retry-After': '60' },
        });
      }
      if (msg === 'OCR_OUTPUT_INVALID') {
        return NextResponse.json({
          error: 'OCR trả về dữ liệu không đúng định dạng (không phải JSON). Vui lòng thử lại (có thể đổi ảnh rõ hơn).',
          step: 'ocr',
          retryable: true,
        }, { status: 502 });
      }
      return NextResponse.json({
        error: `OCR thất bại: ${msg}`,
        step: 'ocr',
        retryable: true,
      }, { status: 502 });
    }

    console.log(`[API] OCR done: ${invoiceData.invoice_metadata.vendor_name} — ${invoiceData.invoice_metadata.date}`);
    if (ocrMeta) console.log(`[API] OCR model: ${ocrMeta.provider}/${ocrMeta.model}${ocrMeta.fallbackUsed ? ' (fallback)' : ''}`);

    // ── Step 5: Upload to Supabase Storage ────────────────────────────
    console.log('[API] Uploading to Supabase Storage...');
    let imageUrl: string;
    try {
      imageUrl = await uploadInvoiceImage(
        optimized.buffer,
        invoiceData.invoice_metadata.vendor_name,
        invoiceData.invoice_metadata.date
      );
    } catch (storageError) {
      const msg = (storageError as Error).message;
      console.error('[API] Storage upload failed:', msg);
      return NextResponse.json({
        error: `Upload ảnh thất bại: ${msg}`,
        step: 'storage',
      }, { status: 502 });
    }

    // ── Step 6: Save to Database ──────────────────────────────────────
    console.log('[API] Saving to database...');
    const saveResult = await saveInvoice(invoiceData, imageUrl);

    if (saveResult.duplicate) {
      return NextResponse.json({
        warning: `Hóa đơn trùng lặp đã được phát hiện (ID: ${saveResult.invoiceId}). Không tạo bản ghi mới.`,
        invoiceId: saveResult.invoiceId,
        duplicate: true,
        data: invoiceData,
        imageUrl,
      }, { status: 409 });
    }

    if (!saveResult.success) {
      return NextResponse.json({
        error: `Lưu database thất bại: ${saveResult.error}`,
        step: 'database',
      }, { status: 500 });
    }

    // ── Step 7: Return success ─────────────────────────────────────────
    return NextResponse.json({
      success: true,
      invoiceId: saveResult.invoiceId,
      imageUrl,
      data: invoiceData,
      ocr: ocrMeta,
      meta: {
        originalSizeKB: (inputBuffer.length / 1024).toFixed(0),
        optimizedSizeKB: optimized.sizeKB.toFixed(0),
        dimensions: `${optimized.width}x${optimized.height}`,
      },
    }, { status: 200 });

  } catch (err) {
    const msg = (err as Error).message;
    console.error('[API] Unhandled error:', msg);
    return NextResponse.json({
      error: `Server error: ${msg}`,
      step: 'unknown',
    }, { status: 500 });
  }
}
