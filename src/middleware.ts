import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow access to login page and auth API routes
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

  // Check for auth cookie
  const authCookie = request.cookies.get('tpp-admin-auth');

  if (!authCookie || authCookie.value !== 'authenticated') {
    // Redirect to login page
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
