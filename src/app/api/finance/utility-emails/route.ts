import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Migration & API cho Utility Sync Emails
export async function GET() {
  try {
    // Tự động tạo bảng nếu chưa có
    await pool.query(`
      CREATE TABLE IF NOT EXISTS utility_sync_emails (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        provider_name TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    const res = await pool.query('SELECT * FROM utility_sync_emails ORDER BY created_at DESC');
    return NextResponse.json({ emails: res.rows });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { email, provider_name } = await req.json();
    if (!email) return NextResponse.json({ error: 'Email là bắt buộc' }, { status: 400 });

    const res = await pool.query(
      'INSERT INTO utility_sync_emails (email, provider_name) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET provider_name = EXCLUDED.provider_name RETURNING *',
      [email.trim().toLowerCase(), provider_name || '']
    );
    return NextResponse.json({ email: res.rows[0] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    await pool.query('DELETE FROM utility_sync_emails WHERE id = $1', [id]);
    return NextResponse.json({ message: 'Đã xóa' });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
