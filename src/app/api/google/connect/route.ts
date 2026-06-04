import { NextResponse } from 'next/server';
import { googleAuthorizeUrl, googleConfigured } from '@/lib/google';

export async function GET() {
  if (!googleConfigured()) return NextResponse.json({ error: 'Google env not configured' }, { status: 500 });
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const res = NextResponse.redirect(googleAuthorizeUrl(state));
  res.cookies.set('google_oauth_state', state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 });
  return res;
}
