import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { password } = await request.json();

  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    console.error('ADMIN_PASSWORD environment variable not set');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  if (password === adminPassword) {
    const response = NextResponse.json({ success: true });

    // Set a secure HTTP-only cookie
    response.cookies.set('tpp-admin-auth', 'authenticated', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    return response;
  }

  return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
}
