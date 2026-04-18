/**
 * Storage Service — Madam Yen IMS
 * Skill: supabase-storage-specialist.md
 *
 * Naming: YYYY/MM/vendor-name-DD-MM-uniqueid.jpg
 * Zero disk writes — Buffer only
 */

import { supabaseAdmin } from './supabase';
import { v4 as uuidv4 } from 'uuid';

const BUCKET = 'invoice-images';
const JOB_PREFIX = 'ocr-jobs';

/**
 * Build storage path: YYYY/MM/vendor-DD-MM-uuid.jpg
 */
function buildStoragePath(vendorName: string, invoiceDate: string): string {
  const date = new Date(invoiceDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  const vendorSlug = vendorName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 30);

  const uid = uuidv4().split('-')[0]; // Short UUID suffix

  return `${year}/${month}/${vendorSlug}-${day}-${month}-${uid}.jpg`;
}

/**
 * Upload image buffer directly to Supabase Storage.
 * Returns the public URL.
 * NO local file is ever written.
 */
export async function uploadInvoiceImage(
  imageBuffer: Buffer,
  vendorName: string,
  invoiceDate: string
): Promise<string> {
  const storagePath = buildStoragePath(vendorName, invoiceDate);

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, imageBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  // Get public URL
  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);

  if (!urlData?.publicUrl) {
    throw new Error('Failed to get public URL after upload');
  }

  console.log(`[Storage] ✅ Uploaded: ${storagePath}`);
  return urlData.publicUrl;
}

export function getInvoiceImageBucket(): string {
  return BUCKET;
}

export function getInvoiceImagePublicUrl(storagePath: string): string {
  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
  if (!data?.publicUrl) {
    throw new Error('Failed to get public URL');
  }
  return data.publicUrl;
}

export async function uploadOcrJobImage(
  imageBuffer: Buffer,
  jobId: string
): Promise<{ bucket: string; path: string; publicUrl: string }> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const storagePath = `${JOB_PREFIX}/${year}/${month}/${jobId}.jpg`;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, imageBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const publicUrl = getInvoiceImagePublicUrl(storagePath);
  console.log(`[Storage] ✅ OCR job image uploaded: ${storagePath}`);
  return { bucket: BUCKET, path: storagePath, publicUrl };
}

function tryGetStoragePathFromPublicUrl(publicUrl: string): string | null {
  try {
    const url = new URL(publicUrl);
    const prefix = `/storage/v1/object/public/${BUCKET}/`;
    if (!url.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

export async function deleteInvoiceImageByPublicUrl(publicUrl: string): Promise<boolean> {
  const path = tryGetStoragePathFromPublicUrl(publicUrl);
  if (!path) return false;

  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
  if (error) {
    throw new Error(`Storage delete failed: ${error.message}`);
  }
  console.log(`[Storage] ✅ Deleted: ${path}`);
  return true;
}
