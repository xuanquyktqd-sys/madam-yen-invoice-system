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

    // 2. Lấy danh sách mail mới nhất từ Gmail
    const messages = await listInvoices();
    if (!messages.length) {
      return NextResponse.json({ message: 'Không tìm thấy mail nào mới.' });
    }

    const results = [];

    // 3. Xử lý từng mail
    const tasks = messages.map((msg) => 
      limit(async () => {
        const messageId = msg.id!;
        
        // Kiểm tra xem mail này đã được xử lý chưa
        const alreadyInInvoices = await pool.query('SELECT id FROM invoices WHERE gmail_message_id = $1', [messageId]);
        const alreadyInUtility = await pool.query('SELECT id FROM utility_bills WHERE gmail_message_id = $1', [messageId]);
        
        if (alreadyInInvoices.rowCount! > 0 || alreadyInUtility.rowCount! > 0) {
          return { messageId, status: 'skipped', reason: 'Đã tồn tại' };
        }

        try {
          // Lấy chi tiết mail để tìm attachment
          const gmail = await import('@/lib/gmail-service').then(m => m.getGmailClient());
          const fullMsg = await gmail.users.messages.get({ userId: 'me', id: messageId });
          const parts = fullMsg.data.payload?.parts || [];
          
          // Tìm file đính kèm là PDF hoặc Ảnh
          const attachmentPart = parts.find(p => 
            p.filename && (p.mimeType?.includes('pdf') || p.mimeType?.includes('image'))
          );

          if (!attachmentPart || !attachmentPart.body?.attachmentId) {
            return { messageId, status: 'skipped', reason: 'Không có file đính kèm phù hợp' };
          }

          // Tải attachment
          const base64Data = await getAttachment(messageId, attachmentPart.body.attachmentId);
          if (!base64Data) throw new Error('Không thể tải file');
          
          const buffer = Buffer.from(base64Data, 'base64');

          // Chạy OCR
          const { data: ocrData } = await extractInvoiceData(buffer);
          
          // Quyết định lưu vào đâu (Ví dụ: Dựa trên tên nhà cung cấp hoặc nội dung)
          const vendorName = ocrData.invoice_metadata.vendor_name.toLowerCase();
          const isUtility = vendorName.includes('mercury') || vendorName.includes('genesis') || vendorName.includes('spark') || vendorName.includes('vodafone');

          if (isUtility) {
             // Lưu vào utility_bills
             await pool.query(
               `INSERT INTO utility_bills (category, supplier, bill_number, total_amount, gmail_message_id, expense_date) 
                VALUES ($1, $2, $3, $4, $5, $6)`,
               ['other', ocrData.invoice_metadata.vendor_name, ocrData.invoice_metadata.invoice_number, 0, messageId, ocrData.invoice_metadata.date]
             );
          } else {
             // Lưu vào invoices (Dùng logic đơn giản cho demo, mày nên dùng saveInvoice chuẩn của mày)
             await pool.query(
               `INSERT INTO invoices (vendor_name, invoice_number, total_amount, invoice_date, status, gmail_message_id) 
                VALUES ($1, $2, $3, $4, $5, $6)`,
               [ocrData.invoice_metadata.vendor_name, ocrData.invoice_metadata.invoice_number, 0, ocrData.invoice_metadata.date, 'pending_review', messageId]
             );
          }

          return { messageId, vendor: ocrData.invoice_metadata.vendor_name, status: 'success' };
        } catch (err) {
          console.error(`Error processing message ${messageId}:`, err);
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
