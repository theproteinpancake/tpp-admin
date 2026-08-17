// ShipBob daily inventory snapshot — migrated to the 2026-01 API (legacy /1.0 cut off ~9 Aug
// 2026; snapshots froze at 9 Aug and every stock read in the app silently went stale).
//
// /1.0/product carried per-FC quantities; 2026-01 moved quantities to /inventory-level, which
// returns ACCOUNT totals per inventory id. That is equivalent here because each token is a
// separate ShipBob account with exactly one FC (AU → Altona, UK → Manchester), so account
// totals ARE the site's numbers.
//
// One behaviour deliberately dropped: the old function self-discovered new inventory ids from
// the product list and upserted product_locations. This version reads the EXISTING
// product_locations mapping (inventory ids are stable and new SKUs are rare) — when a new
// product is added to ShipBob, map it in product_locations for it to appear in snapshots.
//
// DEPLOYED OUT-OF-BAND: this source is the repo copy of the Supabase edge function
// `shipbob-snapshot` (project pwvcufaxiwgnnratbytb). Deploy changes with the Supabase MCP/CLI —
// pushing this repo does NOT update the function.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKENS: Record<string, string | undefined> = {
  ALTONA: Deno.env.get("SHIPBOB_API_TOKEN"),
  MANCHESTER: Deno.env.get("SHIPBOB_API_TOKEN_UK"),
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function levelsFor(token: string, ids: number[]): Promise<Map<number, any>> {
  const out = new Map<number, any>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    for (let a = 0; a < 6; a++) {
      const res = await fetch(
        `https://api.shipbob.com/2026-01/inventory-level?InventoryIds=${chunk.join(",")}&PageSize=250`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const j = await res.json();
        for (const it of (j.items ?? j ?? [])) out.set(Number(it.inventory_id), it);
        break;
      }
      if ([403, 429, 502, 503].includes(res.status)) { await sleep(2500 + a * 2000); continue; }
      throw new Error(`ShipBob ${res.status}: ${await res.text()}`);
    }
    await sleep(400);
  }
  return out;
}

Deno.serve(async (_req: Request) => {
  const started = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const sb = createClient(SB_URL, SB_KEY);

  const { data: locations, error: locErr } = await sb
    .from("locations").select("id, code").in("code", Object.keys(TOKENS));
  if (locErr) return Response.json({ error: locErr.message }, { status: 500 });

  const { data: pls, error: plErr } = await sb
    .from("product_locations")
    .select("product_id, location_id, shipbob_inventory_id, active")
    .eq("active", true);
  if (plErr) return Response.json({ error: plErr.message }, { status: 500 });

  const summary: Record<string, unknown> = { date: today, sites: {} };

  for (const loc of locations ?? []) {
    const token = TOKENS[loc.code];
    if (!token) { (summary.sites as any)[loc.code] = { skipped: "no token configured" }; continue; }
    const mine = (pls ?? []).filter((p: any) => p.location_id === loc.id && p.shipbob_inventory_id);
    if (!mine.length) { (summary.sites as any)[loc.code] = { skipped: "no mapped inventory ids" }; continue; }
    try {
      const levels = await levelsFor(token, mine.map((p: any) => Number(p.shipbob_inventory_id)));
      const rows = mine.map((p: any) => {
        const lv = levels.get(Number(p.shipbob_inventory_id));
        if (!lv) return null;
        return {
          snapshot_date: today, location_id: loc.id, product_id: p.product_id,
          on_hand: lv.total_on_hand_quantity ?? 0,
          available: lv.total_fulfillable_quantity ?? 0,
          committed: lv.total_committed_quantity ?? 0,
          inbound: 0, source: "shipbob",
        };
      }).filter(Boolean) as any[];
      if (rows.length) {
        await sb.from("inventory_snapshots").upsert(rows, { onConflict: "snapshot_date,location_id,product_id" });
      }
      (summary.sites as any)[loc.code] = { mapped_ids: mine.length, snapshots_written: rows.length };
    } catch (e) {
      (summary.sites as any)[loc.code] = { error: String(e) };
    }
  }

  summary.elapsed_ms = Date.now() - started;
  return Response.json(summary);
});
