import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true });

  // Clear the gate + identity cookies
  const clear = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: 0, path: '/' };
  response.cookies.set('tpp-admin-auth', '', clear);
  response.cookies.set('tpp-user', '', clear);

  return response;
}
