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

export interface SessionUser { uid: string; email: string; role: string }
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

// ---------- Roles & section access ----------
// Top-level dashboard sections, matched against URL prefixes by the nav + page guards.
export const ALL_SECTIONS = ['app', 'logistics', 'wholesale', 'marketing'] as const;
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
