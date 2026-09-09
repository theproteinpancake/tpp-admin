# TPP Ops Bot on Grok — build spec + system prompt

**Why this exists:** Luke needs to run real logistics ops from his phone with no laptop —
create a B2B ShipBob order for a stockist, cut a WRO from an ABC docket, generate CIPL /
transfer documents — in under a minute, by voice or text.

**Architecture decision (read before building).** Every operation below is ALREADY implemented,
tested and running in `tpp-admin` (Next.js on Vercel, Supabase `pwvcufaxiwgnnratbytb`). The
WhatsApp agent "Batter" (`src/lib/stockAgent.ts`) exposes 63 tools over that logic. Grok must
therefore be a **second head on the same body**, never a reimplementation:

```
Phone (Telegram / voice)  ──►  Grok bridge (xAI function calling)  ──►  tpp-admin /api/ops/*  ──►  existing libs
                                                                                                   ShipBob 2026-01
                                                                                                   Xero, Supabase, Gmail
```

Two things this buys beyond convenience: an independent path when Twilio or Anthropic is down,
and voice input, which WhatsApp doesn't give the agent today.

Note: xAI has no consumer "custom bot with authenticated Actions" product. A Grok bot that
reaches a private API must be **your own client** calling the xAI API with function calling.
That is Deliverable 2.

---

# PART A — Build prompt

> Paste everything between the rules into a coding agent (Claude Code, Cursor) opened on the
> `tpp-admin` repo. It assumes repo access; it does not assume this conversation.

---

## Goal

Give Luke a mobile bot ("TPP Ops") that can, on the go:

1. Plan + create a **B2B ShipBob order** for a wholesale stockist (the Orca case: a Singapore
   export customer, freight, lot-controlled).
2. Create / recreate / cancel a **WRO** from an ABC Blending delivery docket.
3. Generate and send **CIPL and transfer documents** (commercial invoice, packing list, cert of
   origin, SLI, indirect-rep letter) for an AU→UK internal transfer.
4. Answer live stock, lot and PO questions well enough to make those decisions.

## What already exists — DO NOT REBUILD

| Capability | Existing code | Notes |
|---|---|---|
| Plan an order, decide B2C vs B2B, resolve address, FIFO lots | `src/lib/directOrder.ts` → `planDirectOrder()` | >200 units or >25 kg ⇒ B2B |
| Create the order | `directOrder.ts` → `createDirectOrder()` → `shipbob.ts` `createB2BOrder()` / `createB2COrder()` | B2B sets `type:'B2B'`, `shipping_terms`, `retailer_program_data`, per-line `required_lot` |
| Parse an ABC docket PDF from Gmail | `src/lib/wroFlow.ts` → `findDockets()`, `parseDocket()` | Claude vision on the PDF; reads the pallet `Note` field |
| Create / recreate / cancel a WRO | `wroFlow.ts` → `createWROFromParsed()`, `recreateWroForDocket()`, `cancelDocketWro()` | Idempotent per DOCKET via the `wro_dockets` table |
| WRO pallet labels PDF | `/api/whatsapp/wro-labels/[id]` | Public (Twilio must fetch); one page per pallet |
| Transfer documents (CIPL etc.) | `src/lib/transferPdf.tsx` `TRANSFER_DOCS`, served at `/api/transfers/[reference]/[doc]` | Keys: `cover-note`, `commercial-invoice`, `packing-list`, `certificate-of-origin`, `sli`, `sli-maersk-form`, `sli-carrier`, `indirect-representation`, `product-specification`, `wro-label` |
| Transfer create / lines / status | `src/lib/transfers.ts`, `transferBuilder.ts`, `transferShipbob.ts` | Statuses: draft, in_transit, customs, arrived, received, cancelled |
| Maersk SLI (their own AcroForm) | `src/lib/sliMaersk.ts`, `sliTemplate.ts` | Emails au.logistics@lns.maersk.com |
| Live stock + lots | `v_stock_current` view, `shipbob.ts` `getInventoryLevels()`, `getInventoryLots()` | Always overlay live ShipBob over the nightly snapshot |
| Same brain over HTTP already | `POST /api/assistant {message}` | Session-cookie auth, returns `{text, media}` |

## Deliverable 1 — `/api/ops/*` (thin, token-authed tool API)

> **STATUS: BUILT (Sep 2026).** `src/app/api/ops/[tool]/route.ts` is live with the sales and
> packaging tools below. `GET /api/ops/_schema` returns the tool list with arg docs and a
> `mutates` flag, so the bridge can load schemas instead of hard-coding them. Auth is
> `Authorization: Bearer $OPS_API_TOKEN` (fails CLOSED if the env var is unset), and `/api/ops`
> is exempted from the dashboard cookie gate in `middleware.ts`. Writes require an
> `idempotency_key` (replayed from `ops_idempotency`, never re-executed) and every call is
> audited to `agent_actions` as `ops.<tool>` under `phone = 'ops:<client>'`.
>
> Read: `get_week`, `get_day`, `get_weeks`, `get_mer`, `get_dashboard`, `get_year`,
> `get_wholesale`, `get_market_split`, `get_packaging`.
> Write: `record_packaging_delivery`, `set_packaging_baseline` — both resolve the packaging line
> by SKU or words, refuse ambiguity, cap quantities at 50,000 without `force:true`, and return
> `remaining_before` / `remaining_after` so the bot reports the real change rather than its
> intent. Remaining mutating tools (orders, WROs, transfer docs) still to build.


Create `src/app/api/ops/[tool]/route.ts`. One POST endpoint per tool, JSON in / JSON out, each
a thin wrapper over the library functions above. **No business logic in this layer.**

Auth: `Authorization: Bearer $OPS_API_TOKEN` (new env var, 32+ random bytes). Reject anything
else with 401. Add `/api/ops` to the middleware bypass list the same way `/api/whatsapp` is
handled, since it authenticates itself.

Tools to expose (name → wraps):

- `get_stock` → `v_stock_current` + live `getInventoryLevels` overlay. Args `{site?, search?, needs_attention?}`.
- `get_lots` → `getInventoryLots(site, inventoryId)` by SKU. Args `{site?, sku}`.
- `find_customer` → `wholesale_customers` + `findLastShipBobRecipient`. Args `{name}`. Returns the proven ship-to address and its provenance.
- `plan_order` → `planDirectOrder`. Args `{recipient_name, items:[{sku,quantity}], site?, path?, payment_term?, address?}`. **Never creates.**
- `create_order` → `createDirectOrder`. Same args + `idempotency_key` (required).
- `list_dockets` → `findDockets()`.
- `parse_docket` → `parseDocket(messageId, '', attachment)`.
- `create_wro` → `createWROFromParsed`. Args `{messageId, attachment?, idempotency_key}`.
- `recreate_wro` → `recreateWroForDocket`. Same args.
- `cancel_wro` → `cancelDocketWro`. Args `{wro_id?, docket_ref?}`.
- `list_transfers` / `get_transfer` → `listTransfers()`, `getTransfer(reference)`.
- `transfer_docs` → returns the doc list for a reference as **absolute URLs** to `/api/transfers/{reference}/{doc}`, plus a short-lived signed link if the doc route is ever locked down.
- `create_transfer` / `update_transfer_lines` / `set_transfer_status` → `transferBuilder.ts` + `transfers.ts`.
- `draft_email` → existing Gmail draft helpers (`draftSharonReply`, `draftMaerskSliEmail`). **Draft only — never send.**
- `send_email_draft` → sends a draft **by id only**, and only after explicit confirmation upstream.

Every response envelope:

```json
{ "ok": true, "data": {...}, "verified": {...} | null, "warnings": ["..."] }
```

`verified` = what the external system actually saved (read back from ShipBob/Xero), never what
we intended to send.

### Idempotency (non-negotiable)

Create a table:

```sql
create table if not exists ops_idempotency (
  key text primary key,
  tool text not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz default now()
);
```

Every mutating tool takes `idempotency_key`. On a repeat key: return the stored response
verbatim, do not re-execute. A dropped connection or double-tap on a phone must never ship
goods twice.

### Audit

Log every ops call (tool, args, actor, result summary, ms) to the existing `agent_actions`
table with `phone = 'grok:<chat_id>'` so it lands in the same audit trail as Batter.

## Deliverable 2 — the Grok bridge

New service (Vercel route in this repo is fine: `src/app/api/grok/route.ts`, or a separate tiny
worker). It runs the xAI tool loop:

- Endpoint `https://api.x.ai/v1/chat/completions`, OpenAI-compatible. Model: current grok-4
  class model — confirm the exact id at https://docs.x.ai/docs/models.
- Env: `XAI_API_KEY`, `OPS_API_TOKEN`, `OPS_BASE_URL=https://admin.theproteinpancake.co`.
- System prompt = **Part B below, verbatim.**
- Tool schemas mirror Deliverable 1 one-for-one. Descriptions matter more than names — port the
  wording from `src/lib/stockAgent.ts`, which has been tuned against real failures.
- Loop: up to 8 tool rounds, then answer. Persist conversation per chat id (Supabase table
  `grok_conversation`, same shape as `wa_conversation`, 26h window).
- On any tool error, relay the ACTUAL error text. Never invent a cause.

## Deliverable 3 — the phone surface

**Telegram bot** (fastest good mobile UX, free, supports voice notes and file replies):

- `POST /api/grok/telegram` webhook.
- **Allowlist `TELEGRAM_ALLOWED_CHAT_IDS`.** Anything else: ignore silently, log the attempt.
  This bot ships goods and spends money — an open bot is an open warehouse.
- Voice notes: download the OGG, transcribe (Whisper or xAI if available), feed as text.
- Return PDFs (WRO labels, CIPL docs) as Telegram **documents**, not links, so they can be
  forwarded straight to Sharon or Maersk from the phone.
- Confirmations via inline keyboard buttons (Confirm / Cancel), mirroring the WhatsApp buttons.

## Safety requirements (all mandatory)

1. **Two-step on every mutation.** Plan → show a human-readable summary → explicit confirm →
   execute. Never create on first mention, even if the request is unambiguous.
2. **Ceilings.** Any order > 500 units or > $5,000, or any email send, requires the user to type
   a word (not just tap) — e.g. "SEND". Tapping is too easy in a pocket.
3. Allowlist by chat id. Bearer token never enters the model context.
4. Idempotency keys on every mutating call, generated by the bridge, not the model.
5. The bot may **draft** emails; a human confirms before any send.
6. No secret, token or full address is ever echoed back into chat beyond what's needed to confirm.

## Acceptance tests

1. "Create a B2B order for Orca — 20 cartons of BMS, 10 of CIS" → plan shows Orca's proven
   ship-to, B2B path with reason, FIFO lot picks, freight + Prepaid; on confirm, order created;
   reply quotes `verified.products` and `verified.order_type: B2B`.
2. Repeat the exact confirm twice → one ShipBob order, second call returns the stored response.
3. "Any dockets from Sharon?" → list; "do the latest one" → parse, show pallets/lots, confirm,
   WRO created, labels PDF arrives as a Telegram document with one page per pallet.
4. "That WRO's wrong, redo it" → `recreate_wro` cancels and rebuilds; never tells the user to
   edit ShipBob by hand.
5. "Send me the CIPL for INTERNAL5" → commercial invoice + packing list arrive as documents.
6. A non-allowlisted chat id gets no response at all.
7. ShipBob returns a 500 → the bot relays the real error and offers a retry; it does not claim
   success and does not invent a cause.

---

# PART B — the bot's system prompt

**Lives in [`tools/grok-system-prompt.md`](../tools/grok-system-prompt.md)** — one source of
truth, loaded verbatim by the bridge at startup. Edit it there, not here. It carries the product
and SKU rules, the B2B/WRO/customs procedures, and the reporting discipline (ShipBob success
signal, report from `verified`, items only from the current message).
