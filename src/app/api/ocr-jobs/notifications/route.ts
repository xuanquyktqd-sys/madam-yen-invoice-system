import { NextRequest, NextResponse } from 'next/server';
import { listFinishedOcrJobs } from '@/lib/ocr-jobs';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

type InvoiceRow = {
  id: string;
  vendor_name: string;
  invoice_number: string | null;
  invoice_date: string | null;
  total_amount: string | number | null;
};

export async function GET(request: NextRequest) {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10)));
    const jobs = await listFinishedOcrJobs(limit);

    const invoiceIds = jobs.map((j) => j.invoice_id).filter(Boolean) as string[];
    const invoiceById = new Map<string, InvoiceRow>();

    if (invoiceIds.length) {
      const { data, error } = await supabaseAdmin
        .from('invoices')
        .select('id,vendor_name,invoice_number,invoice_date,total_amount')
        .in('id', invoiceIds);

      if (!error && Array.isArray(data)) {
        for (const row of data as InvoiceRow[]) {
          invoiceById.set(row.id, row);
        }
      }
    }

    return NextResponse.json({
      notifications: jobs.map((job) => {
        const inv = job.invoice_id ? invoiceById.get(job.invoice_id) : null;
        return {
          id: job.id,
          status: job.status,
          invoice_id: job.invoice_id,
          public_url: job.public_url,
          attempts: job.attempts,
          max_attempts: job.max_attempts,
          error_code: job.error_code,
          error_message: job.error_message,
          ocr_provider: job.ocr_provider,
          ocr_model: job.ocr_model,
          created_at: job.created_at,
          finished_at: job.finished_at,
          invoice: inv
            ? {
                id: inv.id,
                vendor_name: inv.vendor_name,
                invoice_number: inv.invoice_number,
                invoice_date: inv.invoice_date,
                total_amount: inv.total_amount,
              }
            : null,
        };
      }),
    });
  } catch (err) {
    console.error('[API/ocr-jobs/notifications GET]', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

