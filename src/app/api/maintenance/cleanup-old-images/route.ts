import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireRole } from '@/lib/auth';

const BUCKET = 'invoice-images';

type CleanupRequest = {
  olderThanMonths?: number;
  dryRun?: boolean;
  includeOcrJobImages?: boolean;
};

type StorageItem = {
  name: string;
  id?: string;
  updated_at?: string;
  created_at?: string;
  last_accessed_at?: string;
  metadata?: Record<string, unknown>;
};

function monthKeyFromDate(d: Date): number {
  return d.getFullYear() * 12 + d.getMonth(); // 0-indexed month
}

function parseYearFolder(name: string): number | null {
  if (!/^\d{4}$/.test(name)) return null;
  const year = Number(name);
  return Number.isFinite(year) ? year : null;
}

function parseMonthFolder(name: string): number | null {
  if (!/^\d{2}$/.test(name)) return null;
  const month = Number(name);
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return month;
}

async function listAllFiles(prefix: string): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  const limit = 100;

  // Supabase Storage list is not recursive; list "directories" and files at each level.
  // Our invoice images structure is: YYYY/MM/<filename>.jpg, so listing at YYYY/MM is enough.
  for (;;) {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(prefix, { limit, offset });

    if (error) throw new Error(error.message);
    const items = (data ?? []) as StorageItem[];
    if (items.length === 0) break;

    for (const it of items) {
      // Storage returns folders as items too; for our layout we only care about actual objects.
      // Heuristic: folders often have no `id`; objects have `id`.
      if (it.id) paths.push(`${prefix}/${it.name}`.replace(/^\//, ''));
    }

    if (items.length < limit) break;
    offset += limit;
  }

  return paths;
}

async function removeInBatches(paths: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { error } = await supabaseAdmin.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(error.message);
    deleted += batch.length;
  }
  return deleted;
}

export async function POST(req: NextRequest) {
  try {
    await requireRole(req, 'admin');
    const body = (await req.json().catch(() => ({}))) as CleanupRequest;
    const olderThanMonths = Math.max(1, Math.min(60, Number(body.olderThanMonths ?? 3)));
    const dryRun = !!body.dryRun;
    const includeOcrJobImages = !!body.includeOcrJobImages;

    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - olderThanMonths);
    const cutoffKey = monthKeyFromDate(cutoff);

    // 1) list top-level folders (years + "ocr-jobs")
    const { data: top, error: topErr } = await supabaseAdmin.storage.from(BUCKET).list('', { limit: 200, offset: 0 });
    if (topErr) throw new Error(topErr.message);
    const topItems = (top ?? []) as StorageItem[];

    const yearFolders = topItems
      .map((it) => it.name)
      .map(parseYearFolder)
      .filter((x): x is number => x !== null)
      .sort((a, b) => a - b);

    const monthsToDelete: Array<{ year: number; month: number; prefix: string }> = [];

    for (const year of yearFolders) {
      const { data: months, error: monthsErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .list(String(year), { limit: 200, offset: 0 });
      if (monthsErr) throw new Error(monthsErr.message);
      const monthItems = (months ?? []) as StorageItem[];
      for (const m of monthItems) {
        const month = parseMonthFolder(m.name);
        if (!month) continue;
        const key = year * 12 + (month - 1);
        if (key < cutoffKey) {
          monthsToDelete.push({ year, month, prefix: `${year}/${String(month).padStart(2, '0')}` });
        }
      }
    }

    // Optionally include ocr-jobs images cleanup (separate prefix).
    // These are under: ocr-jobs/YYYY/MM/<jobId>.jpg
    const ocrJobPrefixes: string[] = [];
    if (includeOcrJobImages) {
      const { data: jobYears, error: jobYearsErr } = await supabaseAdmin.storage.from(BUCKET).list('ocr-jobs', { limit: 200, offset: 0 });
      if (jobYearsErr) throw new Error(jobYearsErr.message);
      const jobYearItems = (jobYears ?? []) as StorageItem[];
      const parsedJobYears = jobYearItems
        .map((it) => it.name)
        .map(parseYearFolder)
        .filter((x): x is number => x !== null);
      for (const year of parsedJobYears) {
        const { data: jobMonths, error: jobMonthsErr } = await supabaseAdmin.storage.from(BUCKET).list(`ocr-jobs/${year}`, { limit: 200, offset: 0 });
        if (jobMonthsErr) throw new Error(jobMonthsErr.message);
        for (const m of (jobMonths ?? []) as StorageItem[]) {
          const month = parseMonthFolder(m.name);
          if (!month) continue;
          const key = year * 12 + (month - 1);
          if (key < cutoffKey) {
            ocrJobPrefixes.push(`ocr-jobs/${year}/${String(month).padStart(2, '0')}`);
          }
        }
      }
    }

    const prefixes = [
      ...monthsToDelete.map((x) => x.prefix),
      ...ocrJobPrefixes,
    ];

    // 2) list objects under each prefix and remove
    const plan: Record<string, number> = {};
    let totalPlanned = 0;
    let totalDeleted = 0;

    for (const prefix of prefixes) {
      const files = await listAllFiles(prefix);
      plan[prefix] = files.length;
      totalPlanned += files.length;
      if (!dryRun && files.length > 0) {
        totalDeleted += await removeInBatches(files);
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      bucket: BUCKET,
      olderThanMonths,
      cutoff: cutoff.toISOString(),
      prefixes,
      plan,
      totalPlanned,
      totalDeleted: dryRun ? 0 : totalDeleted,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'UNAUTHENTICATED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
