import { NextResponse } from 'next/server';
import { createOAuth2Client, SCOPES } from '@/lib/google-auth';

export async function GET() {
  const oauth2Client = createOAuth2Client();
  
  // Tạo URL yêu cầu xác thực từ Google
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Để lấy refresh_token dùng lâu dài
    scope: SCOPES,
    prompt: 'consent', // Luôn hiện bảng hỏi quyền để đảm bảo lấy được refresh_token
  });

  return NextResponse.redirect(authUrl);
}
