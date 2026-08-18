// ShipBob daily inventory snapshot — 2026-01 API.
//
// Two jobs:
// 1. Snapshot: per-SKU on-hand/available/committed for every MAPPED inventory id
//    (product_locations). Account totals == site totals because each token is a one-FC account.
// 2. Discovery: sweep the FULL inventory catalog (cursor pagination) and record any id that
//    has stock or movement but is mapped NOWHERE — neither product_locations nor the packaging
//    table. Written to app_config['shipbob_unmapped'] for the health check to flag. This is the
//    net that was missing when the thank-you cards and the whole Manchester packaging set moved
//    stock invisibly for months (Aug 2026: "Thank You 1" sold out unnoticed).
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

async function fullCatalog(token: string): Promise<any[]> {
  const seen = new Map<number, any>();
  let url: string | null = "https://api.shipbob.com/2026-01/inventory-level?PageSize=250";
  for (let hops = 0; hops < 20 && url; hops++) {
    let ok = false;
    for (let a = 0; a < 6; a++) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const j: any = await res.json();
        for (const it of (j.items ?? [])) seen.set(Number(it.inventory_id), it);
        url = j.next ? `https://api.shipbob.com/2026-01${j.next}` : null;
        ok = true; break;
      }
      if ([403, 429, 502, 503].includes(res.status)) { await sleep(2500 + a * 2000); continue; }
      throw new Error(`ShipBob ${res.status}: ${await res.text()}`);
    }
    if (!ok) throw new Error("throttled out (catalog)");
    await sleep(400);
  }
  return [...seen.values()];
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
  const { data: pkg } = await sb.from("packaging").select("shipbob_inventory_id").not("shipbob_inventory_id", "is", null);
  const pkgIds = new Set((pkg ?? []).map((p: any) => Number(p.shipbob_inventory_id)));

  const summary: Record<string, unknown> = { date: today, sites: {} };
  const unmapped: { site: string; inventory_id: number; name: string; fulfillable: number; committed: number; awaiting: number }[] = [];

  for (const loc of locations ?? []) {
    const token = TOKENS[loc.code];
    if (!token) { (summary.sites as any)[loc.code] = { skipped: "no token configured" }; continue; }
    const mine = (pls ?? []).filter((p: any) => p.location_id === loc.id && p.shipbob_inventory_id);
    const mineIds = new Set(mine.map((p: any) => Number(p.shipbob_inventory_id)));
    try {
      const catalog = await fullCatalog(token);
      const byId = new Map(catalog.map((it: any) => [Number(it.inventory_id), it]));

      const rows = mine.map((p: any) => {
        const lv = byId.get(Number(p.shipbob_inventory_id));
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

      for (const it of catalog) {
        const id = Number(it.inventory_id);
        if (mineIds.has(id) || pkgIds.has(id)) continue;
        const f = it.total_fulfillable_quantity || 0, c = it.total_committed_quantity || 0, a = it.total_awaiting_quantity || 0;
        if (f + c + a <= 0) continue;                       // dead — not worth an alarm
        if (/quarantineitem/i.test(String(it.name))) continue; // ShipBob internal
        unmapped.push({ site: loc.code, inventory_id: id, name: String(it.name).slice(0, 80), fulfillable: f, committed: c, awaiting: a });
      }

      (summary.sites as any)[loc.code] = { mapped_ids: mine.length, snapshots_written: rows.length, catalog_size: catalog.length };
    } catch (e) {
      (summary.sites as any)[loc.code] = { error: String(e) };
    }
  }

  await sb.from("app_config").upsert(
    { key: "shipbob_unmapped", value: JSON.stringify({ as_of: today, items: unmapped }) },
    { onConflict: "key" },
  );

  summary.unmapped = unmapped.length;
  summary.elapsed_ms = Date.now() - started;
  return Response.json(summary);
});
