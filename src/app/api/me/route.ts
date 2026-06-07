import { NextResponse } from 'next/server';
import { getCurrentUser, allowedSections, isOwner } from '@/lib/auth';

// Identity + effective section access for the signed-in user (drives nav + UI gating).
export async function GET() {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({
    email: u.email, name: u.name || null, role: u.role,
    sections: allowedSections(u), isOwner: isOwner(u),
  });
}
