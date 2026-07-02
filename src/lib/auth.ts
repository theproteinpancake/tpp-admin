// Per-user auth: scrypt password hashing + signed identity cookie. Server-only.
// The gate cookie (tpp-admin-auth=authenticated) is unchanged so middleware + crons
// keep working; this adds a SEPARATE signed `tpp-user` cookie identifying who's in.
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { supabaseLogistics } from './supabase-logistics';

const sessionSecret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || process.env.CRON_SECRET || 'tpp-dev-secret';

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw: string, stored?: string | null): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, h] = stored.split(':');
  const cand = crypto.scryptSync(pw, salt, 64);
  const hb = Buffer.from(h, 'hex');
  return hb.length === cand.length && crypto.timingSafeEqual(hb, cand);
}

// Password policy (Amazon SP-API security requirement, Jul 2026): 12+ chars, mixed case,
// a digit, a special char, and a max 365-day age before it must be rotated.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_AGE_DAYS = 365;
export function passwordPolicyError(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include a special character (e.g. ! @ # $ %).';
  return null;
}
// True if this account needs a (re)set: no password yet, never rotated, or older than the max age.
export function passwordExpired(user: { password_hash?: string | null; password_changed_at?: string | null }): boolean {
  if (!user?.password_hash) return true;
  if (!user.password_changed_at) return true;
  return Date.now() - new Date(user.password_changed_at).getTime() > PASSWORD_MAX_AGE_DAYS * 86400_000;
}

export interface SessionUser { uid: string; email: string; role: string; sections?: string[] }
export function signSession(u: SessionUser): string {
  const data = Buffer.from(JSON.stringify(u)).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}
export function readSession(cookie?: string | null): SessionUser | null {
  if (!cookie || !cookie.includes('.')) return null;
  const [data, sig] = cookie.split('.');
  const exp = crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
  if (exp.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(sig))) return null;
  try { return JSON.parse(Buffer.from(data, 'base64url').toString()); } catch { return null; }
}

export async function getUserByEmail(email: string) {
  const { data } = await supabaseLogistics.from('app_users').select('*').ilike('email', email.trim()).maybeSingle();
  return data as any;
}

// Current logged-in user (from the signed identity cookie), re-validated against the DB.
export async function getCurrentUser(): Promise<any | null> {
  const c = (await cookies()).get('tpp-user')?.value;
  const s = readSession(c);
  if (!s) return null;
  const { data } = await supabaseLogistics.from('app_users').select('*').eq('id', s.uid).maybeSingle();
  return (data as any) || null;
}

export function newSetupToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

// "Remember this device" for 2FA — a signed cookie binding a device to a user for N days,
// so the TOTP code is only asked once per device per period.
export const REMEMBER_DAYS = 30;
export function signRemember(uid: string): string {
  const exp = Date.now() + REMEMBER_DAYS * 86400_000;
  const data = Buffer.from(JSON.stringify({ uid, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}
export function readRemember(cookie?: string | null): string | null {
  if (!cookie || !cookie.includes('.')) return null;
  const [data, sig] = cookie.split('.');
  const exp = crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
  if (exp.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(sig))) return null;
  try { const p = JSON.parse(Buffer.from(data, 'base64url').toString()); return p.exp && p.exp > Date.now() ? p.uid : null; } catch { return null; }
}

// ---------- Roles & section access ----------
// Top-level dashboard sections, matched against URL prefixes by the nav + page guards.
export const ALL_SECTIONS = ['analytics', 'logistics', 'wholesale', 'marketing', 'app'] as const;
export type Section = (typeof ALL_SECTIONS)[number];

export const ROLES: { value: string; label: string; sections: Section[] }[] = [
  { value: 'owner', label: 'Owner (full access)', sections: [...ALL_SECTIONS] },
  { value: 'wholesale', label: 'Wholesale & Marketing', sections: ['wholesale', 'marketing'] },
  { value: 'marketing', label: 'Marketing only', sections: ['marketing'] },
  { value: 'logistics', label: 'Logistics & App', sections: ['app', 'logistics'] },
  { value: 'staff', label: 'Staff (custom)', sections: [] },
];

export function isOwner(user?: { role?: string } | null): boolean {
  return !!user && (user.role === 'owner' || user.role === 'admin');
}

// Effective sections for a user: owner = all; else explicit per-user override, else role default.
export function allowedSections(user?: { role?: string; sections?: string[] | null } | null): Section[] {
  if (!user) return [];
  if (isOwner(user)) return [...ALL_SECTIONS];
  if (Array.isArray(user.sections) && user.sections.length) {
    return user.sections.filter((s): s is Section => (ALL_SECTIONS as readonly string[]).includes(s));
  }
  return ROLES.find((r) => r.value === user.role)?.sections ?? [];
}

export function canAccess(user: { role?: string; sections?: string[] | null } | null, section: Section): boolean {
  return allowedSections(user).includes(section);
}
