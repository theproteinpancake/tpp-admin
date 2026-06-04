// ShipBob shipment-cost capture — pulls per-shipment fulfilment cost per site
// (invoice_amount) over ~90 days for cost-trend + outlier monitoring.
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
    const res = await fetch(`https://api.shipbob.com/1.0/order?Page=${page}&Limit=250&SortOrder=Newest`,
      { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) return await res.json();
    if ([403, 429, 502, 503].includes(res.status)) { await sleep(2500 + a * 2000); continue; }
    throw new Error(`ShipBob ${res.status}: ${await res.text()}`);
  }
  throw new Error("throttled (orders)");
}

Deno.serve(async () => {
  const started = Date.now();
  const cutoff = dayStr(new Date(Date.now() - WINDOW_DAYS * 86400_000));
  const sb = createClient(SB_URL, SB_KEY);
  const { data: locations } = await sb.from("locations").select("id, code, shipbob_fc_id").in("code", Object.keys(TOKENS));
  const summary: Record<string, unknown> = { sites: {} };

  for (const loc of locations ?? []) {
    const token = TOKENS[loc.code];
    if (!token) { (summary.sites as any)[loc.code] = { skipped: "no token" }; continue; }
    try {
      const rows: any[] = [];
      let page = 1, stop = false;
      while (!stop && page <= 40) {
        const batch = await getOrders(token, page);
        if (!batch?.length) break;
        for (const o of batch) {
          const od = (o.purchase_date || o.created_date || "").slice(0, 10);
          if (od && od < cutoff) { stop = true; continue; }
          for (const sh of (o.shipments || [])) {
            if (sh.status !== "Completed" || sh.invoice_amount == null) continue;
            if ((sh.location?.id) !== loc.shipbob_fc_id) continue;
            const r = sh.recipient || {};
            rows.push({
              location_id: loc.id, site: loc.code,
              shipbob_order_id: String(o.id), shipbob_shipment_id: String(sh.id),
              order_number: o.order_number || null,
              ship_date: (sh.actual_fulfillment_date || sh.created_date || od || "").slice(0, 10) || null,
              cost: sh.invoice_amount, currency: sh.invoice_currency_code || null,
              ship_option: sh.ship_option || null,
              region: r.country || r.state || null, city: r.city || null, status: sh.status,
            });
          }
        }
        if (batch.length < 250) break;
        page++; await sleep(600);
      }
      // upsert by shipment id
      for (let i = 0; i < rows.length; i += 500) {
        await sb.from("shipment_costs").upsert(rows.slice(i, i + 500), { onConflict: "shipbob_shipment_id" });
      }
      (summary.sites as any)[loc.code] = { shipments: rows.length };
    } catch (e) {
      (summary.sites as any)[loc.code] = { error: String(e) };
    }
  }
  summary.elapsed_ms = Date.now() - started;
  return Response.json(summary);
});
