import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { serviceRoleKey } from "./supabase";

/**
 * The bearer token the Mac agent presents when posting messages.
 *
 * Derived from the service role key rather than stored separately, so the
 * deployment still needs only one secret. It's shown in Settings so the token
 * can be copied into the agent's config without anyone handling the database
 * key itself.
 */
export function ingestToken(): string {
  return createHmac("sha256", serviceRoleKey())
    .update("tpp-ingest-v1")
    .digest("base64url");
}

export function ingestTokenMatches(candidate: string): boolean {
  const expected = Buffer.from(ingestToken());
  const given = Buffer.from(candidate ?? "");
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
