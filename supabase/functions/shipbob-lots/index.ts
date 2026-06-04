// ShipBob lot/expiry capture — refreshes inventory_lots (batch + best-before) per site.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKENS: Record<string, string | undefined> = {
  ALTONA: Deno.env.get("SHIPBOB_API_TOKEN"),
  MANCHESTER: Deno.env.get("SHIPBOB_API_TOKEN_UK"),
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getInventory(token: string, page: number) {
  for (let a = 0; a < 6; a++) {
    const res = await fetch(`https://api.shipbob.com/1.0/inventory?Page=${page}&Limit=250`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return await res.json();
    if ([403, 429, 502, 503].includes(res.status)) { await sleep(2500 + a * 2000); continue; }
    throw new Error(`ShipBob ${res.status}: ${await res.text()}`);
  }
  throw new Error("throttled (inventory)");
}

Deno.serve(async () => {
  const started = Date.now();
  const sb = createClient(SB_URL, SB_KEY);
  const { data: locations } = await sb.from("locations").select("id, code").in("code", Object.keys(TOKENS));
  const summary: Record<string, unknown> = { sites: {} };

  for (const loc of locations ?? []) {
    const token = TOKENS[loc.code];
    if (!token) { (summary.sites as any)[loc.code] = { skipped: "no token" }; continue; }
    try {
      // inventory_id -> product_id for this location
      const { data: pls } = await sb.from("product_locations")
        .select("product_id, shipbob_inventory_id").eq("location_id", loc.id);
      const prodByInv = new Map((pls ?? []).map((p: any) => [String(p.shipbob_inventory_id), p.product_id]));

      const rows: any[] = [];
      let page = 1;
      while (page <= 40) {
        const items = await getInventory(token, page);
        if (!items?.length) break;
        for (const it of items) {
          const pid = prodByInv.get(String(it.id));
          if (!pid) continue;
          for (const lot of (it.fulfillable_quantity_by_lot || [])) {
            if (!lot.lot_number) continue;
            const onhand = lot.onhand_quantity ?? lot.fulfillable_quantity ?? 0;
            if (onhand <= 0) continue;
            rows.push({
              location_id: loc.id, product_id: pid, lot_number: String(lot.lot_number),
              expiry_date: lot.expiration_date ? String(lot.expiration_date).slice(0, 10) : null,
              on_hand: onhand, source: "shipbob", updated_at: new Date().toISOString(),
            });
          }
        }
        if (items.length < 250) break;
        page++; await sleep(800);
      }

      // full refresh for this site's ShipBob-sourced lots
      await sb.from("inventory_lots").delete().eq("location_id", loc.id).eq("source", "shipbob");
      if (rows.length) await sb.from("inventory_lots").insert(rows);
      (summary.sites as any)[loc.code] = { lots: rows.length };
    } catch (e) {
      (summary.sites as any)[loc.code] = { error: String(e) };
    }
  }
  summary.elapsed_ms = Date.now() - started;
  return Response.json(summary);
});
