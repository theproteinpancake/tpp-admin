// Server-side page guards for role/section access. Use in section layout.tsx files.
import { redirect } from 'next/navigation';
import { getCurrentUser, canAccess, isOwner, allowedSections, passwordExpired, type Section } from './auth';

export function sectionHome(s: Section): string {
  return s === 'app' ? '/app'
    : s === 'logistics' ? '/logistics/assistant'
    : s === 'wholesale' ? '/wholesale'
    : s === 'analytics' ? '/analytics'
    : '/marketing/influencers';
}

// Password policy is mandatory for every account (Amazon SP-API security requirement, Jul 2026):
// every account needs its own password meeting the strength policy, rotated at least yearly.
// Checked before MFA so a brand-new/break-glass-only account (no password_hash at all, e.g. an
// owner who's only ever used ADMIN_PASSWORD) sets a real password first, then enrolls MFA.
// /password-update itself doesn't call either guard (would redirect-loop to itself).
function requirePasswordFresh(user: any) {
  if (passwordExpired(user)) redirect('/password-update');
}

// MFA is mandatory for every account (decided Jun 2026). Runs after the login-cookie check in
// both guards below, so it can't affect logging IN — only what a session can reach afterwards.
// /mfa-setup itself doesn't call either guard (would redirect-loop to itself).
function requireMfaEnrolled(user: any) {
  if (!user.totp_enabled) redirect('/mfa-setup');
}

// Require the signed-in user to have access to `section`, else bounce to their own home.
export async function requireSection(section: Section) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  requirePasswordFresh(user);
  requireMfaEnrolled(user);
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
  requirePasswordFresh(user);
  requireMfaEnrolled(user);
  if (!isOwner(user)) {
    const secs = allowedSections(user);
    redirect(secs.length ? sectionHome(secs[0]) : '/settings');
  }
  return user;
}
