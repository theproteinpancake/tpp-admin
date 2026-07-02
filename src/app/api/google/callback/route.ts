import { NextRequest, NextResponse } from 'next/server';
import { googleExchangeCode } from '@/lib/google';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const cookieState = req.cookies.get('google_oauth_state')?.value;
  const back = (q: string) => NextResponse.redirect(new URL(`/settings?${q}`, req.url));

  // account is encoded as the prefix of state ("account~random")
  const accountRaw = (state || '').split('~')[0];
  const account = accountRaw && accountRaw !== 'primary' ? accountRaw : undefined;
  const which = account === 'ads' ? '&which=ads' : '';

  if (error) return back(`gmail=error${which}&msg=${encodeURIComponent(error)}`);
  if (!code) return back(`gmail=error${which}&msg=no_code`);
  if (!state || state !== cookieState) return back(`gmail=error${which}&msg=state_mismatch`);
  const redirectUri = req.cookies.get('google_oauth_redirect')?.value || undefined;
  try {
    const { email } = await googleExchangeCode(code, account, redirectUri);
    return back(`gmail=connected${which}&email=${encodeURIComponent(email || '')}`);
  } catch (e) {
    return back(`gmail=error${which}&msg=${encodeURIComponent(String(e).slice(0, 120))}`);
  }
}
