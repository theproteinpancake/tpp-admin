# TPP Stock Dashboard — Phase 0 status (2026-06-04)

## Architecture decided
- **One consolidated hub**: the existing **`tpp-admin`** Next.js app (appadmin → admin.theproteinpancake.co).
  Nav regrouped into **App** (App Dashboard, Recipes, Creators, Users, Notifications) and **Logistics** (Stock Overview, more to come).
- Front-end talks to **two** Supabase projects: `tpp-app` (recipes, untouched) + `tpp-dashboard` (logistics).
  Logistics data is read **server-side** with the tpp-dashboard **service key** (tables are RLS service-role-only; app is password-gated).
- Work is on branch **`feature/logistics-dashboard`** in `~/Claude/Projects/TPP App/tpp-admin` (NOT committed/deployed yet).

## Supabase tpp-dashboard (ref pwvcufaxiwgnnratbytb) — DONE
- Migrations: extended `products`; new `locations`, `product_locations`, `inventory_snapshots` (unique date+loc+product), `velocity`; `cogs` nullable; view `v_stock_current` (security_invoker).
- `products` reseeded from real catalog: 37 SKUs (30 mix / 2 syrup / 5 accessory), 26 active, 18 primary. COGS from Xero.
- `product_locations`: Altona 37/37, Manchester 37/37 (ShipBob inventory ids, pulled live).
- Edge Function **`shipbob-snapshot`** deployed (verify_jwt). Secrets set: SHIPBOB_API_TOKEN (AU), SHIPBOB_API_TOKEN_UK.
- **pg_cron** job `shipbob-daily-snapshot` @ 19:00 UTC daily (pg_net → edge function).
- First snapshot written: 74 rows (37 per site).

## ShipBob API notes
- AU + UK are **separate accounts/tokens**, same host `api.shipbob.com`. AU=FC 28 (Altona), UK=FC 32 (Manchester).
- `/1.0/product` (NO channel header) is the snapshot source: sku → fulfillable_inventory_items[0].id + per-FC on_hand/available/committed. >250 products → paginate.
- `/1.0/inventory` and `/1.0/product` 401 **with** a channel header, 200 without. Rapid bursts trip abuse-protection (HTTP 403 "error code: 1010") for ~1–2 min → pace calls.
- Velocity source identified: `/1.0/order` shipments carry `location.id` (FC) + line sku/qty + fulfillment dates.

## Front-end (branch) — DONE
- `src/lib/supabase-logistics.ts` (server-only client + types), `src/lib/stock.ts` (status logic).
- `src/components/Sidebar.tsx` regrouped (App / Logistics) in brand colours.
- `src/app/login/page.tsx` — fixed double-click bug (hard nav after cookie set) + rebrand.
- `src/app/logistics/stock/page.tsx` — Stock Overview: per-site cards, primary/secondary/other tables, status pills, trend sparklines, Sync-now.
- `src/app/api/logistics/sync/route.ts` — manual trigger for the edge function.

## NOT done yet (next)
- **Velocity / days-of-cover**: build `/1.0/order`-based velocity (7/30/90d, per site, exclude stockout days) → `velocity` table. Page currently shows days-of-cover as "—".
- Commit/push branch + deploy to Vercel; point ShipBob/logistics env in Vercel; rotate the stray Google client_secret at repo root.
- Phase 1 (POs/WRO + Xero draft POs), Phase 2 (forecast/alerts), Phase 3 (Maersk pallet builder — reuse existing generator).
