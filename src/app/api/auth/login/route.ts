import { NextRequest, NextResponse } from 'next/server';
import { twoFAEnabled, twoFASecret } from '@/lib/settings';
import { verifyTotp } from '@/lib/totp';

export async function POST(request: NextRequest) {
  const { password, token } = await request.json();

  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    console.error('ADMIN_PASSWORD environment variable not set');
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  if (password === adminPassword) {
    // 2FA gate — only enforced once enabled in Settings (default off, no lockout risk)
    if (await twoFAEnabled().catch(() => false)) {
      const secret = await twoFASecret();
      if (!token) return NextResponse.json({ error: '2fa_required', twofa: true }, { status: 401 });
      if (!secret || !verifyTotp(secret, String(token))) return NextResponse.json({ error: 'Invalid code', twofa: true }, { status: 401 });
    }
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
