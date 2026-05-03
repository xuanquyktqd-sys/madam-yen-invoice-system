import { google } from 'googleapis';
import { createOAuth2Client } from './google-auth';

export async function getGmailClient() {
  const oauth2Client = createOAuth2Client();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error('GOOGLE_REFRESH_TOKEN is not set in environment variables');
  }

  oauth2Client.setCredentials({
    refresh_token: refreshToken
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export async function listInvoices() {
  const gmail = await getGmailClient();
  
  // Tìm kiếm email có file đính kèm và chứa từ khóa "invoice" hoặc "tax invoice"
  // Mày có thể tinh chỉnh query này cho chuẩn hơn
  const query = 'has:attachment (invoice OR "tax invoice" OR "hóa đơn")';
  
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 10, // Quét 10 cái mới nhất mỗi lần
  });

  return res.data.messages || [];
}

export async function getAttachment(messageId: string, attachmentId: string) {
  const gmail = await getGmailClient();
  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: messageId,
    id: attachmentId,
  });

  return res.data.data; // Đây là nội dung file dạng base64url
}
