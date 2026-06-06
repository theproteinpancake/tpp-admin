import { NextRequest, NextResponse } from 'next/server';
import { googleAuthorizeUrl, googleConfigured } from '@/lib/google';

export async function GET(req: NextRequest) {
  if (!googleConfigured()) return NextResponse.json({ error: 'Google env not configured' }, { status: 500 });
  // ?account=kate connects a SECOND inbox (stored as provider google_kate); default = primary
  const url = new URL(req.url);
  const account = (url.searchParams.get('account') || 'primary').replace(/[^a-z0-9]/gi, '').toLowerCase();
  // use the CURRENT origin for the callback so it matches the live domain
  const redirectUri = `${url.origin}/api/google/callback`;
  const state = `${account}~${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const res = NextResponse.redirect(googleAuthorizeUrl(state, redirectUri));
  res.cookies.set('google_oauth_state', state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 });
  res.cookies.set('google_oauth_redirect', redirectUri, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 });
  return res;
}
