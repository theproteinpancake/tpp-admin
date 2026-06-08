// Server-side page guards for role/section access. Use in section layout.tsx files.
import { redirect } from 'next/navigation';
import { getCurrentUser, canAccess, isOwner, allowedSections, type Section } from './auth';

export function sectionHome(s: Section): string {
  return s === 'app' ? '/app'
    : s === 'logistics' ? '/logistics/assistant'
    : s === 'wholesale' ? '/wholesale'
    : s === 'analytics' ? '/analytics'
    : '/marketing/influencers';
}

// Require the signed-in user to have access to `section`, else bounce to their own home.
export async function requireSection(section: Section) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!canAccess(user, section)) {
    const secs = allowedSections(user);
    redirect(secs.length ? sectionHome(secs[0]) : '/settings');
  }
  return user;
}

// Owner-only areas (e.g. staff management).
export async function requireOwner() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!isOwner(user)) {
    const secs = allowedSections(user);
    redirect(secs.length ? sectionHome(secs[0]) : '/settings');
  }
  return user;
}
