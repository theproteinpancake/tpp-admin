// Claude agent that answers logistics questions + drafts POs (used by WhatsApp).
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { computeStatus, STATUS_META, PRIMARY_FLAVOURS } from './stock';
import { OPEN_STATUSES } from './po-types';
import { proposeFlavourPOs, proposeOneFlavour } from './poBuilder';
import { draftWhatsAppPO, approveLatestWhatsAppDraft, sendLatestPOEmail } from './poActions';
import { markPOReceived } from './poReconcile';
import { findLatestDocket, parseDocket, createWROFromParsed, draftSharonReply } from './wroFlow';
import { resolveVisyItem, draftVisyOrder, markVisyOrderSent, getVisyOrders } from './visyOrder';
import { findContacts } from './contacts';
import { getPackagingSummary } from './packaging';
import { gmailSendDraft, gmailCreateDraft, gmailDeleteDraftsBySubject, gmailSearch, gmailGetBody, gmailGetAllAttachments } from './google';
import { getLots, expiryStatus, EXPIRY_META } from './lots';
import { getShippingData } from './shipping';
import { getBillingData, buildHighlights } from './billing';
import { getTransfer, transferUnits, transferValue, setTransferStatus, updateTransferLines } from './transfers';
import { suggestRestock, createDraftTransfer } from './transferBuilder';
import { getActionCenter, dismissBriefItems } from './actionCenter';
import { setConfig } from './settings';
import { melbMidnightUtc } from './tz';
import { getPoForecast } from './poForecast';
import { MAERSK, IMPORTER } from './transferConstants';
import { renderCommercialInvoice, renderPackingList } from './transferPdf';
import { previewTransferShipbob, createTransferWro, lotDateCheck } from './transferShipbob';
import { sendWhatsApp, senderRole, waAddr } from './whatsapp';
import { processWholesalePO, processWholesalePOMulti, oosReplyBody } from './wholesalePO';
import { createWholesaleOrder, sendWholesaleInvoice } from './wholesaleActions';
import { getWholesaleDashboard } from './wholesale';
import { sendInfluencerGift, updateInfluencerStatus, updateInfluencerDetails, listInfluencers, likelyToPost, saveCollab, updateCollab, listCollabs, findInfluencer, setInfluencerAlias } from './marketing';
import { setRestockEta } from './restock';
import { xlsxToText } from './xlsx';

const APP_URL = process.env.PUBLIC_APP_URL || 'https://admin.theproteinpancake.co';
const TRANSFER_DOC_LIST: [string, string][] = [['commercial-invoice', 'Commercial Invoice'], ['packing-list', 'Packing List']];

const MODEL = 'claude-sonnet-4-6';

// Tools that CHANGE something (orders, invoices, emails, statuses) — logged to agent_actions.
const MUTATING_TOOLS = new Set([
  'approve_po', 'send_po_email', 'create_wro', 'send_email_draft', 'create_transfer',
  'update_transfer_status', 'mark_po_received', 'create_wholesale_order', 'process_po_email',
  'send_influencer_gift', 'update_influencer_status', 'update_influencer_details', 'save_collab', 'update_collab',
  'mark_brief_done', 'set_restock_eta', 'update_logistics_brief_excludes',
  'schedule_followup', 'cancel_followup', 'draft_po', 'order_packaging', 'create_transfer_wro',
  'update_transfer_lines',
]);

const tools: Anthropic.Tool[] = [
  {
    name: 'mark_brief_done',
    description: 'Clear items from the morning brief that the user has handled, by their NUMBER. Use when the user replies to the brief with numbers (e.g. "1, 3 done", "disregard 2 and 5", "8 — I provisioned Manildra so it\'s underway"). Pass the numbers and, if they gave a reason/decision, the note (so it\'s remembered). Cleared items won\'t resurface in tomorrow\'s brief. The brief items are numbered in the order they were shown.',
    input_schema: {
      type: 'object',
      properties: {
        numbers: { type: 'array', items: { type: 'number' }, description: 'the brief item numbers to clear' },
        note: { type: 'string', description: 'optional decision/reason to remember, e.g. "provisioned Manildra, Buttermilk + Cinnamon underway"' },
      },
      required: ['numbers'],
    },
  },
  {
    name: 'get_stock',
    description: 'Live stock per SKU per site: on hand, available, days of cover, inbound (pending PO units), velocity and a status. Use filters to narrow.',
    input_schema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: ['ALTONA', 'MANCHESTER'] },
        tier: { type: 'string', enum: ['primary', 'secondary'] },
        search: { type: 'string', description: 'flavour or SKU substring' },
        needs_attention: { type: 'boolean', description: 'only out of stock / low cover' },
      },
    },
  },
  {
    name: 'get_purchase_orders',
    description: 'Purchase orders with supplier, status, expected date and outstanding (inbound) units.',
    input_schema: { type: 'object', properties: { open_only: { type: 'boolean' } } },
  },
  {
    name: 'get_po_forecast',
    description: 'The 3-month rolling ABC purchase-order schedule for Altona — which SKUs to order in which month (live velocity, 30-day lead), grouped by month. Use for "what\'s my PO schedule", "what do I need to order over the next few months", "June/July PO plan".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_reorder_recommendations',
    description: 'Per-flavour ABC purchase-order proposals for Altona. Each is ONE flavour, totalling a 500kg MULTIPLE (500kg / 1T / 1.5T), split across that flavour\'s sizes by live velocity + cover, accounting for inbound. 320g lines are shown as units AND cartons (units÷4). Use for "what should I order from ABC".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'draft_po',
    description: 'Create a DRAFT PO (ABC → Altona, not sent) for ONE flavour — pass `flavour` (e.g. "Buttermilk"). By default builds a 500kg-MULTIPLE order sized to demand, split across that flavour\'s sizes (320g as units + cartons). If the user specifies an exact size (e.g. "500kg", "just 500", "one tonne", "1.5T"), pass `order_kg` to pin it EXACTLY instead of auto-rounding to demand. Returns a screenshot; tell the user to reply SEND. (Pass explicit `items` only to fully override the lines.)',
    input_schema: {
      type: 'object',
      properties: {
        flavour: { type: 'string', description: 'the single flavour to order, e.g. "Buttermilk", "Maple", "GF Cinnamon Churro"' },
        order_kg: { type: 'number', description: 'exact total kg to order when the user specifies a size (e.g. 500, 1000, 1500). Omit to auto-size to demand. For 1kg bags, units == kg.' },
        items: {
          type: 'array',
          description: 'optional explicit line override (product_id + qty_ordered units)',
          items: { type: 'object', properties: { product_id: { type: 'string' }, qty_ordered: { type: 'number' } } },
        },
      },
    },
  },
  {
    name: 'approve_po',
    description: 'ONLY call when the user has EXPLICITLY approved sending (e.g. "send it", "approve", "yes send to ABC"). Pushes the most recent draft PO to Xero as an approved order.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'send_po_email',
    description: 'Send the PENDING ABC PO email (the Gmail draft created when a PO was approved) to ABC — To: Sharon, CC: Stephen, with the PO PDF. ONLY call when the user explicitly confirms sending the email to ABC ("send to ABC", "send it to ABC", "fire it over", "yep send the email"). This is the final step AFTER approve_po has drafted it.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'mark_po_received',
    description: 'Mark a PO as RECEIVED/DELIVERED (e.g. "mark PO-0033 as delivered", "PO-0021 has landed, close it"). Removes it from inbound-stock estimates and marks it Billed in Xero so it is no longer "expected". Use this when a PO is old/stale or its goods have arrived. Pass the exact po_number (from get_purchase_orders).',
    input_schema: {
      type: 'object',
      properties: { po_number: { type: 'string', description: 'exact PO number, e.g. "PO-0033"' } },
      required: ['po_number'],
    },
  },
  {
    name: 'get_expiring_stock',
    description: 'Batch/lot best-before data — stock with the soonest expiry per site (lot number, best-before date, days left, units, status). Use for "what expires soonest / shortest-dated / batch best-befores / expiry".',
    input_schema: { type: 'object', properties: { site: { type: 'string', enum: ['ALTONA', 'MANCHESTER'] } } },
  },
  {
    name: 'get_action_center',
    description: 'The proactive priority list across BOTH sites — what needs the founder\'s attention now: UK transfers due, ABC POs to place, packaging to reorder, expiring stock, billing flags. Use for "what needs my attention", "what should I action today", "anything I need to do", or to open a conversation proactively.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'suggest_transfer',
    description: 'Preview a UK (Manchester) restock transfer WITHOUT creating it. UK transfers are 520g MEDIUM BAGS ONLY (no 320g, no 1kg — current UK roll-out). LEAD-TIME AWARE: a transfer takes ~75 days (2.5 months) to arrive, so each line is sized to cover demand through the WHOLE transit PLUS ~180 days after arrival, minus on-hand + inbound. This is the key fix — in-flight inbound (e.g. INTERNAL2) is discounted by what will sell during transit, so best sellers get topped up properly instead of looking "covered". Then it MAXIMISES the pallet(s) with best sellers by velocity, capped by Altona stock. Pallet = 75 cartons × 12 = 900 units (~468kg). Returns each line with uk_cover_now_days AND uk_cover_at_arrival_days (the one that matters). Pass `pallets` to force a count. Syrup/accessories NOT auto-included. Use for "build a transfer / INTERNAL3". Show lines + totals (call out anything stocking out before arrival) and confirm before create_transfer.',
    input_schema: { type: 'object', properties: { destination: { type: 'string', enum: ['MANCHESTER'] }, pallets: { type: 'number', description: 'force number of pallets to fill (default: 1, or enough to hold the cover)' } } },
  },
  {
    name: 'create_transfer',
    description: 'Create the DRAFT transfer (after the user confirms a suggest_transfer preview). Returns the reference (e.g. INTERNAL3). It appears on the Transfers page with auto-generated Commercial Invoice + Packing List. ONLY call after explicit user confirmation. Pass the SAME `pallets` value used in the preview so the created transfer matches.',
    input_schema: { type: 'object', properties: { destination: { type: 'string', enum: ['MANCHESTER'] }, pallets: { type: 'number' } } },
  },
  {
    name: 'send_transfer_docs',
    description: 'Send a transfer\'s shipping documents (Commercial Invoice + Packing List PDFs) to the user on WhatsApp for review. Use when the user asks to see/send the docs for a transfer (e.g. "send me the INTERNAL2 docs").',
    input_schema: { type: 'object', properties: { reference: { type: 'string', description: 'transfer reference e.g. INTERNAL2' } }, required: ['reference'] },
  },
  {
    name: 'update_transfer_lines',
    description: "Amend a DRAFT transfer's manifest from chat — the SKUs + unit quantities — e.g. after seeing short-dated stock the user drops or changes lines. Pass the FULL desired line set as `lines` [{sku, units}]; it REPLACES all current lines and recomputes cartons + value. Use when the user changes transfer contents (\"remove CHM, GFBM, SCM; set CIM to 216, MAM to 156\"): work out the resulting full manifest and pass it. Afterwards the CI/Packing List regenerate from the new lines — offer send_transfer_docs.",
    input_schema: { type: 'object', properties: { reference: { type: 'string' }, lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, units: { type: 'number' } }, required: ['sku', 'units'] } } }, required: ['reference', 'lines'] },
  },
  {
    name: 'preview_transfer_shipbob',
    description: "PREVIEW (creates nothing) the ShipBob side of an AU→UK transfer: the AU B2B order out of Altona to the Manchester FC, and the Manchester WRO to receive it — with the recommended LOT allocation per SKU (longest best-before dates, single-lot-preferred, so UK stock isn't short-dated). Use for 'generate/preview the shipbob items', 'AU B2B order + UK WRO', 'what lots would we send'. Returns the plan + any warnings (short-dated lots, shortfalls, unmapped SKUs). Creating them for real isn't wired up yet — show the user this preview and the lot picks.",
    input_schema: { type: 'object', properties: { reference: { type: 'string', description: 'transfer reference e.g. INTERNAL4' } }, required: ['reference'] },
  },
  {
    name: 'create_transfer_wro',
    description: "Create the UK (Manchester) receiving WRO for a transfer from the AU order's units + selected lots + best-befores, and WhatsApp the user its label to attach to the AU B2B order before the pallet ships. Call this AFTER the user has placed the AU B2B order in ShipBob (pass au_order_ref if they give the order number). It uses the same recommended long-dated lots as preview_transfer_shipbob. Idempotent (won't duplicate). Report the WRO # + that the label's been sent.",
    input_schema: { type: 'object', properties: { reference: { type: 'string', description: 'transfer reference e.g. INTERNAL4' }, au_order_ref: { type: 'string', description: 'the AU B2B ShipBob order number, if known' } }, required: ['reference'] },
  },
  {
    name: 'draft_transfer_email',
    description: 'Draft (NOT send) the booking email to Viviana at Maersk (quote & booking — she replaced Jordan Burnes) to start/progress a transfer, with links to the Commercial Invoice + Packing List. Show the user the draft; only send_email_draft when they explicitly approve. For who to chase at later stages (BL, customs, UK delivery) use get_uk_pallet_contacts.',
    input_schema: { type: 'object', properties: { reference: { type: 'string' } }, required: ['reference'] },
  },
  {
    name: 'get_packaging_stock',
    description: "Our PACKAGING stock — empty pouches + shelf-ready SRP cartons that ABC holds (used on the packing line) and the shipping cartons ShipBob Altona holds (live). Use this for ANY packaging/carton/pouch/SRP question, 'how is our packaging looking', or 'what does ABC have on hand' (ABC holds EMPTIES, not finished product). This is the Packaging-page data. Do NOT use get_stock for packaging — that's finished goods.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_visy_orders',
    description: "List our VISY packaging orders and their live status (drafted → ordered → confirmed → dispatched → delivered, plus invoices/queries) — updated automatically by scanning Amanda's emails. Use for 'what's the status of my VISY orders', 'has the Buttermilk SRP shipped', 'any updates from VISY'. Pass open_only:true to hide delivered/cancelled.",
    input_schema: { type: 'object', properties: { open_only: { type: 'boolean' } }, required: [] },
  },
  {
    name: 'find_contact',
    description: "Look up a supplier / logistics contact from the directory (ABC Blending, VISY, the pouch supplier in China, ShipBob ops people, maple-syrup manufacturer, freight providers, etc.). Use when the user asks for someone's email/phone/address or 'who do I contact for X'. Pass a name, company, or category word (e.g. 'Janny', 'ABC', 'pouches', 'ShipBob escalation', 'freight').",
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'name / company / category, e.g. "Janny", "ABC address", "ShipBob escalation"' } }, required: ['query'] },
  },
  {
    name: 'order_packaging',
    description: "Draft (NOT send) a VISY packaging order to Amanda when we're low on SRP cartons or shipping cartons. Pass `item` as a flavour, pouch SKU (e.g. BMS), carton name, or VISY code; optionally `qty` (defaults to the item's standard order quantity, usually 1000 for SRP). SRP cartons deliver to ABC Blending (packing line — no WRO). ShipBob shipping cartons deliver to ShipBob Altona and a WRO is generated with one pallet (and one label page) per 1,000 units. Always show the user the drafted email + quantity + destination + pallet count, and on approval call send_email_draft with the returned draft_id — never re-call order_packaging to send.",
    input_schema: { type: 'object', properties: { item: { type: 'string', description: 'flavour / pouch SKU / carton name / VISY code, e.g. "BMS", "Buttermilk SRP", "PANSMALL"' }, qty: { type: 'number', description: 'units to order (optional; defaults to the standard order qty)' } }, required: ['item'] },
  },
  {
    name: 'update_transfer_status',
    description: 'Move a transfer to a new status as it progresses: in_transit (en route) → customs (clearing customs in-country) → arrived (at the ShipBob FC, being put away) → received (counted into ShipBob inventory, now sellable). CRITICAL: only set "received" once ShipBob has ACTUALLY received the goods into inventory — confirmed by the ShipBob receiving/goods-in EMAIL or the WRO receiving status showing complete. NEVER mark received off an ETA or because it "arrived in country". Use when the user says e.g. "INTERNAL2 cleared customs", "ShipBob received INTERNAL2", "the pallet landed".',
    input_schema: {
      type: 'object',
      properties: {
        reference: { type: 'string', description: 'transfer reference e.g. INTERNAL2' },
        status: { type: 'string', enum: ['draft', 'in_transit', 'customs', 'arrived', 'received', 'cancelled'] },
      },
      required: ['reference', 'status'],
    },
  },
  {
    name: 'get_internal_transfers',
    description: 'Internal stock transfers between sites (e.g. Altona AU → Manchester UK pallets). Returns reference, status, ETA, carrier/BL, and the SKUs + units inbound. These units already count toward the destination site\'s inbound stock. Use for "what\'s on the way to the UK / Manchester", "the pallet", "internal transfer", "INTERNAL2".',
    input_schema: { type: 'object', properties: { reference: { type: 'string', description: 'optional transfer reference e.g. INTERNAL2' } } },
  },
  {
    name: 'get_uk_pallet_contacts',
    description: 'The Maersk UK-pallet contact map + escalation guide: WHO to contact/bump to push the AU→UK LCL pallet forward at its current stage (and the UK-customs timing cheat sheet). Returns the stage-by-stage contacts AND the live UK transfer status so you can name the exact person/email to chase right now. Use for "who do I bump now", "who to chase/push on the UK pallet / Maersk / customs / INTERNAL2", "how do we move the pallet along", escalation/contact questions.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'schedule_followup',
    description: 'Schedule a FUTURE reminder/follow-up that I will WhatsApp the user when due. Use whenever the user says "remind me…", "chase X on Friday", "follow up if no reply by…", "ping me when…(a date/time)", or when YOU promise to check back on something. Pass due_at as ISO date-time in MELBOURNE local time (e.g. "2026-06-12T09:00"). Confirm what was scheduled and for when.',
    input_schema: {
      type: 'object',
      properties: {
        due_at: { type: 'string', description: 'when to fire, Melbourne local, e.g. "2026-06-12T09:00" (default 9am if no time given)' },
        message: { type: 'string', description: 'what to say when it fires, e.g. "Chase Izabela — no customs update on INTERNAL2"' },
        context: { type: 'string', description: 'optional extra context so you can act when the user replies' },
      },
      required: ['due_at', 'message'],
    },
  },
  {
    name: 'list_followups',
    description: 'List the user\'s pending follow-ups/reminders (id, due, message). Use for "what reminders do I have", "what are you chasing", or before cancelling one.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_followup',
    description: 'Cancel a pending follow-up by id (from list_followups). Use when the user says it\'s done/no longer needed.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'update_logistics_brief_excludes',
    description: 'Hide or re-show specific SKUs in the daily LOGISTICS BRIEF\'s stock list, per site. Use when the owner says e.g. "don\'t remind me of GFBS/BMS/MAS/CIS in the UK going forward", "stop showing X in the brief", "those sizes aren\'t stocked in the UK", or "start showing X again". Pass the SITE (AU or UK), the exact SKU codes, and the action. After updating, confirm what\'s now hidden.',
    input_schema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: ['AU', 'UK'], description: 'which site\'s stock list' },
        skus: { type: 'array', items: { type: 'string' }, description: 'SKU codes e.g. ["GFBS","BMS","MAS","CIS"]' },
        action: { type: 'string', enum: ['exclude', 'include'], description: 'exclude = hide from the brief; include = show again' },
      },
      required: ['site', 'skus', 'action'],
    },
  },
  {
    name: 'get_wholesale_overview',
    description: 'Wholesale business snapshot: sales totals (this week/month/year vs prior), customers DUE to reorder (past their avg order interval), LAPSED customers (gone quiet), top customers, and the 320g wholesale stock + when to reorder from ABC. Use for "wholesale sales", "who\'s due to order", "who should I chase", "how\'s wholesale going", "320g stock".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'find_po_email',
    description: 'Search the wholesale inbox(es) — Kate\'s (kate@) AND Luke\'s (luke@) — for recent customer PO emails (POs land in either). Use when the user refers to a PO "that came through" / a customer order (e.g. "reprocess the Wholefood Merchants PO"). Pass `search` with the store/customer name. Returns matching emails (id, inbox, from, subject, date, snippet) newest-first — pick the right one, note its inbox, then process_po_email(id, inbox).',
    input_schema: {
      type: 'object',
      properties: { search: { type: 'string', description: 'store/customer name or keywords, e.g. "Wholefood Merchants"' } },
    },
  },
  {
    name: 'process_po_email',
    description: 'Read a PO email by id (from find_po_email) and parse it into an order — handles ANY format automatically: plain text, HTML tables, CSV attachments, and PDF attachments (reads them all, dedupes the same order across formats, maps to 320g SKUs + checks stock + picks box + shipping). Use this (not read_email) to process a customer PO from the inbox. Pass `inbox` from the find_po_email result, and `exclude` for flavours to leave off.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'email id from find_po_email' },
        inbox: { type: 'string', enum: ['kate', 'luke'], description: 'which inbox the email is in (from find_po_email)' },
        exclude: { type: 'array', items: { type: 'string' }, description: 'flavours to leave off, e.g. ["Buttermilk"]' },
      },
      required: ['id'],
    },
  },
  {
    name: 'read_email',
    description: 'Read the raw body text of an email by id (for non-PO emails or quick inspection). Pass `inbox` (kate/luke) from find_po_email. For customer POs use process_po_email instead.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, inbox: { type: 'string', enum: ['kate', 'luke'] } }, required: ['id'] },
  },
  {
    name: 'parse_wholesale_po',
    description: 'Parse a customer wholesale PO (free text or a forwarded email — e.g. "4 cartons of buttermilk, 2 cinnamon churro" or "BMS x4, CIS x2"), map it to 320g SKUs, CHECK Altona stock can fulfil it, pick the ShipBob box (PANOUTERSMALL ≤4 cartons / PANOUTER ≤8 / PANXLARGE for 2), and apply free shipping (>4 cartons). Returns a verified summary to show Kate before processing. If a flavour is short/OOS, returns a suggested OOS reply. Use whenever Kate forwards/pastes a PO.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'the raw PO text / forwarded email body' },
        exclude: { type: 'array', items: { type: 'string' }, description: 'flavours to leave off, e.g. ["Buttermilk"]' },
      },
      required: ['text'],
    },
  },
  {
    name: 'create_wholesale_order',
    description: 'ACTUALLY process a confirmed wholesale PO — creates the ShipBob B2C order (carton SKUs + the box) AND drafts the Xero invoice to the customer. ONLY call after Kate has CONFIRMED the parsed summary AND the customer is on file in Xero. Fill from the confirmed PO: customer_name (the matched Xero contact), recipient (ship-to store + structured address), lines (sku + cartons), box, free_shipping, reference (PO number). After it returns, report back EXACTLY what was created (ShipBob order id + contents, Xero invoice number) for Kate to cross-check before sending.',
    input_schema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string' },
        recipient: {
          type: 'object',
          properties: { name: { type: 'string' }, address1: { type: 'string' }, address2: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, zip_code: { type: 'string' }, country: { type: 'string' }, email: { type: 'string' } },
          required: ['name', 'address1', 'city', 'zip_code', 'country'],
        },
        lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, cartons: { type: 'number' } } } },
        box: { type: 'string', enum: ['PANOUTERSMALL', 'PANOUTER', 'PANXLARGE'] },
        free_shipping: { type: 'boolean', description: 'true = no freight (4+ cartons, the MOQ); false = add the $15 GST-free FREIGHT line (1-3 cartons, OR when Kate explicitly says to add freight).' },
        reference: { type: 'string', description: 'Xero invoice Reference. Use the customer\'s PO number if they gave one. If there is NO PO number (e.g. a casual email order), use "{Contact first name} Email {DD/MM/YYYY}" with today\'s date — e.g. "Rebekah Email 08/06/2026".' },
      },
      required: ['customer_name', 'recipient', 'lines', 'box', 'free_shipping'],
    },
  },
  {
    name: 'send_wholesale_invoice',
    description: 'Authorise + email the drafted wholesale Xero invoice to the customer. ONLY after Kate has cross-checked that the ShipBob order matches the Xero invoice and says to send. Pass the xero_invoice_id returned by create_wholesale_order.',
    input_schema: { type: 'object', properties: { invoice_id: { type: 'string' } }, required: ['invoice_id'] },
  },
  {
    name: 'send_influencer_gift',
    description: 'Send an influencer a gifting order via ShipBob (standard B2C) AND log them to the Influencers dashboard. Use when Kate sends an influencer\'s details (often a screenshot of their IG chat with name/address/email). Read the screenshot for name, address, email, and Instagram handle. Auto-adds the right box (PANSMALL for 1–2× 520g). ALWAYS report back EXACTLY what was added. site is OPTIONAL — leave it out and it auto-picks by address: AU or NZ address → ALTONA, UK address → MANCHESTER. Only set site (or ask) for other countries, or when Kate explicitly says which warehouse.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' }, handle: { type: 'string', description: 'Instagram handle e.g. @someone' },
        followers: { type: 'number', description: 'follower count as a number (e.g. 142000) — ALWAYS pass when visible in a profile screenshot' },
        aliases: { type: 'string', description: 'nickname(s) to register for future "send to X", e.g. "Regina"' },
        email: { type: 'string' },
        address1: { type: 'string' }, address2: { type: 'string' }, city: { type: 'string' },
        state: { type: 'string' }, zip_code: { type: 'string' }, country: { type: 'string' },
        flavour: { type: 'string', description: 'e.g. "Buttermilk", "GF Cinnamon Churro"' },
        size_g: { type: 'number', enum: [320, 520, 1000], description: 'pack size in grams (520 = the common gifting size)' },
        qty: { type: 'number', description: 'number of bags (default 1)' },
        site: { type: 'string', enum: ['ALTONA', 'MANCHESTER'] },
        force: { type: 'boolean', description: 'proceed even if the flavour is OUT OF STOCK (creates a backorder that auto-fulfils when restocked) — ONLY after Kate explicitly confirms' },
      },
      required: ['name', 'address1', 'city', 'zip_code', 'country', 'flavour', 'size_g'],
    },
  },
  {
    name: 'find_influencer',
    description: 'Look up a known/repeat influencer or affiliate by name, @handle, or registered nickname/alias (e.g. "Regina" → regs_healthy_eats). Returns their saved shipping address, email, handle and region so you can re-gift WITHOUT asking again. Use when the user says "send X to <a name we already know>".',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'name, handle, or nickname e.g. "Regina"' } }, required: ['query'] },
  },
  {
    name: 'set_influencer_alias',
    description: 'Register a nickname/alias for an existing influencer so future "send to <alias>" works (e.g. set alias "Regina" on regs_healthy_eats, who ships via her US family member Luis). Use when the user says e.g. "Regina is regs_healthy_eats" or "save Regina as regs".',
    input_schema: { type: 'object', properties: { name_or_handle: { type: 'string' }, alias: { type: 'string' } }, required: ['name_or_handle', 'alias'] },
  },
  {
    name: 'update_influencer_status',
    description: 'Update an influencer\'s DELIVERY status: order_processing → shipped → delivered → completed. (Posting is tracked separately as Posted Status.) Use when the user updates delivery progress. Match by name or @handle.',
    input_schema: {
      type: 'object',
      properties: { name_or_handle: { type: 'string' }, status: { type: 'string', enum: ['order_processing', 'shipped', 'delivered', 'completed'] } },
      required: ['name_or_handle', 'status'],
    },
  },
  {
    name: 'update_influencer_details',
    description: "Fix or complete an influencer's RECORD after the fact: full name, email, handle, followers, address, notes. Use when the user says e.g. \"add her last name\", \"her email is on this screenshot\", \"fix the address\". Match by name/@handle/alias; pass ONLY the fields to change. This is the ONLY way a record actually changes — NEVER tell the user a record was updated unless this tool returned ok:true.",
    input_schema: {
      type: 'object',
      properties: {
        name_or_handle: { type: 'string' },
        name: { type: 'string', description: 'full name, e.g. "Katrina Lander"' },
        email: { type: 'string' }, handle: { type: 'string' }, followers: { type: 'number' },
        address: { type: 'string', description: 'full address as one line' }, notes: { type: 'string' },
      },
      required: ['name_or_handle'],
    },
  },
  {
    name: 'get_influencers',
    description: 'List influencers + their gift, date received, status and tracking; includes who is "most likely to post next". Use for "who have we gifted", "influencer status", "who should post soon".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'save_collab',
    description: 'Save/bookmark a business collab or partnership (often from a screenshot of a chat). Use when Kate describes a collab e.g. "Mingle Seasoning — no collab right now, just sending sample stock" or "Sunday Funday sending 20 bags for a joint giveaway on 30 June". Capture partner name, IG handle, email, address if shown, the type, due/event date, and whether we\'re expecting samples (+ qty). Re-saving the same partner updates them.',
    input_schema: {
      type: 'object',
      properties: {
        partner_name: { type: 'string' }, handle: { type: 'string' }, email: { type: 'string' }, address: { type: 'string' },
        collab_type: { type: 'string', description: 'giveaway / content / samples / partnership / none' },
        due_date: { type: 'string', description: 'event/collab date YYYY-MM-DD if mentioned' },
        expecting_samples: { type: 'boolean' }, sample_qty: { type: 'number' },
        description: { type: 'string', description: 'short summary of the arrangement' },
        status: { type: 'string', enum: ['planned', 'samples_incoming', 'active', 'completed', 'cancelled'] },
      },
      required: ['partner_name', 'description'],
    },
  },
  {
    name: 'update_collab',
    description: 'Update a collab (mark samples received, set status to active/completed/cancelled, change date). Match by partner name.',
    input_schema: {
      type: 'object',
      properties: {
        partner_name: { type: 'string' }, status: { type: 'string', enum: ['planned', 'samples_incoming', 'active', 'completed', 'cancelled'] },
        samples_received: { type: 'boolean' }, due_date: { type: 'string' }, description: { type: 'string' },
      },
      required: ['partner_name'],
    },
  },
  {
    name: 'get_collabs',
    description: 'List business collabs/partnerships: partner, type, due date, whether samples are expected/received, status. Use for "what collabs do we have", "upcoming collabs", "are we expecting samples".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_shipping_billing',
    description: 'Shipping costs & billing: monthly ShipBob fulfilment spend per site, month-over-month change, cost OUTLIERS (overcharged orders worth disputing, e.g. an unexpectedly expensive delivery), and any logged invoices (paid/unpaid). Use for "shipping costs", "what did we spend on shipping", "any overcharges / outliers", "billing", "invoices".',
    input_schema: { type: 'object', properties: { site: { type: 'string', enum: ['ALTONA', 'MANCHESTER'] } } },
  },
  {
    name: 'check_docket',
    description: 'Find the latest ABC Blending delivery docket / packing slip email in Gmail (e.g. when the user says "Sharon sent a packing slip").',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'parse_docket',
    description: 'Read & parse the docket PDF → SKUs, lots, best-before dates, qty, linked PO. Use messageId from check_docket. Call this ONCE to show the lots + best-befores and ask the user to confirm. Do NOT call it a second time — if the user has ALREADY confirmed (yes/correct/go ahead), skip straight to create_wro instead of re-parsing. Re-showing the same docket after a yes is a bug.',
    input_schema: { type: 'object', properties: { messageId: { type: 'string' } }, required: ['messageId'] },
  },
  {
    name: 'create_wro',
    description: 'Create the ShipBob WRO from the docket (with lots + expiry) and link the PO. ONLY after the user has confirmed the best-befores. Returns the WRO number + a `received` breakdown. UNIT CONVERSION IS AUTOMATIC: dockets list pouch units but 320g SKUs live in ShipBob as 4-pouch SRP cartons — the tool divides for you (e.g. 168 pouches → 42 cartons). NEVER pre-convert quantities yourself; in your summary, quote the `received` breakdown (docket units AND ShipBob qty) so the user can sanity-check.',
    input_schema: { type: 'object', properties: { messageId: { type: 'string' } }, required: ['messageId'] },
  },
  {
    name: 'draft_sharon_reply',
    description: "Draft (NOT send) the reply to Sharon with the WRO box-labels PDF attached. The recipient is FIXED to ABC's monitored address (Sharon to, Stephen cc) — do NOT pass a To from the docket sender (that alias is unmonitored). Just pass the WRO id from create_wro (and docket_ref if handy). Returns the exact To/Cc/subject/body — show the user the body VERBATIM (do not paraphrase). Only send_email_draft after they approve.",
    input_schema: { type: 'object', properties: { docket_ref: { type: 'string' }, wro_id: { type: 'number' } }, required: ['wro_id'] },
  },
  {
    name: 'send_email_draft',
    description: 'Send a Gmail draft. ONLY when the user explicitly approves sending (e.g. "send it to Sharon"). Pass the draft_id from the SAME draft you just showed them (the most recent one) — never an older draft_id from earlier in the chat. It returns {sent:true, to, sent_message_id} on a CONFIRMED send, or {sent:false, error} if the draft was missing/had no recipient. NEVER tell the user it was sent unless you got sent:true — if sent:false, tell them it did NOT send and why.',
    input_schema: { type: 'object', properties: { draft_id: { type: 'string' } }, required: ['draft_id'] },
  },
  {
    name: 'set_restock_eta',
    description: 'Record (or clear) when an out-of-stock flavour is due back in. The OOS WhatsApp pings and auto-drafted stockist reply emails fold this in ("due back next week"). Use when Luke/Kate says e.g. "BMS is due back next week", "Buttermilk back in ~10 days", or "Cinnamon 520g restocks on the 20th". Pass flavour + EITHER eta_text (free phrase) OR eta_date (YYYY-MM-DD). Pass neither to clear.',
    input_schema: { type: 'object', properties: { flavour: { type: 'string' }, eta_text: { type: 'string' }, eta_date: { type: 'string' } }, required: ['flavour'] },
  },
];

let _media: string | null = null; // screenshot URL set by draft_po within a single run
let _phone: string | null = null; // WhatsApp recipient for tools that send media directly

async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  if (name === 'mark_brief_done') {
    const nums = (Array.isArray(input.numbers) ? input.numbers : []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
    if (!nums.length) return { error: 'Tell me which brief number(s) to clear.' };
    const r = await dismissBriefItems(nums, input.note ? String(input.note) : undefined);
    return { ...r, note: `Cleared ${r.cleared.length} item(s) from the brief${r.cleared.length ? `: ${r.cleared.join(', ')}` : ''}. They won't resurface.${r.not_found.length ? ` Couldn't find #${r.not_found.join(', #')}.` : ''}` };
  }
  if (name === 'get_stock') {
    let q = supabaseLogistics.from('v_stock_current')
      .select('sku,flavour,unit_size_g,tier,location_code,on_hand,available,inbound,days_of_cover,avg_daily_units_30d,trend')
      .eq('active', true);
    if (input.site) q = q.eq('location_code', input.site);
    if (input.tier) q = q.eq('tier', input.tier);
    let rows = ((await q).data ?? []) as any[];
    if (input.search) {
      const s = String(input.search).toLowerCase();
      rows = rows.filter((r) => (r.flavour || '').toLowerCase().includes(s) || r.sku.toLowerCase().includes(s));
    }
    // Accessories/syrups have no `flavour` in the stock view — surface the real product NAME so
    // the agent never guesses a name from the SKU letters (e.g. ACCS = The Scraper, not "Acai...").
    const noFlavour = rows.filter((r) => !r.flavour).map((r) => r.sku);
    const nameBySku = new Map<string, string>();
    if (noFlavour.length) {
      const { data: prods } = await supabaseLogistics.from('products').select('sku, name').in('sku', noFlavour);
      for (const p of (prods ?? []) as any[]) if (p.name) nameBySku.set(p.sku, p.name);
    }
    let out = rows.map((r) => ({
      sku: r.sku, flavour: r.flavour || nameBySku.get(r.sku) || r.sku,
      size: r.unit_size_g ? (r.unit_size_g >= 1000 ? `${r.unit_size_g / 1000}kg` : `${r.unit_size_g}g`) : '',
      tier: r.tier, site: r.location_code, on_hand: r.on_hand, available: r.available, inbound: r.inbound,
      days_of_cover: r.days_of_cover, daily_sales: r.avg_daily_units_30d, status: STATUS_META[computeStatus(r)].label,
    }));
    if (input.needs_attention) out = out.filter((r) => ['Out of stock', 'Reorder now', 'Reorder soon'].includes(r.status));
    return out;
  }
  if (name === 'get_purchase_orders') {
    const { data } = await supabaseLogistics.from('purchase_orders')
      .select(`po_number, status, expected_date, total_cost, currency, supplier:supplier_id(name), items:po_items(qty_ordered,qty_received,product:product_id(sku))`)
      .order('created_at', { ascending: false });
    let pos = (data ?? []) as any[];
    if (input.open_only) pos = pos.filter((p) => OPEN_STATUSES.includes(p.status));
    return pos.map((p) => ({
      po_number: p.po_number, supplier: p.supplier?.name, status: p.status, expected: p.expected_date, value: p.total_cost,
      items: (p.items ?? []).map((i: any) => ({ sku: i.product?.sku, ordered: i.qty_ordered, received: i.qty_received })),
    }));
  }
  if (name === 'get_po_forecast') {
    const f = await getPoForecast('ALTONA');
    return f.months.length
      ? f.months.map((m) => ({ month: m.label, total_units: m.units, order_now: m.key === new Date().toISOString().slice(0, 7), items: m.items.map((i) => ({ flavour: i.flavour, size: i.size, units: i.units, cartons: i.cartons, order_by: i.order_by })) }))
      : { note: 'Nothing to order in the next 3 months — stock + inbound cover projected demand.' };
  }
  if (name === 'get_reorder_recommendations') {
    const props = await proposeFlavourPOs('ALTONA');
    if (!props.length) return { note: 'Nothing due to order from ABC right now — stock + inbound cover demand.' };
    return props.map((p) => ({
      flavour: p.flavour, order_kg: p.order_kg, total_units: p.total_units, total_kg: p.total_kg,
      lines: p.lines.map((l) => ({ sku: l.sku, size: l.size, units: l.units, cartons: l.cartons, kg: l.kg })),
      note: p.reason,
    }));
  }
  if (name === 'draft_po') {
    let items: { product_id: string; qty_ordered: number; unit_cost: null }[] | undefined;
    let cartonNote = '';
    if (input.flavour) {
      const p = await proposeOneFlavour(String(input.flavour), 'ALTONA', input.order_kg ? Number(input.order_kg) : undefined);
      if (!p) return { error: `Couldn't build a PO for "${input.flavour}" — no matching flavour.` };
      items = p.lines.map((l) => ({ product_id: l.product_id, qty_ordered: l.units, unit_cost: null }));
      const cartons = p.lines.filter((l) => l.cartons);
      cartonNote = cartons.length ? ` 320g lines = ${cartons.map((l) => `${l.units}u/${l.cartons}ctn`).join(', ')}.` : '';
    } else if (input.items) {
      items = (input.items as any[]).map((i) => ({ product_id: i.product_id, qty_ordered: i.qty_ordered, unit_cost: null }));
    }
    const res = await draftWhatsAppPO(items);
    if ('error' in res) return res;
    _media = res.image_url;
    return { drafted: true, summary: res.summary, note: `One-flavour 500kg-multiple PO drafted.${cartonNote} Screenshot attached. Tell the user to reply SEND to approve & push to Xero.` };
  }
  if (name === 'approve_po') {
    return await approveLatestWhatsAppDraft();
  }
  if (name === 'send_po_email') {
    return await sendLatestPOEmail();
  }
  if (name === 'mark_po_received') {
    const po = String(input.po_number || '').trim().toUpperCase();
    if (!po) return { error: 'Need the PO number, e.g. "PO-0033".' };
    const r = await markPOReceived(po, { pushXero: true });
    if (!r.local) return { error: `No PO found matching "${po}".` };
    return { ok: true, po_number: r.po_number, note: `${r.po_number} marked received — dropped from inbound${r.xero ? ' and marked Billed in Xero' : ' (Xero update skipped/failed)'}.` };
  }
  if (name === 'get_expiring_stock') {
    let lots = await getLots();
    if (input.site) lots = lots.filter((l) => l.site === input.site);
    if (lots.length === 0) return { note: `No batch/best-before data on record${input.site ? ` for ${input.site}` : ''} right now.` };
    return lots.slice(0, 20).map((l) => ({
      flavour: l.flavour, size: l.unit_size_g && l.unit_size_g >= 1000 ? `${l.unit_size_g / 1000}kg` : `${l.unit_size_g}g`,
      site: l.site, lot: l.lot_number, best_before: l.expiry_date, days_left: l.days_left,
      on_hand: l.on_hand, status: EXPIRY_META[expiryStatus(l.days_left)].label,
    }));
  }
  if (name === 'get_action_center') {
    const acts = await getActionCenter();
    if (!acts.length) return { note: 'All clear — nothing needs action right now. ✅' };
    // Number them AND save the mapping so a "1, 3 done" reply resolves to THESE items via mark_brief_done.
    await setConfig('last_brief_items', JSON.stringify(acts.map((a, i) => ({ n: i + 1, key: a.key, title: a.title })))).catch(() => {});
    return acts.map((a, i) => ({ number: i + 1, priority: a.severity, title: a.title, detail: a.detail, say_to_action: a.command }));
  }
  if (name === 'suggest_transfer') {
    const pallets = input.pallets ? Number(input.pallets) : undefined;
    const s = await suggestRestock((input.destination as string) || 'MANCHESTER', 'ALTONA', { pallets });
    // Up-front lot-DATE check at draft time, so short-dated SKUs are caught BEFORE the CI is made.
    const dates = s.lines.length ? await lotDateCheck(s.lines.map((l) => ({ sku: l.sku, units: l.suggested }))).catch(() => ({})) : {};
    const shortDated = s.lines.filter((l) => (dates as any)[l.sku]?.short).map((l) => `${l.flavour} ${l.size} (best date ${(dates as any)[l.sku]?.best_before || '?'})`);
    return {
      destination: s.destination, origin: s.origin, target_days: s.target_days, lead_days: s.lead_days,
      pallets: s.pallets, cartons: s.cartons, cartons_per_pallet: s.cartons_per_pallet,
      total_units: s.total_units, total_kg: s.total_kg, total_value: s.total_value,
      lines: s.lines.map((l) => ({ sku: l.sku, flavour: l.flavour, size: l.size, units: l.suggested, cartons: l.cartons, uk_cover_now_days: l.days_cover, uk_cover_at_arrival_days: l.cover_at_arrival, daily: l.daily, inbound: l.inbound, altona_available: l.origin_available, best_before: (dates as any)[l.sku]?.best_before ?? null, short_dated: !!(dates as any)[l.sku]?.short, note: l.reason })),
      short_dated_warning: shortDated.length ? `⚠️ Short-dated at Altona — review/exclude before creating (UK stock spends ~2.5mo at sea): ${shortDated.join(', ')}` : null,
      note: s.lines.length ? `Preview only — ${s.pallets} pallet(s), ${s.cartons} cartons (~${s.total_kg}kg), 520g only. Each line shows best_before (longest lot date at Altona) + short_dated. CALL OUT any short_dated lines and offer to drop/swap them BEFORE create_transfer so the CI is right first time. uk_cover_at_arrival_days = cover WHEN IT LANDS. Confirm, then create_transfer with the same pallets value.` : 'Nothing to send — no Altona stock or demand signal.',
    };
  }
  if (name === 'create_transfer') {
    const pallets = input.pallets ? Number(input.pallets) : undefined;
    const s = await suggestRestock((input.destination as string) || 'MANCHESTER', 'ALTONA', { pallets });
    const res = await createDraftTransfer(s);
    return res;
  }
  if (name === 'send_transfer_docs') {
    const ref = String(input.reference || '');
    const t = await getTransfer(ref);
    if (!t) return { error: `No transfer found with reference ${ref}.` };
    if (!_phone) return { error: 'No WhatsApp recipient in context.' };
    const sent: string[] = [];
    for (const [key, label] of TRANSFER_DOC_LIST) {
      const ok = await sendWhatsApp(_phone, `📄 ${label} — ${ref}`, `${APP_URL}/api/transfers/${ref}/${key}`);
      if (ok) sent.push(label);
    }
    return { reference: ref, sent, note: sent.length ? 'PDFs sent to the user on WhatsApp.' : 'Failed to send PDFs.' };
  }
  if (name === 'update_transfer_lines') {
    try {
      const lines = (Array.isArray(input.lines) ? input.lines : []).map((l: any) => ({ sku: String(l.sku || ''), units: Number(l.units) || 0 }));
      const res = await updateTransferLines(String(input.reference || ''), lines);
      if ('error' in res) return res;
      return { ...res, note: `INTERNAL manifest updated: ${res.lines} lines, ${res.units} units, ${res.cartons} cartons. The CI + Packing List now reflect this — offer to send the fresh docs (send_transfer_docs).` };
    } catch (e) { return { error: String(e).slice(0, 200) }; }
  }
  if (name === 'preview_transfer_shipbob') {
    try { return await previewTransferShipbob(String(input.reference || '')); }
    catch (e) { return { error: String(e).slice(0, 200) }; }
  }
  if (name === 'create_transfer_wro') {
    try {
      const ref = String(input.reference || '');
      const res = await createTransferWro(ref, input.au_order_ref ? String(input.au_order_ref) : undefined);
      if ('error' in res) return res;
      // send the WRO label to the user (WhatsApp media) so they attach it to the AU B2B order
      if (_phone) await sendWhatsApp(_phone, `📦 WRO ${res.wro_id} label — ${ref}\nDownload + attach this to the AU B2B order in ShipBob before the pallet ships, so Manchester can receive it.`, `${APP_URL}${res.label_path}`).catch(() => {});
      return { ...res, note: `Manchester WRO ${res.wro_id} created from the AU lots/best-befores. I've sent you the label on WhatsApp — attach it to the AU B2B order before it ships. ${res.warnings.length ? 'Warnings: ' + res.warnings.join(' | ') : ''}` };
    } catch (e) { return { error: String(e).slice(0, 200) }; }
  }
  if (name === 'draft_transfer_email') {
    const ref = String(input.reference || '');
    const t = await getTransfer(ref);
    if (!t) return { error: `No transfer found with reference ${ref}.` };
    const route = `${t.origin_code || 'ALTONA'} → ${t.destination_code || 'MANCHESTER'}`;
    const subject = `The Protein Pancake — ${ref} ${route} pallet transfer`;
    const cartons = t.cartons ? `, ${t.cartons} cartons` : '';
    const body =
`Hi ${MAERSK.name.split(' ')[0]},

We're booking our next LCL sea-freight pallet (${ref}), ${route}. Could you please quote for the following, then we can proceed with pickup this week!

Commercial invoice & packing list attached.

* Summary: ${transferUnits(t).toLocaleString()} units${cartons}. Incoterms DDP Heywood (Altona VIC → Heywood OL10 2TT). Standing setup is on file: EORI ${IMPORTER.eori}, indirect-rep POA, AU–UK FTA preference (PSR, 0% duty), import VAT via our CDS cash account.

Pickup;
The Protein Pancake C/O ShipBob, Inc
21-27 Marshall Court
Altona, VIC, 3018

Dropoff;
The Protein Pancake C/O ShipBob, Inc
Unit P6, Parklands, Heywood Distribution Park
Heywood Greater Manchester United Kingdom  OL10 2TT


Flipping Regards,

Luke | Founder
The Protein Pancake
P: +61 412 474 330
E: luke@theproteinpancake.co
W: theproteinpancake.co`;
    try {
      // Supersede any earlier un-sent draft for this transfer so stale/duplicate drafts don't pile up.
      await gmailDeleteDraftsBySubject(subject).catch(() => 0);
      // Attach the (auto-signed) Commercial Invoice + Packing List PDFs directly to the draft.
      const [ci, pl] = await Promise.all([renderCommercialInvoice(t), renderPackingList(t)]);
      const attachments = [
        { filename: `Commercial Invoice — ${ref}.pdf`, base64: ci.toString('base64') },
        { filename: `Packing List — ${ref}.pdf`, base64: pl.toString('base64') },
      ];
      const draftId = await gmailCreateDraft(MAERSK.email, subject, body, attachments);
      return { draft_id: draftId, to: MAERSK.email, subject, body, attached: ['Commercial Invoice', 'Packing List'], note: 'Draft created with both PDFs attached. Show the user the To/subject + that both docs are attached (the body is here in this result). On "send", call send_email_draft with this draft_id; do NOT re-send the docs.' };
    } catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  if (name === 'update_transfer_status') {
    const ref = String(input.reference || '').trim().toUpperCase();
    const res = await setTransferStatus(ref, input.status as any);
    if ('error' in res) return res;
    const sellable = res.status === 'received';
    return { ...res, note: `${res.reference} → ${res.status}.${sellable ? ' Now counted as available ShipBob stock (and dropped from inbound).' : ' Still inbound, not yet sellable.'}` };
  }
  if (name === 'get_internal_transfers') {
    let q = supabaseLogistics.from('internal_transfers')
      .select('reference,status,ship_date,eta,carrier,bl_ref,shipment_ref,currency,total_value,cartons,gross_kg,origin:origin_location_id(code),destination:destination_location_id(code),items:internal_transfer_items(qty,qty_received,product:product_id(sku,flavour,unit_size_g))')
      .order('created_at', { ascending: false });
    if (input.reference) q = q.eq('reference', String(input.reference));
    const rows = ((await q).data ?? []) as any[];
    const STATUS_MEANING: Record<string, string> = {
      draft: 'not shipped yet',
      in_transit: 'on the water / en route — not landed',
      customs: 'arrived in destination country, CLEARING CUSTOMS — NOT landed/received yet, not sellable',
      arrived: 'arrived at the ShipBob FC, being received/put away — not sellable yet',
      received: 'received into ShipBob, now in available stock',
      cancelled: 'cancelled',
    };
    return rows.map((t) => ({
      reference: t.reference, status: t.status, status_meaning: STATUS_MEANING[t.status] || t.status,
      counts_as_inbound: ['in_transit', 'customs', 'arrived'].includes(t.status),
      route: `${t.origin?.code || '?'} → ${t.destination?.code || '?'}`,
      eta: t.eta, ship_date: t.ship_date, carrier: t.carrier, bl_ref: t.bl_ref, shipment_ref: t.shipment_ref,
      total_value: t.total_value, currency: t.currency, cartons: t.cartons, gross_kg: t.gross_kg,
      units: (t.items ?? []).reduce((s: number, i: any) => s + (i.qty || 0), 0),
      lines: (t.items ?? []).map((i: any) => ({
        sku: i.product?.sku, flavour: i.product?.flavour,
        size: i.product?.unit_size_g ? (i.product.unit_size_g >= 1000 ? `${i.product.unit_size_g / 1000}kg` : `${i.product.unit_size_g}g`) : null,
        qty: i.qty, received: i.qty_received,
      })),
    }));
  }
  if (name === 'get_uk_pallet_contacts') {
    const { data: cfg } = await supabaseLogistics.from('app_config').select('value').eq('key', 'maersk_contact_map').maybeSingle();
    const { data: trs } = await supabaseLogistics.from('internal_transfers').select('reference,status,eta,carrier').order('created_at', { ascending: false }).limit(5);
    const active = (trs ?? []).filter((t: any) => !['received', 'cancelled'].includes(t.status));
    return {
      current_uk_transfers: active.length ? active : (trs ?? []),
      escalation_guide: (cfg?.value as string) || 'Contact map not configured.',
      how_to_use: 'Match each transfer\'s status to the "status -> stage -> who to bump" list, then name the exact contact + email to chase now. Push the chokepoint for that stage; do not let Maersk teams pass it between themselves.',
    };
  }
  if (name === 'schedule_followup') {
    const raw = String(input.due_at || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return { error: 'Need a due date like "2026-06-12T09:00" (Melbourne time).' };
    const local = raw.length <= 10 ? `${raw}T09:00` : raw.slice(0, 16);
    // Melbourne local → UTC instant (DST-safe): date part via melbMidnightUtc + clock offset
    const midnight = Date.parse(melbMidnightUtc(local.slice(0, 10)));
    const [hh, mm] = local.slice(11).split(':').map(Number);
    const dueUtc = new Date(midnight + (hh * 60 + (mm || 0)) * 60_000).toISOString();
    if (Date.parse(dueUtc) < Date.now()) return { error: `${local} is in the past — pick a future time.` };
    const { data, error } = await supabaseLogistics.from('agent_followups')
      .insert({ phone: _phone || '', due_at: dueUtc, message: String(input.message).slice(0, 500), context: input.context ? String(input.context).slice(0, 800) : null })
      .select('id').maybeSingle();
    if (error) return { error: error.message };
    return { ok: true, id: data?.id, note: `Scheduled — I'll ping you ${local.replace('T', ' at ')} (Melbourne).` };
  }
  if (name === 'list_followups') {
    const { data } = await supabaseLogistics.from('agent_followups')
      .select('id, due_at, message').eq('status', 'pending').eq('phone', _phone || '').order('due_at');
    return (data ?? []).map((f: any) => ({ id: f.id, due_melbourne: new Date(f.due_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), message: f.message }));
  }
  if (name === 'cancel_followup') {
    const { error } = await supabaseLogistics.from('agent_followups').update({ status: 'cancelled' }).eq('id', String(input.id)).eq('status', 'pending');
    return error ? { error: error.message } : { ok: true, note: 'Cancelled.' };
  }
  if (name === 'update_logistics_brief_excludes') {
    const site = String(input.site || '').toUpperCase() === 'UK' ? 'UK' : 'AU';
    const skus = (Array.isArray(input.skus) ? input.skus : []).map((s: any) => String(s).toUpperCase().trim()).filter(Boolean);
    const action = input.action === 'include' ? 'include' : 'exclude';
    if (!skus.length) return { error: 'No SKU codes given.' };
    const { data } = await supabaseLogistics.from('app_config').select('value').eq('key', 'logistics_brief_excludes').maybeSingle();
    let cfg: Record<string, string[]> = {};
    try { cfg = data?.value ? JSON.parse(data.value as string) : {}; } catch { cfg = {}; }
    const cur = new Set((cfg[site] || []).map((s) => s.toUpperCase()));
    if (action === 'exclude') skus.forEach((s: string) => cur.add(s)); else skus.forEach((s: string) => cur.delete(s));
    cfg[site] = [...cur];
    await supabaseLogistics.from('app_config').upsert({ key: 'logistics_brief_excludes', value: JSON.stringify(cfg), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    return { ok: true, site, action, now_hidden_in_brief: cfg[site], note: `${action === 'exclude' ? 'Hidden' : 'Re-showing'} ${skus.join(', ')} ${action === 'exclude' ? 'from' : 'in'} the ${site} stock list. The ${site} brief now hides: ${cfg[site].join(', ') || '(none)'}.` };
  }
  if (name === 'get_wholesale_overview') {
    const w = await getWholesaleDashboard();
    return {
      sales: w.totals,
      due_to_reorder: w.due.slice(0, 12).map((c) => ({ name: c.name, overdue_days: c.overdue_days, avg_interval_days: c.avg_interval_days, last_order: c.last_order, expected_next: c.expected_next })),
      lapsed: w.lapsed.map((c) => ({ name: c.name, days_since: c.days_since, total_value: c.total_value })),
      top_customers: w.topCustomers.slice(0, 8),
      stock_320g: w.stock.map((s) => ({ flavour: s.flavour, sku: s.sku, available: s.available, days_cover: s.days_cover, reorder_by: s.reorder_by })),
      note: 'Sales in AUD. due_to_reorder = active customers past their avg interval; lapsed = gone quiet. stock_320g.available is cartons at Altona.',
    };
  }
  if (name === 'find_po_email') {
    const term = String(input.search || '').trim();
    const q = `${term ? `"${term}" ` : ''}newer_than:60d -in:sent`;
    const accounts: { acc: string | undefined; tag: string }[] = [{ acc: 'kate', tag: 'kate' }, { acc: undefined, tag: 'luke' }];
    const results: any[] = [];
    for (const { acc, tag } of accounts) {
      try {
        const hits = await gmailSearch(q, 6, acc);
        for (const h of hits) results.push({ id: h.id, inbox: tag, from: h.from, subject: h.subject, date: h.date, snippet: h.snippet });
      } catch { /* skip an inbox that errors / isn't connected */ }
    }
    if (!results.length) return { results: [], note: `No emails matching "${term || 'recent'}" in either inbox.` };
    results.sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0));
    return { results };
  }
  if (name === 'read_email') {
    const account = input.inbox === 'luke' ? undefined : 'kate';
    try {
      const body = await gmailGetBody(String(input.id), account);
      return { body: body || '(no readable text — may be a PDF/CSV attachment; use process_po_email)' };
    } catch (e) {
      return { error: `Couldn't read that email: ${String(e).slice(0, 140)}` };
    }
  }
  if (name === 'process_po_email') {
    const exclude = Array.isArray(input.exclude) ? (input.exclude as any[]).map(String) : undefined;
    const account = input.inbox === 'luke' ? undefined : 'kate';
    try {
      const [body, atts] = await Promise.all([
        gmailGetBody(String(input.id), account).catch(() => ''),
        gmailGetAllAttachments(String(input.id), account).catch(() => []),
      ]);
      const pdfs = atts.filter((a) => /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.filename)).map((a) => ({ filename: a.filename, base64: a.base64 }));
      const csvTexts = atts
        .filter((a) => /csv|text\/plain/i.test(a.mimeType) || /\.(csv|tsv|txt)$/i.test(a.filename))
        .map((a) => `--- ${a.filename} ---\n${Buffer.from(a.base64, 'base64').toString('utf-8').slice(0, 5000)}`);
      const xlsxAtts = atts.filter((a) => /spreadsheetml|ms-excel/i.test(a.mimeType) || /\.xlsx?$/i.test(a.filename));
      const xlsxTexts = (await Promise.all(xlsxAtts.map((a) => xlsxToText(a.base64, a.filename)))).filter(Boolean);
      const text = [body, ...csvTexts, ...xlsxTexts].filter(Boolean).join('\n\n');
      if (!text && !pdfs.length) return { error: 'That email has no readable PO content (no text, CSV, Excel, or PDF).' };
      const a = await processWholesalePOMulti({ text, pdfs }, exclude);
      return {
        po_number: a.po_number, already_processed: a.already_processed, existing: a.existing,
        customer: a.customer_name, ship_to: a.ship_to, bill_to: a.bill_to,
        customer_on_file: a.customer_on_file, needs_review: a.needs_review, flags: a.flags,
        total_cartons: a.total_cartons, fulfillable: a.fulfillable,
        lines: a.lines.map((l) => ({ flavour: l.flavour, sku: l.sku, cartons: l.cartons, ordered_qty: l.ordered_qty, qty_basis: l.qty_basis, altona_available: l.available, in_stock: l.ok })),
        boxes: a.boxes, free_shipping: a.free_shipping, over_b2c_limit: a.over_b2c_limit,
        oos: a.oos, suggested_oos_reply: a.oos.length ? oosReplyBody(a) : null, summary: a.summary,
        sources: `${body ? 'email text' : ''}${csvTexts.length ? ' + CSV' : ''}${xlsxTexts.length ? ' + Excel' : ''}${pdfs.length ? ` + ${pdfs.length} PDF` : ''}`.replace(/^ \+ /, ''),
        note: `${exclude?.length ? `Excluded ${exclude.join(', ')}. ` : ''}${a.needs_review ? 'NEEDS REVIEW — present the details carefully to Kate (esp. a new customer or any flag) before processing.' : 'Show Kate the summary and confirm before processing.'}`,
      };
    } catch (e) {
      return { error: `Couldn't process that PO email: ${String(e).slice(0, 160)}` };
    }
  }
  if (name === 'parse_wholesale_po') {
    const text = String(input.text || '').trim();
    if (!text) return { error: 'Paste the PO text and I\'ll parse it.' };
    const exclude = Array.isArray(input.exclude) ? (input.exclude as any[]).map(String) : undefined;
    const a = await processWholesalePO(text, exclude);
    return {
      po_number: a.po_number, already_processed: a.already_processed, existing: a.existing,
      customer: a.customer_name, ship_to: a.ship_to, bill_to: a.bill_to,
      customer_on_file: a.customer_on_file, needs_review: a.needs_review, flags: a.flags,
      total_cartons: a.total_cartons, fulfillable: a.fulfillable,
      lines: a.lines.map((l) => ({ flavour: l.flavour, sku: l.sku, cartons: l.cartons, ordered_qty: l.ordered_qty, qty_basis: l.qty_basis, altona_available: l.available, in_stock: l.ok })),
      boxes: a.boxes, free_shipping: a.free_shipping, over_b2c_limit: a.over_b2c_limit,
      oos: a.oos, suggested_oos_reply: a.oos.length ? oosReplyBody(a) : null,
      summary: a.summary,
      note: a.needs_review ? 'NEEDS REVIEW — present carefully to Kate (new customer / flags) before processing.' : (a.over_b2c_limit ? '>24 cartons → B2B/courier, out of standard B2C scope.' : 'Show Kate the summary and confirm before processing.'),
    };
  }
  if (name === 'create_wholesale_order') {
    const r = (input.recipient || {}) as any;
    const res = await createWholesaleOrder({
      customer_name: String(input.customer_name),
      recipient: { name: String(r.name), address1: String(r.address1), address2: r.address2, city: String(r.city), state: r.state, zip_code: String(r.zip_code), country: String(r.country), email: r.email },
      lines: (input.lines as any[] || []).map((l) => ({ sku: String(l.sku), cartons: Number(l.cartons) })),
      box: String(input.box), free_shipping: !!input.free_shipping, reference: input.reference as string, po_number: input.reference as string,
    });
    if ('error' in res) return res;
    return { ok: true, shipbob_order_id: res.shipbob_order_id, xero_invoice: res.xero_invoice, xero_invoice_id: res.xero_invoice_id, xero_total: res.xero_total, reused: res.reused,
      note: `DONE. ShipBob order #${res.shipbob_order_id}: ${res.shipbob_added}. Xero invoice ${res.xero_invoice} (DRAFT, $${res.xero_total}). Report this EXACTLY to Kate and ask her to cross-check, then reply "send invoice" to email it (pass xero_invoice_id ${res.xero_invoice_id}).` };
  }
  if (name === 'send_wholesale_invoice') {
    const r = await sendWholesaleInvoice(String(input.invoice_id));
    return r.ok ? { ok: true, note: 'Invoice authorised & emailed to the customer from Xero.' } : { error: 'Could not send the invoice — check it in Xero.' };
  }
  if (name === 'find_influencer') {
    const f = await findInfluencer(String(input.query));
    if (!f) return { found: false, note: `No known influencer matching "${input.query}". If new, ask for their details.` };
    return { found: true, ...f, note: 'Reuse this saved address/email/handle to gift (parse the address into address1/city/state/zip_code/country). Pass the aliases through to send_influencer_gift.' };
  }
  if (name === 'set_influencer_alias') {
    return await setInfluencerAlias(String(input.name_or_handle), String(input.alias));
  }
  if (name === 'send_influencer_gift') {
    const res = await sendInfluencerGift({
      name: String(input.name), handle: input.handle as string, followers: input.followers as number, email: input.email as string,
      aliases: input.aliases as string,
      address1: String(input.address1), address2: input.address2 as string, city: String(input.city),
      state: input.state as string, zip_code: String(input.zip_code), country: String(input.country),
      flavour: String(input.flavour), size_g: Number(input.size_g), qty: input.qty as number, site: input.site as string,
      force: input.force as boolean,
    });
    if ('error' in res) return res;
    if ('needs' in res) return res;  // missing required fields — ask Kate, create NOTHING
    if ('oos' in res) return res;   // OOS — agent must ask Kate before proceeding
    return { ok: true, order_id: res.order_id, added: res.summary, note: `ShipBob B2C order created with the ${res.box} box. Report EXACTLY what was added: ${res.summary}` };
  }
  if (name === 'update_influencer_status') {
    return await updateInfluencerStatus(String(input.name_or_handle), String(input.status));
  }
  if (name === 'update_influencer_details') {
    const res = await updateInfluencerDetails(String(input.name_or_handle), {
      name: input.name as string, email: input.email as string, handle: input.handle as string,
      followers: input.followers as number, address: input.address as string, notes: input.notes as string,
    });
    if ('error' in res) return res;
    return { ...res, note: `Record updated. Confirm to the user EXACTLY these saved values: ${JSON.stringify(res.updated)}` };
  }
  if (name === 'get_influencers') {
    const [all, likely] = await Promise.all([listInfluencers(), likelyToPost(5)]);
    return {
      likely_to_post_next: likely,
      influencers: (all as any[]).slice(0, 30).map((i) => ({ name: i.name, handle: i.handle, flavour: i.flavour_sent, sent_from: i.sent_from, date: i.date_initiated, status: i.status, tracking: i.tracking_number, tracking_url: i.tracking_url })),
    };
  }
  if (name === 'save_collab') {
    return await saveCollab({
      partner_name: String(input.partner_name), handle: input.handle as string, email: input.email as string, address: input.address as string,
      collab_type: input.collab_type as string, due_date: input.due_date as string,
      expecting_samples: input.expecting_samples as boolean, sample_qty: input.sample_qty as number,
      description: String(input.description), status: input.status as string,
    });
  }
  if (name === 'update_collab') {
    const { partner_name, ...fields } = input as any;
    return await updateCollab(String(partner_name), fields);
  }
  if (name === 'get_collabs') {
    const all = await listCollabs();
    return (all as any[]).map((c) => ({ partner: c.partner_name, type: c.collab_type, due: c.due_date, expecting_samples: c.expecting_samples, samples_received: c.samples_received, sample_qty: c.sample_qty, status: c.status, summary: c.title, handle: c.handle }));
  }
  if (name === 'get_shipping_billing') {
    const [{ outliers }, billing] = await Promise.all([getShippingData(), getBillingData()]);
    const highlights = buildHighlights(billing.monthly, billing.invoices, billing.outliers);
    let monthly = billing.monthly;
    let outs = outliers;
    let inv = billing.invoices;
    if (input.site) {
      monthly = monthly.filter((m) => m.site === input.site);
      outs = outs.filter((o) => o.site === input.site);
      inv = inv.filter((i) => i.site === input.site);
    }
    return {
      monthly_spend: monthly.slice(-8).map((m) => ({ site: m.site, month: m.month, currency: m.currency, total: m.total, shipments: m.shipments, avg_per_order: m.avg })),
      highlights: highlights.filter((h) => !input.site || h.site === input.site).map((h) => ({
        site: h.site, currency: h.currency, this_month: h.thisMonth, last_month: h.lastMonth, mom_pct: h.momPct,
        outlier_overcharge: h.outlierExposure, outlier_orders: h.outlierCount, unpaid_invoices: h.unpaidCount, unpaid_total: h.unpaidTotal,
      })),
      top_outliers: outs.slice(0, 8).map((o: any) => ({ shipment_id: o.shipbob_shipment_id, order: o.order_number, site: o.site, cost: o.cost, currency: o.currency, x_median: o.x_median, ship_option: o.ship_option, date: o.ship_date, city: o.city })),
      invoices: inv.slice(0, 10).map((i) => ({ invoice: i.invoice_number, site: i.site, date: i.invoice_date, total: i.total_amount, currency: i.currency, status: i.status })),
    };
  }
  if (name === 'check_docket') {
    const d = await findLatestDocket();
    return d ?? { error: 'No recent ABC docket email found.' };
  }
  if (name === 'parse_docket') {
    try {
      const parsed = await parseDocket(String(input.messageId));
      // Pin the messageId + next step so a "yes" NEXT turn goes straight to create_wro instead of
      // re-parsing and re-asking (the confirm-loop fix). WhatsApp history keeps text, not tool
      // results, so without this the messageId is lost and the agent re-derives + re-prompts.
      if (_phone && !(parsed as any)?.error) {
        await recordProactiveContext(_phone,
          `PENDING WRO CONFIRMATION — I just showed the user docket ${(parsed as any)?.docket_ref || ''} (messageId="${String(input.messageId)}") and asked them to confirm the lots/best-befores. If their NEXT message confirms (yes / correct / looks good / go ahead / create it), call create_wro with messageId="${String(input.messageId)}" IMMEDIATELY — do NOT call parse_docket again or re-show the same docket summary. Then offer draft_sharon_reply.`
        ).catch(() => {});
      }
      return parsed;
    } catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  if (name === 'create_wro') {
    try {
      const parsed = await parseDocket(String(input.messageId));
      const res = await createWROFromParsed(parsed);
      const note = (res as any).already_existed
        ? `WRO ${res.wro_id} was ALREADY created for this docket/PO — not duplicated. Go straight to draft_sharon_reply with wro_id=${res.wro_id}.`
        : `WRO ${res.wro_id} created. Offer to draft Sharon's reply (draft_sharon_reply, wro_id=${res.wro_id}).`;
      return { ...res, docket_ref: parsed.docket_ref, po_ref: parsed.po_ref, note };
    } catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  if (name === 'draft_sharon_reply') {
    try {
      const res = await draftSharonReply('', (input.docket_ref as string) || null, Number(input.wro_id));
      // Pin the draft_id so "send" NEXT turn sends THIS email — never re-runs create_wro (the WRO
      // already exists; re-creating it 422s). WhatsApp history loses tool results between turns.
      if (_phone && (res as any)?.draft_id) {
        await recordProactiveContext(_phone,
          `PENDING SHARON REPLY — I drafted the labels email to Sharon (draft_id="${(res as any).draft_id}", WRO ${input.wro_id} already created). If the user's NEXT message says send / yes / go, call send_email_draft with draft_id="${(res as any).draft_id}" IMMEDIATELY. Do NOT call create_wro again — that WRO already exists and re-creating it errors.`
        ).catch(() => {});
      }
      return res;
    } catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  if (name === 'get_packaging_stock') {
    try { return await getPackagingSummary(); }
    catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  if (name === 'get_visy_orders') {
    try { return await getVisyOrders({ openOnly: input.open_only === true }); }
    catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  if (name === 'find_contact') {
    try {
      const cs = await findContacts(String(input.query || ''));
      if (!cs.length) return { found: 0, note: `No contact matching "${input.query}".` };
      return { found: cs.length, contacts: cs.map((c) => ({ company: c.company, name: c.name, role: c.role, email: c.email, phone: c.phone, address: c.address, notes: c.notes })) };
    } catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  if (name === 'order_packaging') {
    try {
      const { item, candidates } = await resolveVisyItem(String(input.item || ''));
      if (candidates) return { ambiguous: candidates.map((c) => ({ name: c.name, visy_code: c.visy_code, destination: c.destination })), note: 'Which one? Reply with the flavour or VISY code.' };
      if (!item) return { error: `Couldn't find a VISY-orderable packaging item matching "${input.item}".` };
      const draft = await draftVisyOrder({ item, qty: input.qty != null ? Number(input.qty) : undefined });
      // Same anti-loop guard as the Sharon-reply flow: spell out the ONLY correct next call, or
      // an approval ("send it") gets misrouted back here and just re-drafts instead of sending.
      return {
        ...draft,
        next_step: `PENDING APPROVAL — VISY order drafted (draft_id="${draft.draft_id}"), NOT sent. If the user's next message approves (send / send it / yes / go ahead), call send_email_draft with draft_id="${draft.draft_id}" IMMEDIATELY. Do NOT call order_packaging again — that re-drafts instead of sending; only re-draft if they change the item or quantity.`,
      };
    } catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  if (name === 'send_email_draft') {
    try {
      const draftId = String(input.draft_id);
      const sent = await gmailSendDraft(draftId); // throws if the draft is gone or has no recipient
      const visySent = await markVisyOrderSent(draftId).catch(() => false); // flip a VISY order drafted→ordered
      return { sent: true, sent_message_id: sent.id, to: sent.to, ...(visySent ? { visy_order: 'now tracking — I\'ll update you as VISY confirms/ships it' } : {}) };
    } catch (e) { return { sent: false, error: String(e).slice(0, 200) }; }
  }
  if (name === 'set_restock_eta') {
    if (!input.flavour) return { error: 'Which flavour?' };
    try {
      await setRestockEta(String(input.flavour), input.eta_text ? String(input.eta_text) : null, input.eta_date ? String(input.eta_date) : null);
      const when = input.eta_text || input.eta_date || 'cleared';
      return { ok: true, note: `Noted — ${input.flavour} restock: ${when}. I'll fold that into OOS messages + stockist email drafts.` };
    } catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  return { error: 'unknown tool' };
}

const SYSTEM = `You are the logistics operations assistant for The Protein Pancake (TPP), messaging the founder on WhatsApp. You are the single point of contact for ALL logistics tasks.
Live data + real actions via tools. Sites: Altona (AU, AUD) & Manchester (UK, GBP). Primary SKUs: ${PRIMARY_FLAVOURS.join(', ')}.
"Days of cover" = available ÷ daily sales. "Inbound" = units on open POs.

CRITICAL RULE — never say you can't do something logistics-related without FIRST calling the relevant tool. If a tool returns no rows, say "no data found right now", NOT "I don't have access". You DO have every capability below. Do not describe your own tool list to the user; just answer.

Your full toolkit:
- get_action_center — the proactive cross-site priority list (transfers due, POs, packaging, expiry, billing). Lead with this for "what needs my attention" and when opening a proactive check-in; then offer to action the top items. It returns the items NUMBERED (and saves that numbering); when the user replies with numbers about them ("1, 3 done", "disregard 2 and 5", "8 — I provisioned Manildra so it's underway"), call mark_brief_done with those numbers + any note/decision so they clear and won't resurface. Confirm what you cleared. (Only treat a bare-number reply as this if you actually showed the numbered list recently.)
- get_stock — live on-hand, available, days of cover, inbound, velocity, status, per SKU per site (FINISHED goods/syrup/accessories). NEVER invent a product name from its SKU letters — use the name/flavour the tool returns (ACCS=The Scraper, ACCP=The Pancake Pan, ACCF=The Flipper, TWM=The Waffle Maker); if a row's name is just the SKU, say the SKU, don't guess.
- get_packaging_stock — our PACKAGING: empty pouches + shelf-ready SRP cartons ABC holds, and the shipping cartons ShipBob Altona holds (live). Use this for ANY packaging/pouch/SRP/carton question and for "what does ABC have on hand" — ABC holds EMPTIES (pouches + SRP cartons), NOT finished product. Don't answer packaging questions from get_stock. 320g is carton-limited when SRP cartons × 4 < pouches — call that out.
- get_expiring_stock — batch/lot best-before dates, days left, soonest-expiring stock (BOTH sites). This covers ALL expiry / shortest-dated / batch / best-before questions.
- get_purchase_orders — POs: supplier, status, expected date, outstanding units.
- get_po_forecast — the 3-month rolling ABC order schedule (what to order each month). Use for "PO schedule / plan / what to order over the next months".
- get_reorder_recommendations — what to order & how many (velocity × lead+target − stock − inbound).
- get_shipping_billing — shipping cost trends, monthly spend, MoM change, cost OUTLIERS/overcharges, invoices.
- get_internal_transfers — AU→UK stock transfers (pallets) in transit; their units already feed the destination site's inbound. Use for "what's on the way to the UK", "the pallet", "INTERNAL2".
- suggest_transfer → create_transfer — propose a UK restock transfer (520g medium bags ONLY; LEAD-TIME-AWARE: covers ~75d transit + 180d after arrival, so in-flight inbound is discounted by transit-period sales; best-seller pallet-fill, Altona-capped). When presenting, lead with uk_cover_at_arrival_days (cover WHEN IT LANDS, not now) and call out any SKU that stocks out before arrival. CRITICAL — DATE CHECK AT DRAFT TIME: suggest_transfer now returns best_before + short_dated per line and a short_dated_warning; if anything is short_dated, surface it prominently and ask the user whether to DROP or swap those SKUs BEFORE you create_transfer (UK stock sits ~2.5mo at sea, so we don't want short dates) — fixing it now avoids regenerating the CI later. Show the preview, confirm (with short-dated lines resolved), then create the draft. send_transfer_docs — WhatsApp the Commercial Invoice + Packing List PDFs for a transfer to the user to preview. The docs are AUTO-SIGNED (Luke's signature) and AUTO-DATED (today) — they are fully send-ready, the user does NOT need to sign or add a date manually. So once the user previews them and is happy ("looks good, send them" / "draft the maersk email" / "draft the booking email"), call draft_transfer_email ONCE — it attaches the (signed) Commercial Invoice + Packing List to the email itself. Do NOT re-run send_transfer_docs when asked to draft/send the email (the docs were already previewed; re-sending them is the looping bug). Then send_email_draft only after the user approves. draft_transfer_email — draft (not send) the Maersk booking email (to Viviana Diaz, who replaced Jordan Burnes) to start the transfer. For sending the email, use send_email_draft only after explicit approval. For chasing later stages (BL, customs chokepoint, UK delivery) use get_uk_pallet_contacts to name the right person.
AMENDING A TRANSFER MANIFEST: if the user changes a DRAFT transfer's contents in chat (e.g. "drop CHM/GFBM/SCM because they're short-dated, bump CIM to 216 and MAM to 156"), you CAN now save it — work out the full resulting line set and call update_transfer_lines(reference, lines:[{sku,units}]) (it REPLACES all lines + recomputes cartons/value). Then the CI + Packing List regenerate from the new lines — offer send_transfer_docs. Do NOT tell the user to edit it on the Transfers page; do it via this tool.

SHIPBOB TRANSFER ITEMS: when the user asks to "generate the shipbob items / AU B2B order + UK WRO / what lots would we send", call preview_transfer_shipbob(reference). Present, clearly: (1) the recommended LOTS per SKU (longest best-before — call out any ⚠ short-dated lots or shortfalls so they're reviewed before going to the UK), and (2) the place_in_shipbob recipe as a numbered checklist (Business → Manchester contact → Freight → Upload your own → attach CI + Packing List → add items + select THESE lots). Be honest: ShipBob B2B freight orders are a separate flow with no API yet, so the agent CANNOT create the AU order itself — the user places it in the ShipBob UI using this recipe (it takes ~2 min and guarantees the right lots). Do NOT claim you created it, and do NOT re-run draft_transfer_email instead.
THE UK RECEIVING WRO *IS* AUTOMATED: once the user has placed the AU B2B order, call create_transfer_wro(reference, au_order_ref if they gave the order #). It creates the Manchester receiving WRO from the same units/lots/best-befores and WhatsApps the user the WRO LABEL — they attach that label to the AU B2B order before the pallet ships so Manchester can receive it. So the flow is: preview_transfer_shipbob → user places the AU order in ShipBob (recipe + lots) → create_transfer_wro → user attaches the sent label to the AU order → send_email_draft the Maersk booking email.

Transfer STATUS — never overstate it. in_transit = en route (not landed); customs = arrived in-country, CLEARING CUSTOMS (NOT landed/received, not sellable); arrived = at the ShipBob FC being put away (not sellable); received = in available stock. in_transit/customs/arrived all count as INBOUND (baked into cover) but are NOT "landed". Use get_internal_transfers' status_meaning field; describe the real stage (e.g. "INTERNAL2 is clearing UK customs"), don't say a transfer has "landed/arrived" unless status is received.
MARKING RECEIVED (transfers AND POs) — stock is only "received" once ShipBob has ACTUALLY counted it into inventory, confirmed by the ShipBob receiving/goods-in EMAIL or the WRO receiving status = complete. NEVER mark received off an ETA, a customs update, or "it arrived in country". Use update_transfer_status(reference,'received') for transfers / mark_po_received for POs only when that ShipBob confirmation exists. If a ShipBob "received/goods-in" email appears (in the Gmail scour / action center), proactively offer to mark the matching transfer/PO received — but still wait for the user's go-ahead.
- draft_po → approve_po — draft a PO (ABC → Altona) with a screenshot, then push to Xero on approval.
- check_docket → parse_docket → create_wro → draft_sharon_reply → send_email_draft — the receiving/WRO flow.

ABC purchase-order rules (IMPORTANT — get these right):
- Orders are placed ONE FLAVOUR per PO (easy tracking).
- Each PO totals a MULTIPLE of 500kg of product — 500kg by default, 1T/1.5T for fast movers with a bigger deficit. Optimise for clean 500kg increments.
- The weight is split across that flavour's sizes (320g / 520g / 1kg) weighted by which sizes are actually low (live velocity + cover). Bag weights: 320g = 0.32kg, 520g = 0.52kg, 1kg = 1kg. A single size is fine if only one is low (e.g. 500kg of just 520g).
- 320g bags are WHOLESALE, packed by ABC in Shelf-Ready Cartons of 4. The PO is placed in TOTAL UNITS (individual bags), but ShipBob counts them as cartons (units ÷ 4). ALWAYS present 320g lines as "X units (Y cartons)".
- Account for inbound stock. get_reorder_recommendations gives the per-flavour 500kg proposals; draft_po with a flavour drafts one.
- EXACT SIZES: by default draft_po auto-rounds to a demand-based 500kg multiple. If the user specifies a size ("500kg", "just 500", "one tonne", "1.5T", "500 units of 1kg"), pass order_kg to draft_po to pin it EXACTLY — do NOT auto-round back up to a bigger multiple. The user's stated size wins. (1kg bags: units == kg.) You may note if you think it'll sell out sooner, but build what they asked.
- ERROR HONESTY: if a tool returns an error, relay the ACTUAL error text — never invent a cause (don't guess "token expired"/"re-auth needed"/"missing field" unless the error literally says so). Quote the real message and suggest the real next step.
Purchase orders — TWO-STEP send (don't confuse the steps):
STEP 1 (approve): draft_po creates a DRAFT PO + attaches a screenshot; tell the user to reply "SEND". When the user approves, call approve_po. approve_po pushes the PO to Xero AND prepares (DRAFTS, does NOT send) the email to ABC (To: Sharon, CC: Stephen, Xero PO PDF attached). After it returns: confirm the Xero PO number, say the ABC email is DRAFTED in Gmail for review (show the To/CC + subject "New PO"), and tell them to reply "SEND TO ABC" when they're happy for it to go (or to tweak the Gmail draft first). If email_drafted is false, warn the draft didn't create (Gmail may need reconnecting).
STEP 2 (send to ABC): ONLY when the user explicitly says to send the email to ABC ("send to ABC", "send it", "fire it over", "yep send the email"), call send_po_email. Then confirm it's been sent to Sharon (cc Stephen).
CRITICAL anti-loop rule: if a DRAFT PO is already pending and the user's reply contains SEND / approve / yes / go (EVEN with extra words like "SEND and I'll check the draft first"), that is approval — call approve_po. Do NOT re-run draft_po or re-show the screenshot. Likewise if a PO is approved and awaiting the ABC email, "send to ABC"/"send it" means call send_po_email — do NOT re-approve or re-draft. Only call draft_po when the user is asking for a NEW/different order. Honour any extra instruction in the message (e.g. "I'll check the draft first") in your wording, but still take the approve/send action.
Only call approve_po / send_po_email when the user EXPLICITLY approves. Never approve or send on your own.
Inbound accuracy (CRITICAL — don't hallucinate inbound): "inbound" = OPEN POs only (status placed/in_production/partially_received). A PO marked received/delivered does NOT count as inbound — never add it to inbound totals. Old POs that have already landed should be marked received: use mark_po_received with the exact po_number (it drops them from inbound and marks them Billed in Xero). WROs received at ShipBob are auto-reconciled to their PO daily. If the user says a PO has landed / is old / was already delivered, call mark_po_received. When inbound numbers look suspiciously high, suspect stale POs that were never closed — check get_purchase_orders and offer to mark the delivered ones received.

Receiving (WRO) flow — TWO distinct steps, decided by the conversation so far:
A) FIRST time the user mentions a docket/packing slip from Sharon/ABC: check_docket → parse_docket → show the parsed lines (LOT NUMBERS + BEST-BEFORE dates) and ask them to confirm. Then STOP and wait.
B) When the user then CONFIRMS (e.g. "yes", "correct", "looks good", "go ahead", "create it"): call create_wro NOW. If the conversation contains a "PENDING WRO CONFIRMATION" note, it has the exact messageId — use it: create_wro(messageId) straight away. (No pending note? call check_docket ONLY to get the messageId, then create_wro.) Report the WRO number, then offer the Sharon reply. NEVER call parse_docket or re-show the docket summary on a confirmation turn — re-displaying the same "say yes" prompt after they already said yes is the exact loop bug we must never do.
Then offer to reply to Sharon: draft_sharon_reply (recipient is FIXED to ABC's monitored address — Sharon to, Stephen cc; never use the docket sender's address) → show the exact draft → send_email_draft only when they say send. After you've drafted Sharon's reply, a "send"/"yes"/"go" means call send_email_draft with that draft_id (the "PENDING SHARON REPLY" note has it) — the WRO is ALREADY created, so NEVER call create_wro again on a send (re-creating it errors 422 "PO reference already exists"). If create_wro ever returns already_existed, that's fine — the WRO exists; just proceed to draft/send Sharon's reply. Never create a WRO or send an email without explicit confirmation.

Email drafts: when a draft_* tool returns a subject + body, show the user that EXACT subject and body verbatim (quote it as-is — never rewrite, embellish or summarise it) so what they approve is exactly what gets sent. Mention if a file is attached. Only send after explicit approval.

Multi-step memory: you can see the recent conversation. When the user replies "yes"/"confirm"/"SEND"/"do it", act on what you just proposed — re-fetch any IDs you need (e.g. call check_docket again to get the docket, then create_wro). Never lose the thread.

Voice: you're a fun, witty member of the TPP team with Gen-Z energy — playful and a bit cheeky, light natural slang ("lowkey", "no cap", "sorted", "we move", "that's cooked", "say less") used sparingly so it never feels forced or cringe. Warm and human, like a sharp mate who's got ops handled. BUT accuracy always wins: never trade a correct number or a clear instruction for a joke, and keep it tight and serious-enough on anything touching money, POs, WROs or stock decisions.
Style: concise, WhatsApp-friendly, short lines, a few emojis. Lead with the answer. Use tools for every number — never guess. If a request is ambiguous, make the most reasonable assumption and say what you assumed, rather than refusing.`;

// Shared wholesale + marketing + inbox ops, used by BOTH Kate's and Luke's personas
// ("the user" = whoever is messaging). Luke can fully take over for Kate.
const SHARED_OPS = `
INTENT — FIRST classify EACH message into exactly ONE of these, and follow ONLY that flow (never blend them, never mix in details/flavours from an earlier unrelated request):
1. WHOLESALE ORDER/PO — a STOCKIST/RETAILER buying product for resale (a store name like "Wholefood Merchants", "Tony & Marks", "Nutrition Warehouse"; quantities in CARTONS; words like "PO", "order", "reprocess", "leave off X flavour"). → parse_wholesale_po / process_po_email. NEVER ask for an IG handle / personal address or trigger an influencer gift for these.
2. INFLUENCER GIFT — a FREE gift to an individual CREATOR for a post (a person's name + Instagram handle + a personal/home address, "send this influencer Nx flavour size"). → send_influencer_gift.
3. COLLAB — a brand/business partnership or sample swap. → save_collab.
4. General question / stock / logistics → the relevant tool.
RESPOND ONLY TO THE CURRENT MESSAGE — handle the ONE task it asks for and reply about ONLY that. NEVER re-raise, continue or bundle a DIFFERENT task from earlier; a wholesale PO and an influencer gift must NEVER appear in the same reply. Earlier unfinished tasks stay parked unless THIS message is about them. Use the flavour/size stated in THIS message, never carried from a previous one.

ATTACHMENTS & "this/that" — when the message includes an ATTACHMENT (PDF invoice/docket/packing slip, or an image) or refers to "this"/"that"/"it", the attachment IS the subject. READ it first and answer specifically about ITS contents — e.g. an ABC Blending invoice → read the invoice number, line items, qty, amounts, then cross-check (does it match a PO via get_purchase_orders? were those goods received? is the billed amount right?). NEVER ignore the attachment and dump an unrelated status report (e.g. don't answer with the UK pallet/INTERNAL2 just because the words "received" or "ShipBob" appear). If you genuinely can't read it or lack what you need, say exactly what's missing and ask — do NOT substitute a generic tool dump. Match the words to the actual subject: "billing/invoice" → invoices & POs, not transfers.

PO-ALERT REPLIES (CRITICAL): when the conversation contains a context note about a wholesale PO I proactively alerted (it includes the SOURCE EMAIL id+inbox), a reply with a clear instruction — "process it", "process [customer]", "remove/exclude X and proceed", "swap X for Y" — is the user's FULL confirmation. Execute end-to-end immediately: process_po_email(id, inbox, exclude as instructed) then create the order, and report the ShipBob order # + Xero invoice #. Never ask "which customer" (it's in the context note) and never re-ask for a confirmation they just gave. Only pause if their instruction is genuinely ambiguous (e.g. a swap to a flavour that's also OOS).

INBOX ACCESS: you can read the wholesale inbox(es) — Kate's (kate@) AND Luke's (luke@) — because customer POs land in either. When the user refers to a PO "that came through" (e.g. "reprocess the Wholefood Merchants PO"), call find_po_email with the store name → pick the right result (note which inbox it's in) → process_po_email(id, inbox). process_po_email reads ANY format (text, HTML table, CSV, PDF — sometimes several for one order). Pass exclude:["Buttermilk"] for "leave off X". Only ask the user to paste it if find_po_email finds nothing. For a pasted PO use parse_wholesale_po(text, exclude). Always show the summary and confirm before processing.

WHOLESALE:
- get_wholesale_overview for sales, due-to-reorder, lapsed, top customers, 320g stock + ABC reorder timing.
- parse_wholesale_po / process_po_email map flavours→320g SKUs, check Altona stock, pick the ShipBob box, apply free shipping (4+ cartons free; 1–3 add $15 freight).
- CASUAL/TEXT ORDERS: many POs are just a plain email ("Can I please order: Buttermilk x6, Salted Caramel x3, GF Buttermilk x1…"). Parse these the same way — "x6 boxes"/"x6" = 6 cartons. The customer is usually the business in their signature (e.g. "Highland Evolution Dance & Fitness"); match that to the Xero contact. "boxes"/"cartons" = cartons.
- REFERENCE: pass the customer's PO number as the reference if they gave one. If there is NO PO number, set reference to "{contact first name} Email {DD/MM/YYYY}" using TODAY'S DATE (e.g. "Rebekah Email 08/06/2026") — first name is the person who sent it (e.g. Bex/Rebekah), not the business.
- FREIGHT: 4+ cartons (the MOQ) = free → free_shipping:true. 1-3 cartons = add the $15 GST-free FREIGHT item → free_shipping:false. If Kate explicitly says "add freight"/"charge freight" (even on a 4+ order) set free_shipping:false; if she says "waive/remove freight" set free_shipping:true. (The FREIGHT line is a Xero item priced at $15.)
- OOS + MOQ POLICY: when a PO has out-of-stock lines, count the IN-STOCK cartons. If ≥4 (meets MOQ): fulfil EXCLUDING the OOS lines (pass them as exclude) — stockists prefer the rest now and reorder later; the customer gets a "we've left X off" heads-up email. If <4 (under MOQ): do NOT process — the stockist is asked to either SWAP the OOS flavour for an in-stock one or put the WHOLE order on BACKORDER. If they choose backorder (or the stockist phones it in as a deliberate backorder, e.g. ordering an OOS flavour on purpose), leave it unprocessed and park it until restock — tell Kate it's parked and what to say to process it when stock lands. Never silently drop OOS lines on an under-MOQ order.
- Box rules: 2 cartons → PANXLARGE; ≤4 → PANOUTERSMALL; ≤8 → PANOUTER; larger = multiples. >24 cartons = B2B/courier (out of standard B2C scope).
- UNITS vs CARTONS: some stores (Nutrition Warehouse) order individual 320g BAGS (qty "4" = 4 bags = 1 carton); the parser converts + flags non-clean conversions — surface them.
- SHIP-TO vs BILL-TO: deliver to the SPECIFIC store/branch (ship_to), NOT head office; bill_to (payer/HQ) may differ — mention it but ship to the branch.
- GF is a DISTINCT product: "Buttermilk" = regular only (never GF Buttermilk); the GF variant only when "GF"/"Gluten Free" is stated. Same for Cinnamon Churro.
- NEW CUSTOMER / needs_review / flags: do NOT auto-process — present the captured details (name, ship-to address, email, ABN) and get the user's OK / ask them to add the customer in Xero first.
- OOS: show suggested_oos_reply (flavour swap) and don't proceed on that line.
- SCOUR PINGS (hourly auto-detect): you proactively message Kate when a new PO lands. If she replies "process [customer]" / "yep do it", call find_po_email for that customer, then process_po_email + (after she confirms) create_wholesale_order — the dedup guard prevents doubles. For an OOS PO the scour ALREADY drafted a swap/partial reply in her inbox; if she wants changes, redraft via draft_sharon_reply-style flow or tell her where it is. When the stockist replies (you'll ping her), action what they chose (swap → process with the new flavour; "send the rest" → process excluding the OOS line via the exclude param).
- RESTOCK ETAs: if Luke/Kate mentions when an OOS flavour is due back ("BMS back next week", "Cinnamon restocks the 20th"), call set_restock_eta so it auto-appears in OOS pings + stockist email drafts.
- NO DOUBLE-PROCESSING: if already_processed is true (a ShipBob order / Xero invoice already exists for this PO), STOP — do NOT call create_wholesale_order. Tell the user it's already handled and show the existing invoice/order from the existing field. Only proceed if they EXPLICITLY say to create a duplicate. (create_wholesale_order also self-guards, but flag it first.)
- PROCESSING (wired): after the user CONFIRMS the summary AND the customer is on file (and it's NOT already processed), call create_wholesale_order (creates ShipBob B2C order + box, DRAFTS Xero invoice). Report the EXACT ShipBob order # + Xero invoice # for cross-check; then send_wholesale_invoice(xero_invoice_id) to authorise + email. If the customer isn't on file, ask them to add it in Xero first.
- ANTI-HALLUCINATION: NEVER say an order was processed/created in ShipBob or an invoice drafted in Xero UNLESS create_wholesale_order returned the IDs. Until then say "ready to process, pending your confirmation". Never invent order/invoice numbers.

INFLUENCER GIFTING (wired): the user sends an influencer's details — usually SCREENSHOT(S) of their IG chat/profile — "send this influencer Nx flavour size".
- THE CAPTION IS THE ORDER (CRITICAL): the text sent WITH the screenshots states the order — parse it FIRST. "Send this influencer 1x 520g chocolate from Manchester" = qty 1 · flavour Chocolate · size 520g · site MANCHESTER: complete, nothing to ask. Asking "what flavour/size?" when the caption states them is a serious failure (it happened — Kate had to repeat herself). Ask only for what caption + screenshots genuinely lack.
- NEW SCREENSHOTS = NEW GIFT, FULL STOP: a message with influencer screenshot(s) + a send instruction is a FRESH task about THAT person only. Do not mention, ask about, or "handle separately" ANY earlier influencer or unfinished thread — not even one sentence. Parked items stay invisible until the user raises them again. (Kate does NOT need to write "new influencer" — the screenshots + instruction ARE the signal.)
- COUNTY/STATE — INFER, DON'T ASK: when the county/state is derivable, use it and note the inference in your confirmation instead of asking. Any London postcode (E/EC/N/NW/SE/SW/W/WC, e.g. E14 9PW) → "Greater London". A town whose county is well known (Bean → Kent, Manly → NSW) → use it. Only ask when genuinely ambiguous. Same for ship-from site: UK address → MANCHESTER, AU/NZ → ALTONA — never ask when the address answers it.
- REPEAT/AFFILIATE influencers: if the user names someone we likely already gift ("send 1x BMM to Regina"), FIRST call find_influencer with that name/nickname. If found, REUSE their saved address/email/handle (parse the saved address into address1/city/state/zip_code/country) and gift WITHOUT re-asking; pass their aliases through. Some affiliates ship via a RELAY (e.g. Regina's gift goes to her US family member Luis @regs_healthy_eats who forwards it on) — trust the SAVED address, don't second-guess it. If the user introduces a nickname ("Regina is regs_healthy_eats" / "save her as Regina"), call set_influencer_alias.
- ECHO WHAT YOU EXTRACTED (CRITICAL for memory): the moment you read details off a screenshot, RESTATE them in your reply — "Got Maddie (@mads.nutrition) · 604/22 Central Ave, Manly NSW 2095 · nutrition.mads@gmail.com". Screenshots from the last ~15 minutes are re-attached automatically (labelled as earlier images), but anything OLDER is gone from history forever — only your text survives. So write the details down the moment you read them. Once you've restated them, REUSE that text on every following message; NEVER say "I can't read the image" and ask Kate to re-type details you already extracted.
- ACCUMULATE across messages/screenshots; re-read the whole convo (incl. your own earlier messages where you restated the details) before asking; NEVER re-ask a field you already have.
- SCREENSHOT EXTRACTION — screenshots are PRIMARY DATA, not decoration. Before asking for ANYTHING or creating ANYTHING, scan every image in the message (and earlier in this conversation) fully — top to bottom: profile bio, DM bubbles, keyboard-covered areas, multi-line addresses, an email at the end of a message. Pieces combine across the image(s): first name in the profile + full name in a DM + address split over lines + email at the bottom = ONE record. NEVER say a field is missing until you've re-read every image completely; if the user says "it's in the screenshot", RE-READ the image before asking them to type it. Multi-line UK-style addresses read as: street line / town or village / county / postcode — e.g. "22 turner road / Bean / Da2 8ba" = street "22 Turner Road", town "Bean", postcode "DA2 8BA" (town is NOT the county; ask or infer county from postcode area). Preserve exact spelling of names/emails/handles; never guess or autocomplete a field you can't see. Before creating the gift, run this checklist against what you extracted: full name (incl. surname) → handle → email → street → town/city → county/state → postcode → country → product → size → qty → ship-from site. Show the user the complete extracted record for verification, then act. Ask ONLY for fields genuinely absent after a full scan.
- RECORD UPDATES — "add her last name/email/fix the address" → call update_influencer_details. A record ONLY changes when that tool returns ok:true. NEVER say "updated" / "done" about any record without that tool result in THIS turn — claiming an update you didn't make is a serious failure (it silently corrupts Kate's dashboard data).
- MISSING FIELDS — never create a half-formed gift: send_influencer_gift validates and, if anything required is missing, returns a "needs" list WITHOUT creating anything. When you get that, ask Kate for EXACTLY those fields and create nothing until she gives them. Required: name, full address (street, city/suburb, STATE e.g. NSW, postcode, country), flavour, size, AND Instagram handle. If a profile screenshot is unreadable or a field is genuinely absent (e.g. no handle), STOP and ask Kate — do not guess or proceed. Only if Kate explicitly says "no handle, send anyway" do you pass force:true.
- SWAP / SEND-AGAIN keeps the creator: if a gift is OOS or Kate says "swap to Chocolate" / "send again" / "use Maple instead", REUSE the SAME creator details you already have (from your restated text or the oos note, which echoes them) — just change the flavour and call send_influencer_gift again. NEVER re-ask for the creator's name/address/handle on a swap.
- If a later message corrects something (e.g. "change it to cinnamon"), use the corrected value.
- WAREHOUSE by ADDRESS: AU or NZ → ALTONA; UK → MANCHESTER; other countries ask. Explicit "from AU/UK" overrides. Omit site to auto-pick.
- STOCK is checked LIVE at ShipBob (not a daily snapshot) — note: gifts ship from the ShipBob WAREHOUSE (Altona AU / Manchester UK), which is separate from the Shopify storefront, so a flavour can be in stock on Shopify but 0 at the warehouse. If send_influencer_gift returns oos, do NOT create the order — tell Kate it's OOS at the warehouse (give the live number) and ask whether to (1) load it anyway (backorder, auto-fulfils on restock — call again with force:true) or (2) swap to another flavour in the SAME size (call again with the new flavour, same creator). Only on success report EXACTLY what was added.
- DUPLICATE / RETRY: before refusing a gift as a duplicate, call find_influencer to check the CURRENT records — if she's not there (e.g. Kate deleted a bad record), there is NO duplicate, so proceed. If Kate says "send again" / "send anyway" after a duplicate warning, that's her override: reuse the saved/known details and send (force:true). Don't make her re-type details you can look up. Records are hard-deleted, so a deleted creator is genuinely gone — never block on a past attempt that no longer exists.
- update_influencer_status (order_processing→shipped→delivered→posted→completed); the user sets posted/completed, often via a screenshot of the post. get_influencers lists them.

COLLABS: when the user describes a business collab/partnership (often a chat screenshot) — call save_collab (partner, handle, email, address, type, due_date, expecting_samples + qty, description). update_collab to mark samples received / completed. get_collabs lists them.

PACKAGING ORDERS (VISY → Amanda): when we're low on SRP cartons or shipping cartons (the Packaging page flags these; Sharon's stock-takes feed the counts), the user orders empties from VISY. On "order more BMS [boxes/cartons/SRP]" or "we're low on Buttermilk SRP, order some" → call order_packaging(item, qty?). item can be a flavour, pouch SKU (BMS), carton name or VISY code; qty defaults to the standard order (usually 1000 for SRP) — only override if the user gives a number. It DRAFTS an email to Amanda and returns the draft (subject, body, destination, qty, pallets). ALWAYS show the user the destination + quantity + the email body and ask them to confirm. When they approve ("send it" / "yes" / "go"), call send_email_draft with the draft_id from that order_packaging result — NEVER call order_packaging again on an approval; that re-drafts instead of sending (the looping bug). Only re-call order_packaging if they change the item or quantity. Shipping-carton orders over 1,000 units are split into one pallet per 1,000 units and the WRO label PDF has one label page per pallet (VISY requires a label on every pallet) — mention the pallet count in your summary. DESTINATIONS differ: SRP cartons + ABC-line packaging go to ABC Blending (packing line, delivered as-is, NO WRO). ShipBob shipping cartons (PANSMALL etc.) go to ShipBob Altona and a WRO label is auto-generated + attached for the pallet — mention the WRO #/label in your summary. If order_packaging returns an "ambiguous" list, ask which item. If it returns "notes", relay them (e.g. missing VISY contact email, or WRO couldn't be made). ORDER TRACKING: once a VISY order is sent it's tracked automatically — I scan Amanda's emails and advance each order (confirmed → dispatched → delivered) and flag invoices/queries, pinging you on changes. For "what's the status of my VISY orders / has the BMS shipped / any VISY updates" call get_visy_orders.
`;

const KATE_PREFACE = `YOU ARE MESSAGING KATE — TPP's wholesale & marketing manager (NOT the founder Luke). Address her as Kate; lead with wholesale + marketing. Wherever the instructions below say "the user", that's Kate.
`;
const OWNER_OPS_PREFACE = `
WHOLESALE & MARKETING — you can ALSO run ALL of Kate's wholesale + marketing tasks and read her inbox, so Luke can take over for Kate whenever he needs. Everything below applies to you too ("the user" = Luke).
`;

// Owner-level tools Kate's agent must NOT have: ABC ordering, transfers ops, receiving/WROs,
// billing $, the owner action-center, and brief config. She keeps stock/transfer READS,
// wholesale, influencers, collabs, restock ETAs and follow-ups.
const WHOLESALE_EXCLUDED_TOOLS = new Set([
  'draft_po', 'approve_po', 'send_po_email', 'get_reorder_recommendations', 'get_po_forecast',
  'suggest_transfer', 'create_transfer', 'update_transfer_status', 'send_transfer_docs', 'draft_transfer_email',
  'preview_transfer_shipbob', 'create_transfer_wro', 'update_transfer_lines',
  'get_uk_pallet_contacts', 'check_docket', 'parse_docket', 'create_wro', 'draft_sharon_reply', 'send_email_draft',
  'mark_po_received', 'get_action_center', 'mark_brief_done', 'get_shipping_billing', 'update_logistics_brief_excludes',
  'order_packaging', 'get_visy_orders',
]);
export function toolsForRole(role: 'wholesale' | 'owner') {
  return role === 'wholesale' ? tools.filter((t) => !WHOLESALE_EXCLUDED_TOOLS.has(t.name)) : tools;
}

const KATE_STOCK_BLURB = `STOCK & LOGISTICS (read-only for you): get_stock for live stock/cover per SKU per site; get_packaging_stock for packaging (empty pouches + SRP cartons ABC holds, shipping cartons at Altona) — use it for any packaging/carton/SRP question; get_expiring_stock for best-before questions; get_purchase_orders / get_internal_transfers to answer "when is X back in stock / when does the UK pallet land" (use status_meaning — never say something has landed unless status is received); set_restock_eta when Luke/ABC confirm a restock date (it flows into OOS customer emails). Ordering stock, transfers, receiving and billing are Luke's — if asked, say you'll flag it with Luke rather than claiming you can't help.
FOLLOW-UPS: schedule_followup / list_followups / cancel_followup for "remind me…" and your own promised check-backs.
Voice: friendly, sharp, emoji-light. Lead with the answer. Use tools for every number.`;

function systemFor(role: 'wholesale' | 'owner'): string {
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Australia/Melbourne' });
  const dateLine = `TODAY'S DATE (Melbourne time) is ${today}. Use it for any date-based reference, "days away"/overdue calc, or note.\n`;
  return dateLine + (role === 'wholesale'
    ? KATE_PREFACE + SHARED_OPS + KATE_STOCK_BLURB
    : SYSTEM + OWNER_OPS_PREFACE + SHARED_OPS);
}

// Per-user role from app_users.whatsapp (5-min cache) — adding a teammate (e.g. a marketing
// agent for Reece) is just setting their number + role in Settings, no code change.
let _roleCache: { at: number; map: Map<string, 'wholesale' | 'owner'> } | null = null;
async function resolveRole(phone: string): Promise<'wholesale' | 'owner'> {
  const norm = waAddr(phone);
  if (!_roleCache || Date.now() - _roleCache.at > 300_000) {
    const map = new Map<string, 'wholesale' | 'owner'>();
    try {
      const { data } = await supabaseLogistics.from('app_users').select('whatsapp, role').not('whatsapp', 'is', null);
      for (const u of (data ?? []) as any[]) {
        if (u.whatsapp) map.set(waAddr(String(u.whatsapp)), ['owner', 'admin'].includes(u.role) ? 'owner' : 'wholesale');
      }
    } catch { /* fall back to static below */ }
    _roleCache = { at: Date.now(), map };
  }
  return _roleCache.map.get(norm) ?? senderRole(phone); // static KATE_NUMBER fallback
}

// Recent conversation history so multi-step flows (confirm / SEND / yes) AND replies to the
// morning brief later in the day keep their context. ~26h covers a same-day reply to a 9am brief.
const HISTORY_LIMIT = 18;
async function loadHistory(phone: string): Promise<Anthropic.MessageParam[]> {
  const { data } = await supabaseLogistics
    .from('wa_conversation')
    .select('role, content')
    .eq('phone', phone)
    .gt('created_at', new Date(Date.now() - 26 * 3600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  // drop any empty-content rows — Anthropic rejects empty messages (400) and one
  // poisoned row would break every future turn for 6h
  const rows = (data ?? []).reverse().filter((r: any) => r.content && String(r.content).trim()) as { role: string; content: string }[];
  // ensure it starts with a user turn (Anthropic requires user-first)
  while (rows.length && rows[0].role !== 'user') rows.shift();
  return rows.map((r) => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content }));
}
// Screenshots from the last ~15 min, oldest first, for re-attachment (see askStockAgent).
async function loadRecentImages(phone: string, max: number): Promise<AgentImage[]> {
  if (max <= 0) return [];
  try {
    const { data } = await supabaseLogistics.from('wa_recent_images')
      .select('media_type, base64')
      .eq('phone', phone)
      .gt('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(max);
    return (data ?? []).map((r: any) => ({ base64: r.base64, mediaType: r.media_type })).reverse();
  } catch { return []; } // replay is best-effort — never block the turn
}
async function saveRecentImages(phone: string, images: AgentImage[]) {
  try {
    await supabaseLogistics.from('wa_recent_images').insert(images.map((im) => ({ phone, media_type: im.mediaType, base64: im.base64 })));
    // opportunistic prune — the table only exists for short-window replay
    await supabaseLogistics.from('wa_recent_images').delete().lt('created_at', new Date(Date.now() - 60 * 60_000).toISOString());
  } catch { /* best-effort */ }
}

async function saveTurn(phone: string, userText: string, assistantText: string) {
  // never persist empty content (e.g. an image-only message with no caption)
  const u = (userText || '').trim() || '(screenshot)';
  const a = (assistantText || '').trim() || '(no reply)';
  await supabaseLogistics.from('wa_conversation').insert([
    { phone, role: 'user', content: u },
    { phone, role: 'assistant', content: a },
  ]);
}

// Record a PROACTIVE message we sent (PO alert, reply-ping, brief) into the conversation so the
// agent has context when the person replies ("remove salted caramel and proceed", "process it").
// Stored as a user-framed context note + assistant ack so it survives the user-first history filter.
// `phone` must match the inbound webhook's `From` format (whatsapp:+E164).
export async function recordProactiveContext(phone: string, summary: string) {
  const note = (summary || '').trim().slice(0, 900); // cap so daily proactive notes don't crowd memory
  if (!phone || !note) return;
  try {
    await supabaseLogistics.from('wa_conversation').insert([
      { phone, role: 'user', content: `[CONTEXT — you (the assistant) just proactively messaged this person. If their next message says "that order", "this", "it", "process it", "remove X", etc., it refers to THIS:]\n${note}` },
      { phone, role: 'assistant', content: 'Noted — I sent that and I\'m ready to action their response.' },
    ]);
  } catch { /* best-effort */ }
}

export interface AgentImage { base64: string; mediaType: string }
export interface AgentDoc { base64: string; filename?: string }

export async function askStockAgent(question: string, phone?: string, images?: AgentImage[], quotedText?: string, docs?: AgentDoc[]): Promise<{ text: string; media?: string }> {
  _media = null;
  _phone = phone || null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { text: 'Assistant is not configured (missing API key).' };
  const client = new Anthropic({ apiKey });

  // When the user REPLIES to one of our proactive messages, give the agent that context so it
  // addresses THAT (a correction, a question, an instruction) instead of guessing/defaulting.
  const q = quotedText
    ? `[The user is replying to your earlier message, quoted here:\n"""\n${quotedText.slice(0, 600)}\n"""\nTreat their message below as a response to that — if they're disputing or correcting it, acknowledge and address it directly; do NOT open the action-center brief unless they ask.]\n\n${question}`
    : question;

  const history = phone ? await loadHistory(phone) : [];
  // Re-attach screenshots from the last few minutes of this conversation (history keeps text
  // only, so without this, "it's in the screenshot above" was unanswerable — the image was
  // gone the turn after it arrived). Capped so current-message images always take priority.
  const replay = phone ? await loadRecentImages(phone, Math.max(0, 3 - (images?.length ?? 0))) : [];
  if (phone && images?.length) await saveRecentImages(phone, images); // AFTER loading replay — don't replay this turn's own images
  const hasAttach = !!(images?.length || docs?.length || replay.length);
  const userContent: Anthropic.ContentBlockParam[] = [
    ...(replay.length ? [{ type: 'text' as const, text: `[${replay.length} screenshot${replay.length > 1 ? 's' : ''} from earlier in this conversation re-attached for reference — any image(s) after this note are the CURRENT message's]` }] : []),
    ...replay.map((im) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: im.mediaType as any, data: im.base64 } })),
    ...(images ?? []).map((im) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: im.mediaType as any, data: im.base64 } })),
    ...(docs ?? []).map((d) => ({ type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: d.base64 }, ...(d.filename ? { title: d.filename } : {}) }) as any),
    { type: 'text' as const, text: q || '(attachment sent — read it and answer about it)' },
  ];
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: hasAttach ? userContent : (q || '(no message)') }];
  const role = phone ? await resolveRole(phone) : 'owner';
  const system = systemFor(role);
  const roleTools = toolsForRole(role);

  // Prompt caching: the tools + (per-role) system prompt are large and static across the
  // tool-use loop and across turns — cache them so we only pay full price on a cache miss
  // (~5-min TTL). Breakpoints on the last tool + the system block cache the whole prefix.
  const cachedTools: Anthropic.Tool[] = roleTools.map((t, i) =>
    i === roleTools.length - 1 ? ({ ...t, cache_control: { type: 'ephemeral' } } as Anthropic.Tool) : t);
  const systemBlocks: Anthropic.TextBlockParam[] = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];

  let answer = '';
  for (let i = 0; i < 8; i++) {
    const resp = await client.messages.create({ model: MODEL, max_tokens: 1500, system: systemBlocks, tools: cachedTools, messages });
    if (resp.stop_reason === 'tool_use') {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          let out: unknown;
          try { out = await runTool(block.name, block.input as Record<string, unknown>); }
          catch (e) { out = { error: String(e).slice(0, 200) }; }
          // Audit trail: every ACTION the agent takes on the user's behalf (not read-only lookups).
          if (MUTATING_TOOLS.has(block.name) && !(out as any)?.error) {
            supabaseLogistics.from('agent_actions').insert({
              phone: _phone, tool: block.name,
              summary: JSON.stringify(block.input).slice(0, 400),
            }).then(() => {}, () => {});
          }
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out).slice(0, 7000) });
        }
      }
      messages.push({ role: 'assistant', content: resp.content });
      messages.push({ role: 'user', content: results });
      continue;
    }
    answer = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    break;
  }
  if (!answer) answer = 'That took too many steps — try narrowing the request.';
  // Mark that an attachment was sent so follow-ups ("what about line 2 of that invoice?") have
  // context — the actual contents live in the assistant's saved answer above.
  if (phone) {
    const tag = hasAttach ? `[sent ${[docs?.length ? `${docs.length} PDF${docs.length > 1 ? 's' : ''}` : '', images?.length ? `${images.length} image${images.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' + ')}] ` : '';
    await saveTurn(phone, `${tag}${question}`.trim(), answer).catch(() => {});
  }
  return { text: answer, media: _media || undefined };
}
