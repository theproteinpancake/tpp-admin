# TPP Stock Management Dashboard — Build Plan & Spec

> Hand-off doc for a Claude Code session. Goal: turn the existing **tpp-dashboard** into a multi-site stock-management command centre that lets Luke run a 2–3-month-lead, multi-country supply chain pre-emptively, with Claude looped in for live monitoring.

---

## 1. Vision

One landing page that shows, at a glance, **how much stock we have, where, how fast it's selling, and what we need to order/ship and when** — across Altona (VIC) and Manchester (UK) today, and any number of sites in future. It replaces the current manual, reactive process (fiddling ShipBob date ranges; relying on ABC to tell us we're out) with a precise, forecast-driven, alert-driven system.

**Three jobs the dashboard must do well:**
1. **See** — live stock + velocity + days-of-cover per SKU per site, with trend history.
2. **Decide** — tell us *what to order, what to ship, and when*, accounting for long lead times and inbound POs.
3. **Act** — one-click to draft a PO split, or to build the next UK pallet and generate the Maersk export pack.

---

## 2. Current state (confirmed via Supabase)

**Project: `tpp-dashboard`** (ref `pwvcufaxiwgnnratbytb`, ap-southeast-2). Existing tables:

| Table | Rows | Purpose |
|---|---|---|
| `products` | 15 | SKU master — `id, sku, name, cogs, created_at` |
| `orders` | 0 | Shopify+ShipBob order/margin model (scaffolded, not synced) |
| `order_items` | 0 | Order line items (`sku, quantity, unit_cogs…`) |
| `fulfillment_costs` | 0 | ShipBob pick/pack/ship costs |
| `daily_summary` | 0 | Daily sales/margin aggregates |

**Project: `tpp-app`** (ref `nnwfuylkrouuitjcdswj`) — recipe app: `recipes` (185), `creators`, `push_tokens`, `recipe_comments`. Admin UI at `appadmin.theproteinpancake.co`.

**Implication:** build stock on top of `tpp-dashboard` (reuse `products`, the Shopify/ShipBob sync pattern, and the existing admin shell). The new stock landing page becomes the default route; recipes/app management stay as secondary sections.

**Assumed stack (confirm):** Next.js + Supabase + Vercel, with Shopify + ShipBob already integrated for the orders sync. MCPs available to the build session: Supabase, Shopify, Vercel.

---

## 3. Supply-chain model (the thing the data must mirror)

```
[China pouch supplier] --pouches--> [ABC Blending, VIC] --finished units--> [Altona ShipBob, AU]
                                                                                  |
                                                                       (a) Customer (AU/online)
                                                                       (b) 1x Pallet via Maersk (DDP) -> [Manchester ShipBob, UK] -> Customer (UK)

Future: [UK blender] -> [UK ShipBob];  [US blender] -> [US ShipBob]  (local-make, local-fulfil)
```

Every arrow is a **lead time** and every box is a **stock node**. The model must treat:
- **Finished goods** at ShipBob sites (Altona, Manchester) — the primary thing we track/sell.
- **Components** (empty pouches held at ABC; blend at ABC) — upstream inventory that gates production.
- **In-transit** (pallet on the water ~2–3 months; POs in production at ABC).

This is **multi-echelon inventory** — model nodes generically so adding a UK/US blender later is just new rows, not new code.

---

## 4. Proposed data model (extends `tpp-dashboard`)

Keep it generic (`location`, `node_type`) so new sites/countries are data, not schema changes.

**Extend `products`** — add:
`flavour`, `unit_size_g` (520 / 1000 / 320), `format` ('retail' | 'wholesale'), `tier` ('primary' | 'secondary'), `active` (bool), `base_units` (520g-equivalents per pack: 520g=1, 1kg=2, 320g≈0.62 — see §7), `blend_kg_per_unit`, `pouch_component_id` (FK), `box_required` (bool), `card_required` (bool), `shopify_variant_id`, `shipbob_product_id` (may differ per channel → see `product_locations`).

**New tables:**

- **`locations`** — `id, name, type ('finished_3pl'|'blender'|'packaging_supplier'), country, currency, shipbob_channel_id (nullable), is_default_origin (bool), active`. Seed: Altona ShipBob (AU), Manchester ShipBob (UK), ABC Blending (VIC, blender), China Packaging (supplier).
- **`product_locations`** — maps a product to its ShipBob inventory id per location (ShipBob AU and UK are separate channels/ids): `product_id, location_id, shipbob_inventory_id, active`.
- **`inventory_snapshots`** — daily point-in-time per SKU per site (so we can draw **trends**, which ShipBob's API alone can't): `snapshot_date, location_id, product_id, on_hand, available, committed, inbound, source`. **Unique** on (date, location, product).
- **`velocity`** — computed per SKU per site: `as_of_date, location_id, product_id, avg_daily_units_7d/30d/90d, days_of_cover, trend`. Derive from ShipBob velocity API and/or our own `order_items` history.
- **`suppliers`** — `id, name, type ('blender'|'packaging'), country, currency, default_lead_days, xero_contact_id`. Seed: ABC Blending, China Packaging.
- **`purchase_orders`** — `id, po_number, supplier_id, destination_location_id, status ('draft'|'placed'|'in_production'|'partially_received'|'received'|'closed'), currency, placed_date, expected_date, received_date, total_cost, xero_po_id, notes`.
- **`po_items`** — `po_id, product_id, qty_units, qty_received, blend_kg` (for ABC blend POs entered as kg → split per flavour → derived units).
- **`wros`** (ShipBob Warehouse Receiving Orders) — `id, shipbob_wro_id, location_id, po_id (nullable link), status, expected_date, received_date`. **Used to reconcile what actually landed vs the PO, and to mark stock as "inbound" so a SKU with a PO en route isn't flagged low.**
- **`wro_items`** — `wro_id, product_id, expected_qty, received_qty`.
- **`transfers`** (UK pallets) — `id, internal_ref ('INTERNAL3'…), origin_location_id, dest_location_id, status ('planned'|'booked'|'in_transit'|'devanned'|'cleared'|'delivered'), carrier, bl_number, ucn, container, etd, eta, devan_date, free_storage_until, cartons, units, gross_kg, net_kg, cbm`.
- **`transfer_items`** — `transfer_id, product_id, qty_units, cartons, lot_number, expiry`. **Feeds the Maersk packing list + commercial invoice automatically.**
- **`packaging_components`** — empty pouches: `id, sku, name, matches_product_flavour/size, supplier_id, held_at_location_id (ABC), on_hand_estimate, updated_at`. Each finished unit consumes 1 matching pouch (see §8).
- **`lead_time_log`** — derived learning: `supplier_id, po_id, placed_date, received_date, lead_days` → rolling average per supplier feeds reorder math.
- **`settings` / `sku_policy`** — per SKU or tier: `target_days_cover`, `safety_days`, `min_order`, and global knobs (cash-flow "budget mode" toggle).

---

## 5. Feature modules

### 5.1 Stock Overview (the landing page)
- Cards/grid per **site**: total units, # SKUs below target, value of stock.
- Per-SKU table & chart: on-hand, available, **days of cover**, velocity (7/30/90d), inbound (POs/WROs), status pill (Healthy / Reorder soon / **Reorder now** / Inbound-covered).
- **Trend charts** (from `inventory_snapshots`): stock-on-hand over time per SKU per site; overlay velocity. This is what makes "stock trends easily visible across Altona + Manchester."
- Primary SKUs (Buttermilk, GF Buttermilk, Cinnamon Churro, Maple, GF Cinnamon) pinned/highlighted; secondary SKUs grouped and visually de-emphasised.

### 5.2 Velocity & Days-of-Cover (precision fix)
- Pull ShipBob velocity + estimated days-on-hand per SKU per channel, **but** also compute our own from `order_items` so we're not dependent on manual ShipBob date-fiddling. Configurable windows (7/30/90d) and the ability to exclude stockout days so velocity isn't understated. Store daily in `velocity`.

### 5.3 Outstanding POs ↔ WRO reconciliation
- List open POs (from Xero or manual) with status and expected date.
- Cross-check each against ShipBob **WROs**: received yet? qty received vs ordered (flag discrepancies/shorts — e.g. the CCM short we saw on INTERNAL2).
- **Inbound-aware low-stock:** a SKU isn't "low" if a PO/WRO covers it before projected stockout. (Directly solves the "don't cry low stock when a PO is inbound" ask.)

### 5.4 Lead-time learning
- Every PO→WRO pair writes to `lead_time_log`; show rolling avg lead time per supplier (ABC blend; China pouches; Altona→Manchester pallet transit). Feeds reorder points so they self-tune.

### 5.5 Replenishment & reorder engine (per node)
- For each SKU × site: **reorder point = (avg daily velocity × lead_days) + safety stock**; safety stock from velocity/lead-time variance.
- Two distinct lead times: **Altona reorder** (PO→ABC→receive) and **Manchester reorder** (which is *fed by a UK pallet*, so its lead time = pallet build + Maersk transit ~2–3 months). Manchester must trigger a pallet *well* before projected stockout.
- Output: "**Order X of SKU Y now**" and "**Send next UK pallet in N days**".
- **Cash-flow / budget mode:** when toggled, prioritise primary SKUs and trim/skip secondary-SKU reorders.

### 5.6 Packaging (pouch) forecasting — upstream of ABC
- Track ABC's **empty-pouch on-hand** per flavour/size (`packaging_components`, seeded from the stock update you're requesting from ABC).
- Pouch burn = finished-unit production. Project pouch run-out; **recommend ordering from China ~60 days before run-out** (China lead time, configurable). Roughly-accurate is fine — goal is to never get blindsided by ABC running out.
- "Bags placed on PO with ABC" decrement projected pouch stock.

### 5.7 UK Pallet builder (quick action) — ties to this session's work
- Landing-page card: "**Send next UK pallet in X days**" (from Manchester reorder math).
- Click **Organise pallet** → suggests a load: prioritise primary SKUs + UK days-of-cover gaps, respect pallet limits (≈85 cartons / 600 kg / 1.75 CBM; units-per-carton per SKU from existing data), output a per-SKU/per-carton list with lot numbers.
- Push as a **ShipBob AU B2B order** (so ShipBob picks/packs), then **auto-generate the Maersk pack** (commercial invoice, packing list, COO, SLI, product spec) using the templates already built this session — populated from `transfer_items`. New shipment auto-named `INTERNAL{n}` in its own folder.
- Hands Luke a ready-to-send zip → Email A to Maersk.

### 5.8 SKU knowledge base
- Editable notes/config: primary vs secondary tiers; the 520g-base consolidation plan; **Custom Boxes** and **thank-you cards** rules (when included, per which SKUs/orders, stock implications). Surface box/card stock as their own components if they can run out.

---

## 6. Integrations

| Source | Pull | Notes |
|---|---|---|
| **ShipBob API** | Inventory on-hand/available per SKU per FC; velocity & est. days; **WROs** (receiving); fulfillment costs | AU and UK are separate channels → store ids in `product_locations`. Snapshot **daily** into Supabase (API is point-in-time; we need history for trends + lead times). Confirm API token(s)/scopes. |
| **Xero** | Purchase Orders to ABC (and China) | Read PO header/lines + status; or manual PO entry in-app as fallback. Currency = AUD. |
| **Shopify** | Orders / sell-through (already scaffolded) | Powers our own velocity calc + the existing margin model. |
| **Maersk pack generator** | (internal) | Reuse the docx→PDF templates from this session to emit the INTERNAL{n} export pack from a planned transfer. |

**Sync architecture:** scheduled jobs (Supabase cron / edge functions, or Vercel cron) that (1) snapshot inventory daily, (2) refresh velocity, (3) poll WRO status, (4) recompute reorder points & alerts. Keep raw snapshots so trends and lead-time learning accrue over time.

---

## 7. Unit normalisation (handle 520g / 1kg / 320g + the consolidation plan)

Store everything internally in a **base unit** so velocity, stock and forecasting are apples-to-apples and the future "1kg = 2×520g" change is trivial:
- Base unit = **520g pack** (or kg-of-blend — pick one; 520g is cleaner for fulfilment).
- `base_units`: 520g = 1.0, 1kg ≈ 1.92 (by blend weight) or treat 1kg = 2× for the consolidation model, 320g ≈ 0.615.
- When the consolidation lands, "1kg online" becomes a Shopify bundle = 2×520g picks at ShipBob; the dashboard already thinks in 520g base units, so nothing downstream breaks.
- Keep a `blend_kg_per_unit` so kg-based ABC POs convert to units and back.

---

## 8. Claude-in-the-loop (live monitoring) — how you stay "always overviewed"

Three layers, increasing autonomy:
1. **Scheduled daily stock briefing** — a scheduled task reads Supabase + ShipBob each morning and emails/messages you: what's low, what to reorder, pallet countdown, pouch countdown, any WRO discrepancies. (Pre-emptive, no logging in.)
2. **On-demand** — ask Claude anything against live data ("what's our Manchester cover on primary SKUs?", "draft the ABC PO split for a 1T order"), and it answers from the dashboard DB.
3. **Drafting agent** — Claude proposes the **PO split** (1T → per-flavour → 520g/1kg/320g) and the **pallet load**, you approve, it executes (writes the PO, builds the transfer, generates the Maersk pack). You stay the approver; Claude does the legwork.

A persistent **live artifact** (auto-refreshing stock page) is a lightweight option for an always-on glanceable view between full dashboard sessions.

---

## 9. Suggested build phases

- **Phase 0 — Foundations:** schema (§4), seed `locations`/`suppliers`, extend `products`, ShipBob inventory sync (both sites) + daily snapshots → **Stock Overview landing page** with days-of-cover + trend charts.
- **Phase 1 — POs & receiving:** PO model (Xero or manual) + WRO reconciliation + inbound-aware low-stock + lead-time learning.
- **Phase 2 — Forecast & alerts:** reorder engine, safety stock, packaging/pouch forecasting, daily Claude briefing + alerts, budget mode.
- **Phase 3 — Pallet builder:** "send pallet in X days" → suggested load → ShipBob B2B order → auto-generate Maersk INTERNAL{n} pack.
- **Phase 4 — Scale & autonomy:** multi-location generalisation (UK/US blender nodes), Claude drafting agent, richer forecasting (trend/seasonality).

---

## 10. Open questions / decisions to confirm in the build session

1. **ShipBob API access** — token(s) and scopes for AU **and** UK channels; does ShipBob expose WROs + velocity on your plan? (Confirms 5.2/5.3 feasibility.)
2. **Xero PO integration** vs manual PO entry to start (manual is a fine Phase-1 fallback).
3. **ABC pouch visibility** — will ABC give periodic empty-pouch counts (the update you're requesting)? Manual entry assumed; revisit if they can feed data.
4. **Base unit** — confirm 520g as the internal base; lock the 1kg/320g conversion factors and the blend-kg-per-unit per flavour.
5. **Dashboard home** — make stock the default route of the existing admin app, recipes/app demoted to a section? (Assumed yes.)
6. **Box & thank-you card model** — are these consumable stock items that can run out (track as components), or just fulfilment rules? Need the rules you'll load in.
7. **Where Maersk doc-gen runs** — port the docx→PDF generator into the app/an edge function, or keep it as a Claude-driven step triggered from the pallet builder?
8. **Alert channel** — email, Slack, in-app, or all three for the daily briefing.

---

## 11. SKU knowledge to pre-load (from Luke)

- **Primary SKUs (keep stocked at all times — majority of volume):** Buttermilk, Gluten Free Buttermilk, Cinnamon Churro, Maple, Gluten Free Cinnamon.
- **Secondary SKUs:** everything else — don't over-order when cash flow is tight.
- **Consolidation plan:** move to a single 520g manufactured unit; sell "1kg" online as 2×520g; simplifies global logistics.
- **Custom Boxes & thank-you cards:** [Luke to load rules — when included, which SKUs/orders, and whether they're stock-tracked components].
- **Lead times (seed, then let the system learn):** ABC blend PO → Altona receipt; China pouch order → ABC; Altona → Manchester pallet ≈ 2–3 months.

---

*Built from the Maersk logistics session + live Supabase/ShipBob context, June 2026. The Maersk export-pack templates, entity identifiers, FTA/PVA setup and pallet workflow referenced in §5.7 already exist and should be reused, not rebuilt.*
