import { NextRequest, NextResponse } from 'next/server';
import { listInvoices, getAttachment } from '@/lib/gmail-service';
import { extractInvoiceData } from '@/lib/ocr-service';
import { Pool } from 'pg';
import pLimit from 'p-limit';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const limit = pLimit(2); // Chỉ xử lý 2 mail cùng lúc để tránh quá tải OCR

export async function POST(req: NextRequest) {
  try {
    // 1. Đảm bảo DB có cột gmail_message_id (Migration nhanh)
    await pool.query(`
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gmail_message_id TEXT UNIQUE;
      ALTER TABLE utility_bills ADD COLUMN IF NOT EXISTS gmail_message_id TEXT UNIQUE;
    `).catch(e => console.error('Migration error (ignore if already exists):', e));

    // 1. Lấy danh sách email được phép quét từ DB
    const emailsRes = await pool.query('SELECT email FROM utility_sync_emails');
    const allowedEmails = emailsRes.rows.map(r => r.email);

    if (allowedEmails.length === 0) {
      return NextResponse.json({ 
        message: 'Chưa cấu hình email nhà cung cấp. Hãy vào Cài đặt -> Đồng bộ Gmail để thêm email.' 
      }, { status: 400 });
    }

    // 2. Xây dựng query Gmail: (from:a@b.com OR from:c@d.com) has:attachment
    const fromQuery = allowedEmails.map(email => `from:${email}`).join(' OR ');
    const query = `(${fromQuery}) has:attachment`;

    // 3. Lấy danh sách mail mới nhất từ Gmail
    const gmail = await import('@/lib/gmail-service').then(m => m.getGmailClient());
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 15,
    });
    
    const messages = res.data.messages || [];
    if (!messages.length) {
      return NextResponse.json({ message: 'Không tìm thấy hóa đơn mới từ các email đã cấu hình.' });
    }

    const results = [];

    // 4. Xử lý từng mail
    const tasks = messages.map((msg) => 
      limit(async () => {
        const messageId = msg.id!;
        
        // Kiểm tra xem mail này đã được xử lý chưa (chỉ check utility_bills)
        const alreadyInUtility = await pool.query('SELECT id FROM utility_bills WHERE gmail_message_id = $1', [messageId]);
        
        if (alreadyInUtility.rowCount! > 0) {
          return { messageId, status: 'skipped', reason: 'Đã tồn tại' };
        }

        try {
          const fullMsg = await gmail.users.messages.get({ userId: 'me', id: messageId });
          const parts = fullMsg.data.payload?.parts || [];
          
          // Tìm file đính kèm là PDF hoặc Ảnh
          const attachmentPart = parts.find(p => 
            p.filename && (p.mimeType?.includes('pdf') || p.mimeType?.includes('image'))
          );

          if (!attachmentPart || !attachmentPart.body?.attachmentId) {
            return { messageId, status: 'skipped', reason: 'Không có file đính kèm' };
          }

          const base64Data = await import('@/lib/gmail-service').then(m => m.getAttachment(messageId, attachmentPart.body!.attachmentId!));
          if (!base64Data) {
            return { messageId, status: 'skipped', reason: 'Dữ liệu file trống' };
          }
          
          const buffer = Buffer.from(base64Data, 'base64');

          const { data: ocrData } = await extractInvoiceData(buffer);
          
          // Lưu tất cả vào utility_bills theo yêu cầu của người dùng
          await pool.query(
            `INSERT INTO utility_bills (category, supplier, bill_number, total_amount, gmail_message_id, expense_date) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            ['other', ocrData.invoice_metadata.vendor_name, ocrData.invoice_metadata.invoice_number, 0, messageId, ocrData.invoice_metadata.date]
          );

          return { messageId, vendor: ocrData.invoice_metadata.vendor_name, status: 'success' };
        } catch (err) {
          return { messageId, status: 'error', reason: (err as Error).message };
        }
      })
    );

    const processed = await Promise.all(tasks);

    return NextResponse.json({
      message: 'Đã hoàn thành quét Gmail',
      results: processed
    });

  } catch (err) {
    console.error('Gmail sync error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
