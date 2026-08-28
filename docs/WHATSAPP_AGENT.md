# TPP WhatsApp Agent — What It Does

*Reference as of 18 Aug 2026, written from the deployed code. Source of truth: `src/lib/stockAgent.ts` (the agent), `src/app/api/whatsapp/*` (transport + proactive routes).*

---

## In one paragraph

A Claude-powered operations assistant that lives in WhatsApp. Luke (and Kate, with a reduced toolset) message it like a team member; it answers with live numbers pulled from ShipBob, Xero, Gmail, Shopify, Amazon and Meta, and it *executes* — drafting and sending ABC purchase orders, creating ShipBob receiving orders and transfers, processing wholesale POs into invoices and shipments, sending influencer gifts, and managing follow-ups. Alongside the conversational side, a set of scheduled jobs proactively message the team: the 7am sales review, Kate's 8am wholesale brief, the 9am logistics stock cards, anomaly alerts, and inbox-scanning pings.

---

## Who can talk to it

| Person | Channel | Access |
|---|---|---|
| **Luke** (owner/admin numbers) | WhatsApp | Full agent — all **61 tools**, including everything Kate has |
| **Kate** | WhatsApp | Wholesale & marketing agent — **35 tools** (stock/expiry/packaging/PO/transfer *reads*, wholesale processing, influencers/collabs, follow-ups). Ordering, transfers, receiving and billing are excluded; she's told to flag those to Luke |
| **Anyone in the dashboard** | Admin dashboard chat (`/api/assistant`) | Same brain, full owner toolset, no WhatsApp — shares the same conversation memory under a `web-dashboard` key |

Numbers not on the allow-list (`WHATSAPP_ALLOWED_NUMBERS`) are ignored entirely. Roles come from `app_users` in Supabase (owner/admin → full agent; anyone else → Kate's variant).

## How a message flows

- **Provider:** Twilio WhatsApp. Replies are sent back through Twilio with retries; long answers are split (1,550-char limit per message).
- **What it can read:** text, up to 4 **images** per message (screenshots are treated as primary data — it scans them fully and echoes what it extracted, since images expire from its memory after 15 minutes), and up to 3 **PDFs** (≤25 MB). **Voice notes are not supported** — see gaps below.
- **Multi-image batching:** WhatsApp delivers each image as a separate webhook, so pieces are buffered ~8 seconds and processed as one message — this is what stopped the duplicate-reply behaviour.
- **Memory:** last 18 turns within a 26-hour window, per phone number. Saying **"reset"** (or "new chat" / "start fresh") wipes the conversation instantly — handled in code, not by the model.
- **Quick-reply buttons:** the agent can attach up to 3 tap-buttons to a reply (falls back to "Reply with A / B" as plain text).
- **Playbooks:** standing procedures live in the `agent_playbooks` Supabase table and are loaded into the agent's instructions on *every* message — behaviour can be changed without a deploy.
- **Audit:** every state-changing tool call writes an `agent_actions` row (who, which tool, summary).
- **Model:** `claude-sonnet-5`, up to 14 tool calls per message (upgraded from Sonnet 4.6 on 13 Jul after it improvised under messy context).

## Personality & operating rules (condensed from the system prompt)

- The logistics ops assistant for TPP across two sites — **Altona (AU)** and **Manchester (UK)**. Gen-Z-flavoured, playful but sparing with slang; serious whenever money, POs, WROs or stock are involved. Short WhatsApp-friendly messages, no markdown tables, lead with the answer.
- **Never claims it can't do something without trying the tool first**, and never invents numbers — every figure comes from a tool call. Never reports an order/invoice/email as created or sent unless the tool returned proof.
- Classifies every message as exactly one of: wholesale order, influencer gift, collab, or general question — and never mixes them in one reply.
- Approval gates on everything consequential: approving/sending POs, creating receiving orders, sending invoices, creating wholesale orders, and sending any email draft (drafts are shown verbatim, never paraphrased).
- Never overstates logistics status ("in transit" ≠ "landed"; stock is "received" only when ShipBob has counted it in).
- Answers multi-SKU stock/expiry questions with the visual **cards** rather than walls of text; 320g is always quoted in cartons of 4.
- Deep domain rules baked in: ABC PO structure (one flavour per PO, 500 kg multiples, size split by live velocity), UK transfer sizing (75-day transit + ~180 days of cover, 900-unit pallets), the two-email Maersk booking flow, box-selection logic, wholesale freight rules, and OOS/MOQ substitution policy.

## What it can do — the 61 tools, grouped

**Stock & expiry** — live stock per SKU per site (with days of cover and inbound), the stock card image, batch/best-before data, the expiry card image, packaging stock (pouches, SRP cartons, shipping boxes), and recording restock ETAs for out-of-stock flavours.

**ABC purchase orders** — list POs and the 3-month forecast, propose right-sized orders per flavour, draft a PO (with a preview image), push it to Xero as authorised, send the ABC email (Sharon, cc Stephen, PDF attached), and mark POs received (which also bills them in Xero).

**Receiving (WRO flow)** — find ABC delivery dockets in Gmail, parse a docket (SKUs, lots, best-befores, pallet build from the Note field), create the ShipBob receiving order with one label per pallet, and draft the reply to Sharon with the labels attached.

**UK transfers** — suggest a transfer sized for transit + cover, create/update the draft, generate and send the Commercial Invoice + Packing List, preview and create the ShipBob side (AU B2B order + Manchester WRO with long-dated lots), draft the two Maersk emails (booking to Viviana; pickup + SLI to the AU logistics desk), track status through customs to received, and surface who to chase at Maersk right now.

**Packaging (VISY)** — draft packaging orders to Amanda, create pallet labels once she confirms the configuration, and track order status end to end.

**Wholesale** — the wholesale dashboard (sales, who's due to reorder, lapsed customers), searching both Kate's and Luke's inboxes for customer POs, parsing POs in any format (text, tables, CSV, PDF) with stock checks and box selection, creating the ShipBob order + drafted Xero invoice, and authorising + emailing the invoice.

**Influencers & collabs** — send a gift order (auto-picks the fulfilment site from the address and logs the creator to the dashboard), look up/alias/update influencers, track gift delivery status, and save/track brand collabs.

**Direct sends** — plan and create one-off ShipBob shipments (samples, expo stock) with stock checks and the right B2C/B2B path.

**Analytics & money** — blended MER by week (both conventions, split by channel), daily Amazon sales per market, and monthly ShipBob fulfilment spend with cost outliers worth disputing.

**Workflow & admin** — the numbered Action Center priority list (and clearing items with a decision note), tuning what appears in the daily brief, completing staff-board tasks, scheduling/listing/cancelling WhatsApp follow-up reminders, the supplier contact directory, and sending any prepared Gmail draft.

## What it does without being asked

| When | What | To whom |
|---|---|---|
| **7am daily** | Sales review (plus a weekly wrap on Mondays). Has a verified-delivery ladder — retries via template, and falls back to **email** if WhatsApp is blocked | Luke |
| **8am daily** | Kate's wholesale brief — sales, who to chase, 320g stock, marketing | Kate |
| **9am daily** | Logistics brief — the AU and UK stock **cards** (images only since 27 Jul), plus up to 3 restock actions | Luke |
| **Every 15 min** | Fires due follow-up reminders; also the safety net that emails the sales review if every WhatsApp copy went undelivered | Whoever set them |
| **~Every 3h, 8am–9pm** | **Watchdog** anomaly alerts: sales pacing under 60% of forecast, Meta CPA blowout, key SKUs under 14 days' cover with nothing inbound, Amazon flatlines. Deduped weekly per issue ("I don't like being spammed") | Luke |
| **9:30am daily** | **Health check** on the machine itself — briefs that didn't run, data pipelines gone stale, unmapped SKUs. Silent when healthy | Luke |
| **Frequently (see gaps)** | **Wholesale inbox scour** — finds new customer POs in both inboxes, parses + stock-checks them, pings Kate with buttons; auto-drafts stockist replies for OOS lines and watches for their answers | Kate |
| **Several times daily** | **Logistics inbox scour** — Maersk/ABC/ShipBob status extraction into the Action Center, VISY tracking, CDS customs-clearance detection (drafts the ShipBob email and asks for approval), PO↔WRO reconciliation, Xero bill sync | Luke |
| Weekly | Copy-paste week-in-review (last completed Mon–Sun) | Luke |
| Event-driven | Task-assignment pings from the staff board | Owner |

All proactive sends use Meta-approved WhatsApp templates (13 of them) so they deliver outside the 24-hour session window, and each one writes context into the conversation so you can reply "done" or "snooze a day" and the agent knows what you mean.

## The picture cards

Four media endpoints render the visuals the agent attaches:

- **Stock card** — per-flavour availability with product shots, overlaying *live* ShipBob numbers on the snapshot so it's never stale; 320g in cartons.
- **Expiry card** — the 12 soonest-dated lots, colour-coded by days left.
- **PO preview** — the draft purchase order as a card (supplier, lines, totals).
- **WRO pallet labels** — the PDF ShipBob needs, one page per pallet.

---

## ⚠️ Gaps worth closing (found during this review)

1. **No Twilio signature verification on the webhook.** The endpoint is public and trusts the `From` field; a forged POST spoofing an allow-listed number would reach the agent with full tool access. *Highest priority — small fix (validate `X-Twilio-Signature`).*
2. **PO preview and pallet-label URLs are unauthenticated** — sequential IDs could enumerate PO financials. The stock/expiry cards already have a token guard; these two should match.
3. **Voice notes are silently ignored** — no reply at all. At minimum it should say "can't do voice notes yet, type it for me 🙏"; transcription would be the full fix.
4. **Four state-changing tools skip the audit log** (`create_direct_order`, `send_wholesale_invoice`, `set_influencer_alias`, `complete_task`) — they create real orders/invoices with no `agent_actions` row.
5. **Cron schedules live only in the Vercel dashboard** — the repo has no `vercel.json`, and two in-code comments disagree about the scour frequencies. Worth committing the schedule to the repo (this exact pattern silently broke the Syrup health-check cron).
6. **Kate's number has a hardcoded fallback** in code and her briefs bypass the allow-list — fine today, a surprise waiting for a staffing change.
