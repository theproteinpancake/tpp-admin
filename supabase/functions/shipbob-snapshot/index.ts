// ShipBob daily inventory snapshot — tpp-dashboard project
// Paginates /1.0/product for each site's token, self-maintains product_locations,
// and upserts one inventory_snapshots row per SKU per site per day.
// Secrets required: SHIPBOB_API_TOKEN (AU/Altona), SHIPBOB_API_TOKEN_UK (UK/Manchester).
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are provided by the edge runtime.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// location.code -> { token, fulfillment-center id }
const SITES: Record<string, { token: string | undefined }> = {
  ALTONA:     { token: Deno.env.get("SHIPBOB_API_TOKEN") },
  MANCHESTER: { token: Deno.env.get("SHIPBOB_API_TOKEN_UK") },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAllProducts(token: string): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  while (page <= 40) {
    let data: any = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(
        `https://api.shipbob.com/1.0/product?Page=${page}&Limit=250`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) { data = await res.json(); break; }
      if ([403, 429, 502, 503].includes(res.status)) {
        await sleep(2500 + attempt * 2000); // back off ShipBob abuse-protection (error 1010)
        continue;
      }
      throw new Error(`ShipBob ${res.status}: ${await res.text()}`);
    }
    if (data === null) throw new Error(`ShipBob throttled out on page ${page}`);
    out.push(...data);
    if (data.length < 250) break;
    page++;
    await sleep(900);
  }
  return out;
}

Deno.serve(async (_req: Request) => {
  const started = Date.now();
  const today = new Date().toISOString().slice(0, 10); // UTC date
  const sb = createClient(SB_URL, SB_KEY);

  const { data: locations, error: locErr } = await sb
    .from("locations").select("id, code, shipbob_fc_id")
    .in("code", Object.keys(SITES));
  if (locErr) return Response.json({ error: locErr.message }, { status: 500 });

  const { data: products, error: prodErr } = await sb
    .from("products").select("id, sku");
  if (prodErr) return Response.json({ error: prodErr.message }, { status: 500 });
  const idBySku = new Map<string, string>(products!.map((p: any) => [p.sku, p.id]));

  const summary: Record<string, unknown> = { date: today, sites: {} };

  for (const loc of locations!) {
    const site = SITES[loc.code];
    if (!site?.token) { (summary.sites as any)[loc.code] = { skipped: "no token configured" }; continue; }
    try {
      const prods = await fetchAllProducts(site.token);
      const fcId = loc.shipbob_fc_id;
      const pl = new Map<string, any>();    // product_id -> product_locations row
      const snap = new Map<string, any>();  // product_id -> inventory_snapshots row

      for (const p of prods) {
        const sku = (p.sku || "").trim();
        const pid = idBySku.get(sku);
        if (!pid) continue;
        const inv = (p.fulfillable_inventory_items || [])[0];
        const fc = (p.fulfillable_quantity_by_fulfillment_center || [])
          .find((f: any) => f.id === fcId);

        if (inv?.id && !pl.has(pid)) {
          pl.set(pid, {
            product_id: pid, location_id: loc.id,
            shipbob_inventory_id: String(inv.id), active: true,
          });
        }
        const row = {
          snapshot_date: today, location_id: loc.id, product_id: pid,
          on_hand: fc?.onhand_quantity ?? 0,
          available: fc?.fulfillable_quantity ?? 0,
          committed: fc?.committed_quantity ?? 0,
          inbound: 0, source: "shipbob",
        };
        // a SKU can appear under multiple channels; keep the richest (max on_hand)
        const prev = snap.get(pid);
        if (!prev || row.on_hand > prev.on_hand) snap.set(pid, row);
      }

      if (pl.size) {
        await sb.from("product_locations").upsert([...pl.values()], { onConflict: "product_id,location_id" });
      }
      const snapRows = [...snap.values()];
      if (snapRows.length) {
        await sb.from("inventory_snapshots").upsert(snapRows, { onConflict: "snapshot_date,location_id,product_id" });
      }
      (summary.sites as any)[loc.code] = {
        products_fetched: prods.length,
        mapped: pl.size,
        snapshots_written: snapRows.length,
      };
    } catch (e) {
      (summary.sites as any)[loc.code] = { error: String(e) };
    }
  }

  summary.elapsed_ms = Date.now() - started;
  return Response.json(summary);
});
