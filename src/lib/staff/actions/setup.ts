"use server";

import { headers } from "next/headers";
import { requireMember } from "@/lib/staff/session";
import { ingestToken } from "@/lib/staff/ingest-token";

export type IngestSetup = {
  endpoint: string;
  token: string;
  parsingEnabled: boolean;
  shopifyEnabled: boolean;
};

/**
 * Everything needed to configure the Mac listener. Fetched on demand rather
 * than shipped with every page, so the token only reaches the browser when
 * somebody actually opens Settings.
 */
export async function getIngestSetup(): Promise<IngestSetup> {
  await requireMember();

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";

  return {
    endpoint: `${protocol}://${host}/api/ingest`,
    token: ingestToken(),
    parsingEnabled: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    shopifyEnabled: Boolean(
      process.env.SHOPIFY_STORE_DOMAIN?.trim() &&
        process.env.SHOPIFY_ADMIN_TOKEN?.trim(),
    ),
  };
}
