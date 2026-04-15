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

  const { data, error } = await supabaseAdmin.storage
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
