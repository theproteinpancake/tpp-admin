import { NextResponse } from 'next/server';
import { authorizeUrl } from '@/lib/xero';

// Kicks off the Xero OAuth consent flow.
export async function GET() {
  if (!process.env.XERO_CLIENT_ID || !process.env.XERO_REDIRECT_URI) {
    return NextResponse.json({ error: 'Xero env not configured' }, { status: 500 });
  }
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set('xero_oauth_state', state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 });
  return res;
}
