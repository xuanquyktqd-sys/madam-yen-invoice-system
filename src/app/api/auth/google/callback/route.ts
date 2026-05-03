import { NextRequest, NextResponse } from 'next/server';
import { createOAuth2Client } from '@/lib/google-auth';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.json({ error: `Google Auth Error: ${error}` }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: 'No code provided from Google' }, { status: 400 });
  }

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    
    // Ở bước này, tokens sẽ chứa access_token và refresh_token (nếu là lần đầu connect)
    // Sau này mày sẽ cần lưu refresh_token vào Database (Supabase) để dùng lâu dài.
    
    console.log('--- GOOGLE TOKENS RECEIVED ---');
    console.log('Refresh Token:', tokens.refresh_token);
    console.log('------------------------------');

    // Tạm thời trả về JSON để mày lấy Refresh Token điền vào .env
    return NextResponse.json({
      message: 'Kết nối Google thành công!',
      refresh_token: tokens.refresh_token || 'Đã có (không gửi lại lần 2)',
      hint: 'Hãy lưu Refresh Token này vào biến môi trường GOOGLE_REFRESH_TOKEN.'
    });
  } catch (err) {
    console.error('Callback error:', err);
    return NextResponse.json({ error: 'Failed to exchange code for tokens' }, { status: 500 });
  }
}
