import { NextRequest, NextResponse } from 'next/server';
import { googleExchangeCode } from '@/lib/google';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const cookieState = req.cookies.get('google_oauth_state')?.value;
  const back = (q: string) => NextResponse.redirect(new URL(`/logistics/purchase-orders?${q}`, req.url));

  if (error) return back(`gmail=error&msg=${encodeURIComponent(error)}`);
  if (!code) return back('gmail=error&msg=no_code');
  if (!state || state !== cookieState) return back('gmail=error&msg=state_mismatch');
  try {
    const { email } = await googleExchangeCode(code);
    return back(`gmail=connected&email=${encodeURIComponent(email || '')}`);
  } catch (e) {
    return back(`gmail=error&msg=${encodeURIComponent(String(e).slice(0, 120))}`);
  }
}
