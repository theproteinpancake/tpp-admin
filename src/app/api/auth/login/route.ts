import { NextRequest, NextResponse } from 'next/server';
import { verifyTotp } from '@/lib/totp';
import { getUserByEmail, verifyPassword, signSession, allowedSections } from '@/lib/auth';
import { getConfig, twoFAEnabled, twoFASecret } from '@/lib/settings';

const setCookies = (res: NextResponse, user: { id: string; email: string; role: string; sections?: string[] | null }) => {
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: 60 * 60 * 24 * 7, path: '/' };
  res.cookies.set('tpp-admin-auth', 'authenticated', opts);            // gate (unchanged)
  res.cookies.set('tpp-user', signSession({ uid: user.id, email: user.email, role: user.role, sections: allowedSections(user) }), opts); // identity
  return res;
};

export async function POST(request: NextRequest) {
  const { email, password, token } = await request.json();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });

  const adminEmail = (await getConfig('admin_email')) || 'luke@theproteinpancake.co';
  const user = email ? await getUserByEmail(String(email)) : await getUserByEmail(adminEmail);

  // New user who hasn't set a password yet → send them to first-time setup.
  if (user && user.active && !user.password_hash && user.setup_token) {
    if (password !== adminPassword) return NextResponse.json({ error: 'setup_required', setup_required: true, email: user.email }, { status: 401 });
  }
  if (user && user.active === false) return NextResponse.json({ error: 'Account disabled' }, { status: 403 });

  // Verify credentials: per-user password, else ADMIN_PASSWORD break-glass for the admin.
  const isAdmin = (user?.role === 'admin') || (!email) || (String(email).toLowerCase() === adminEmail.toLowerCase());
  const okPerUser = !!user?.password_hash && verifyPassword(String(password), user.password_hash);
  const okFallback = isAdmin && password === adminPassword;
  if (!okPerUser && !okFallback) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });

  // 2FA: per-user secret if enabled; else (admin fallback) the legacy global gate.
  let needSecret: string | null = null;
  if (user?.totp_enabled && user.totp_secret) needSecret = user.totp_secret;
  else if (okFallback && await twoFAEnabled().catch(() => false)) needSecret = await twoFASecret();
  if (needSecret) {
    if (!token) return NextResponse.json({ error: '2fa_required', twofa: true }, { status: 401 });
    if (!verifyTotp(needSecret, String(token))) return NextResponse.json({ error: 'Invalid code', twofa: true }, { status: 401 });
  }

  const acct = user || { id: 'admin', email: adminEmail, role: 'admin' };
  return setCookies(NextResponse.json({ success: true, must_set_password: !user?.password_hash }), acct);
}
