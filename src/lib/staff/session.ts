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
  if (!user) return null;

  const { data: existing } = await db()
    .from("staff_members")
    .select("*")
    .eq("app_user_id", user.uid)
    .maybeSingle();
  if (existing) return existing;

  // First visit: adopt a name-matched row (the seeded team) before creating a new one, so a
  // fresh login doesn't orphan the tasks already assigned to that person.
  const name = user.email.split("@")[0];
  const { data: byName } = await db()
    .from("staff_members")
    .select("*")
    .ilike("name", `${name}%`)
    .is("app_user_id", null)
    .maybeSingle();

  if (byName) {
    const { data: linked } = await db()
      .from("staff_members")
      .update({ app_user_id: user.uid })
      .eq("id", byName.id)
      .select("*")
      .maybeSingle();
    return linked ?? byName;
  }

  const display = name.charAt(0).toUpperCase() + name.slice(1);
  const { data: created } = await db()
    .from("staff_members")
    .insert({
      app_user_id: user.uid,
      name: display,
      initials: display.slice(0, 2).toUpperCase(),
      sort_order: 99,
    })
    .select("*")
    .maybeSingle();

  return created ?? null;
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
