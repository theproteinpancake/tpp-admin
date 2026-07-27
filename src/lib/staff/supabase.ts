import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * The tracker shares the dashboard's Supabase project (tpp-dashboard) rather than standing
 * up its own: the service-role key is already in the deployment, there's one database to
 * back up, and tracker rows can reference app_users directly. Its tables are namespaced
 * staff_* because that schema also holds logistics/analytics data.
 *
 * Service-role only, server-side only. RLS is on with NO policies on every staff_ table, so
 * this data is unreachable with a publishable key. Never import into a client component.
 */
export const ATTACHMENT_BUCKET = "task-attachments";

export class MissingConfigError extends Error {
  constructor() {
    super("LOGISTICS_SUPABASE_SERVICE_KEY is not set");
    this.name = "MissingConfigError";
  }
}

function configuredKey(): string | null {
  return process.env.LOGISTICS_SUPABASE_SERVICE_KEY?.trim() || null;
}

export function serviceRoleKey(): string {
  const key = configuredKey();
  if (!key) throw new MissingConfigError();
  return key;
}

export function isConfigured(): boolean {
  return !!configuredKey() && !!process.env.LOGISTICS_SUPABASE_URL;
}

let client: SupabaseClient<Database> | null = null;

export function db(): SupabaseClient<Database> {
  if (!client) {
    client = createClient<Database>(process.env.LOGISTICS_SUPABASE_URL!, serviceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
