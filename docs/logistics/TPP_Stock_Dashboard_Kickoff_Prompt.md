# TPP Stock Dashboard — Phase 0 Kickoff Prompt

> Saved 2026-06-04. The original kickoff message that started the Phase 0 build session.

We're extending our existing tpp-dashboard Supabase project into a multi-site stock-management dashboard. Read TPP_Stock_Dashboard_Build_Plan.md in this folder for the full spec before doing anything.

**Ground truth:**

- Supabase project tpp-dashboard, ref `pwvcufaxiwgnnratbytb` (ap-southeast-2). Existing tables: products (15 SKUs: id, sku, name, cogs), plus scaffolded-but-empty orders, order_items, fulfillment_costs, daily_summary.
- Do not touch the separate tpp-app project (ref `nnwfuylkrouuitjcdswj`) — that's the recipe app.
- Stack: Next.js + Supabase + Vercel; Shopify + ShipBob already integrated for the orders sync. Supabase, Shopify, Vercel MCPs available.
- Sites: Altona ShipBob (AU) and Manchester ShipBob (UK) — separate ShipBob channels, separate inventory ids.
- Primary SKUs to highlight: Buttermilk, GF Buttermilk, Cinnamon Churro, Maple, GF Cinnamon.

**Phase 0 goal:** a working Stock Overview landing page — live on-hand + days-of-cover + a stock trend per SKU per site.

**Confirm before coding:** (1) ShipBob API token/scopes for AU and UK channels — inventory + velocity endpoints on our plan? (2) Base unit = 520g pack, plus 1kg/320g conversion factors? (3) Make stock the default route, demoting recipes/app to a section?

**Phase 0 steps (small migrations):**

1. Schema: add locations, product_locations, inventory_snapshots (daily; UNIQUE on date+location+product), velocity; extend products (flavour, unit_size_g, format, tier, base_units, active); seed Altona + Manchester. list_tables before/after each migration.
2. ShipBob sync: scheduled job writing a daily inventory snapshot per SKU per site (ShipBob is point-in-time — snapshotting is what gives trends + later lead-time learning; don't skip).
3. Velocity: days-of-cover per SKU per site from order history + ShipBob velocity; 7/30/90-day windows; exclude stockout days.
4. Landing page: per-site cards + per-SKU table (on-hand, available, days-of-cover, status pill) + trend charts; pin the 5 primary SKUs.

Stop and show the schema + landing page before Phase 1 (POs/WRO) or Phase 2 (forecasting/alerts). Reuse the existing Maersk pack generator for the later pallet phase — don't rebuild it.

**Later integrations:** Xero (automate drafting of Purchase Orders) and ShipBob APIs (live data).
