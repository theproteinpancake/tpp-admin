import { NextRequest, NextResponse } from 'next/server';

// Domain API prefixes → the section a user must have to call them. Anything not listed
// (auth, me, google, mux, shopify, crons, webhooks) is not section-gated here.
const API_SECTION: { prefix: string; section: string }[] = [
  { prefix: '/api/analytics', section: 'analytics' },
  { prefix: '/api/marketing', section: 'marketing' },
  { prefix: '/api/wholesale/customer', section: 'wholesale' },
  { prefix: '/api/xero/sync-wholesale', section: 'wholesale' },
  { prefix: '/api/logistics', section: 'logistics' },
  { prefix: '/api/assistant', section: 'logistics' },
];

const sessionSecret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || process.env.CRON_SECRET || 'tpp-dev-secret';

function b64urlToBytes(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function bytesToB64url(buf: ArrayBuffer): string {
  let s = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Verify the signed `tpp-user` cookie with Web Crypto (Edge-safe). Returns the payload or null.
async function readSessionEdge(cookie?: string | null): Promise<{ role?: string; sections?: string[] } | null> {
  if (!cookie || !cookie.includes('.')) return null;
  const [data, sig] = cookie.split('.');
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(sessionSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    if (bytesToB64url(mac) !== sig) return null;
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(data)));
  } catch { return null; }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow login + self-authenticated / pre-auth routes
  if (
    pathname === '/login' ||
    pathname === '/setup' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/whatsapp') || // Twilio webhook + cron briefing (self-authenticated)
    pathname.startsWith('/api/transfers') || // transfer doc PDFs (downloads + Twilio media fetch)
    pathname.startsWith('/api/gmail') || // cron gmail scour (cron-secret authenticated)
    pathname.startsWith('/_next') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Auth gate
  const authCookie = request.cookies.get('tpp-admin-auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // API section RBAC (defense-in-depth; pages are also guarded server-side).
  // Fail-open: if the signed session is missing/old/unreadable, don't block (page guards + re-login cover it).
  const match = API_SECTION.find((m) => pathname.startsWith(m.prefix));
  if (match) {
    const session = await readSessionEdge(request.cookies.get('tpp-user')?.value);
    const isOwner = session?.role === 'owner' || session?.role === 'admin';
    if (session && !isOwner && Array.isArray(session.sections) && !session.sections.includes(match.section)) {
      return NextResponse.json({ error: 'forbidden', need: match.section }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
