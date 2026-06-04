import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/xero';

// Xero redirects here after consent.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const cookieState = req.cookies.get('xero_oauth_state')?.value;

  const back = (q: string) => NextResponse.redirect(new URL(`/logistics/purchase-orders?${q}`, req.url));

  if (error) return back(`xero=error&msg=${encodeURIComponent(error)}`);
  if (!code) return back('xero=error&msg=no_code');
  if (!state || state !== cookieState) return back('xero=error&msg=state_mismatch');

  try {
    const { chosen } = await exchangeCode(code);
    return back(`xero=connected&org=${encodeURIComponent(chosen || '')}`);
  } catch (e) {
    return back(`xero=error&msg=${encodeURIComponent(String(e).slice(0, 120))}`);
  }
}
