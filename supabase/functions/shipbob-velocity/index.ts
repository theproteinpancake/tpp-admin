// ShipBob velocity — per SKU per site sell-through over 7/30/90 days.
// Paginates /1.0/order newest-first per site token, counts units on Completed
// shipments at that fulfillment centre, and writes avg daily units to `velocity`.
// days_of_cover is derived in the v_stock_current view (available / avg daily).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKENS: Record<string, string | undefined> = {
  ALTONA: Deno.env.get("SHIPBOB_API_TOKEN"),
  MANCHESTER: Deno.env.get("SHIPBOB_API_TOKEN_UK"),
};
const WINDOW_DAYS = 90;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dayStr = (d: Date) => d.toISOString().slice(0, 10);

async function getOrders(token: string, page: number) {
  for (let a = 0; a < 6; a++) {
    const res = await fetch(
      `https://api.shipbob.com/1.0/order?Page=${page}&Limit=250&SortOrder=Newest`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.ok) return await res.json();
    if ([403, 429, 502, 503].includes(res.status)) { await sleep(2500 + a * 2000); continue; }
    throw new Error(`ShipBob ${res.status}: ${await res.text()}`);
  }
  throw new Error("throttled out (orders)");
}

Deno.serve(async (_req: Request) => {
  const started = Date.now();
  const today = new Date();
  const todayStr = dayStr(today);
  const cutoff = dayStr(new Date(today.getTime() - WINDOW_DAYS * 86400_000));
  const c7 = dayStr(new Date(today.getTime() - 6 * 86400_000));
  const c30 = dayStr(new Date(today.getTime() - 29 * 86400_000));
  const sb = createClient(SB_URL, SB_KEY);

  const { data: locations } = await sb.from("locations")
    .select("id, code, shipbob_fc_id").in("code", Object.keys(TOKENS));
  const { data: products } = await sb.from("products").select("id, sku");
  const idBySku = new Map<string, string>((products ?? []).map((p: any) => [p.sku, p.id]));

  const summary: Record<string, unknown> = { window_days: WINDOW_DAYS, sites: {} };

  for (const loc of locations ?? []) {
    const token = TOKENS[loc.code];
    if (!token) { (summary.sites as any)[loc.code] = { skipped: "no token" }; continue; }
    try {
      // sku -> { d7, d30, d90 } unit counts
      const agg = new Map<string, { d7: number; d30: number; d90: number }>();
      let page = 1, orders = 0, stop = false;
      while (!stop && page <= 40) {
        const batch = await getOrders(token, page);
        if (!batch?.length) break;
        for (const o of batch) {
          const od = (o.purchase_date || o.created_date || "").slice(0, 10);
          if (od && od < cutoff) { stop = true; continue; }
          orders++;
          for (const sh of (o.shipments || [])) {
            if ((sh.location?.id) !== loc.shipbob_fc_id) continue;
            if (sh.status !== "Completed") continue;
            for (const p of (sh.products || [])) {
              const id = idBySku.get((p.sku || "").trim());
              if (!id) continue;
              const qty = (p.inventory_items || []).reduce((s: number, ii: any) => s + (ii.quantity || 0), 0)
                || p.quantity || 0;
              const a = agg.get(id) ?? { d7: 0, d30: 0, d90: 0 };
              if (od >= c7) a.d7 += qty;
              if (od >= c30) a.d30 += qty;
              a.d90 += qty;
              agg.set(id, a);
            }
          }
        }
        if (batch.length < 250) break;
        page++; await sleep(600);
      }

      const rows = [...agg.entries()].map(([product_id, a]) => {
        const v7 = +(a.d7 / 7).toFixed(3);
        const v30 = +(a.d30 / 30).toFixed(3);
        const v90 = +(a.d90 / 90).toFixed(3);
        let trend = "flat";
        if (v30 > 0) { if (v7 > v30 * 1.15) trend = "up"; else if (v7 < v30 * 0.85) trend = "down"; }
        return {
          as_of_date: todayStr, location_id: loc.id, product_id,
          avg_daily_units_7d: v7, avg_daily_units_30d: v30, avg_daily_units_90d: v90, trend,
        };
      });
      if (rows.length) {
        await sb.from("velocity").upsert(rows, { onConflict: "as_of_date,location_id,product_id" });
      }
      (summary.sites as any)[loc.code] = { orders_scanned: orders, skus_with_sales: rows.length };
    } catch (e) {
      (summary.sites as any)[loc.code] = { error: String(e) };
    }
  }
  summary.elapsed_ms = Date.now() - started;
  return Response.json(summary);
});
