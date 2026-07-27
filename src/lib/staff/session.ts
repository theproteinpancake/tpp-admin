import "server-only";
import { db } from "./supabase";
import { getCurrentUser } from "../auth";
import type { MemberRow } from "./database.types";

/**
 * Identity bridge. Reece's standalone tracker used a name-picker plus one shared team PIN,
 * with its own signed cookie. Inside TPP Control that's replaced wholesale by the dashboard
 * session (real per-person accounts, password policy, MFA) — two session systems on one
 * origin would be a security downgrade, and the PIN was never authentication anyway.
 *
 * Every server action still funnels through requireMember() and every read through
 * currentMember(), exactly as before — only the inside of these two functions changed, which
 * is why the other ~50 call sites are untouched.
 *
 * staff_members.app_user_id is the join. A dashboard user who has never opened the tracker
 * gets a member row created on first visit, so nobody has to be provisioned twice.
 */
export async function currentMember(): Promise<MemberRow | null> {
  const user = await getCurrentUser();
  if (!user?.id) return null;

  const { data: existing } = await db()
    .from("staff_members")
    .select("*")
    .eq("app_user_id", user.id)
    .maybeSingle();
  if (existing) return existing;

  // First visit: ADOPT an existing unlinked row before creating anything. Matching is on the
  // first name, because the tracker was seeded with what people are called ("Reece", "Debbie")
  // while the dashboard stores full names ("Luke Rolls") — a strict match would miss and mint
  // a second copy of the same person. Creating a duplicate is the worst outcome here: it
  // splits their tasks in two and leaves the new row with no phone number to ping.
  const fullName = (user.name || user.email.split("@")[0]).trim();
  const firstName = fullName.split(/\s+/)[0];

  const { data: candidates } = await db()
    .from("staff_members")
    .select("*")
    .is("app_user_id", null)
    .ilike("name", `${firstName}%`);

  const adopt = (candidates ?? [])[0];
  if (adopt) {
    const { data: linked } = await db()
      .from("staff_members")
      .update({ app_user_id: user.id, name: fullName })
      .eq("id", adopt.id)
      .select("*")
      .maybeSingle();
    return linked ?? adopt;
  }

  const initials = fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part: string) => part.charAt(0).toUpperCase())
    .join("");
  const { data: created, error } = await db()
    .from("staff_members")
    .insert({ app_user_id: user.id, name: fullName, initials, sort_order: 99 })
    .select("*")
    .maybeSingle();
  if (created) return created;

  // Name is unique: a clash means their row already exists but is linked to a different
  // account (e.g. someone re-created in Settings). Claim it rather than leaving them
  // memberless — one person, one row, always.
  if (error) {
    const { data: clash } = await db()
      .from("staff_members")
      .select("*")
      .ilike("name", fullName)
      .maybeSingle();
    if (clash) {
      const { data: relinked } = await db()
        .from("staff_members")
        .update({ app_user_id: user.id })
        .eq("id", clash.id)
        .select("*")
        .maybeSingle();
      return relinked ?? clash;
    }
  }
  return null;
}

/**
 * Server Actions are reachable by direct POST, not just through the UI, so every action
 * calls this before touching data. (The section guard in the layout protects page loads;
 * it does not protect actions — Reece's note about auth being per-action still applies.)
 */
export async function requireMember(): Promise<MemberRow> {
  const member = await currentMember();
  if (!member) throw new Error("Your session has expired — please sign in again.");
  return member;
}
