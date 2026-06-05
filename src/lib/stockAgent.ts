// Claude agent that answers logistics questions + drafts POs (used by WhatsApp).
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { computeStatus, STATUS_META, PRIMARY_FLAVOURS } from './stock';
import { OPEN_STATUSES } from './po-types';
import { proposeFlavourPOs, proposeOneFlavour } from './poBuilder';
import { draftWhatsAppPO, approveLatestWhatsAppDraft, sendLatestPOEmail } from './poActions';
import { markPOReceived } from './poReconcile';
import { findLatestDocket, parseDocket, createWROFromParsed, draftSharonReply } from './wroFlow';
import { gmailSendDraft, gmailCreateDraft } from './google';
import { getLots, expiryStatus, EXPIRY_META } from './lots';
import { getShippingData } from './shipping';
import { getBillingData, buildHighlights } from './billing';
import { getTransfer, transferUnits, transferValue } from './transfers';
import { suggestRestock, createDraftTransfer } from './transferBuilder';
import { getActionCenter } from './actionCenter';
import { getPoForecast } from './poForecast';
import { MAERSK } from './transferConstants';
import { sendWhatsApp } from './whatsapp';

const APP_URL = process.env.PUBLIC_APP_URL || 'https://admin.theproteinpancake.co';
const TRANSFER_DOC_LIST: [string, string][] = [['commercial-invoice', 'Commercial Invoice'], ['packing-list', 'Packing List']];

const MODEL = 'claude-sonnet-4-6';

const tools: Anthropic.Tool[] = [
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
    description: 'Preview a UK (Manchester) restock transfer WITHOUT creating it. UK transfers are 520g MEDIUM BAGS ONLY (no 320g, no 1kg — that is the current UK roll-out strategy). Logic: (1) cover demand to ~180 days using live per-SKU velocity, accounting for stock already inbound (e.g. INTERNAL2); (2) MAXIMISE the pallet(s) by topping up the best sellers (by velocity) — including ones already inbound — up to capacity, capped by Altona stock. Pallet = 75 cartons × 12 = 900 units (~468kg) at 5 layers. Returns lines with units + cartons (12/ctn), plus pallets, total cartons & kg. Pass `pallets` to force a count (e.g. 2). Syrup/accessories are NOT auto-included — add them manually only if the user asks. Use for "build a transfer / INTERNAL3", "what should we send to the UK". Show the lines + totals and confirm before create_transfer.',
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
    name: 'draft_transfer_email',
    description: 'Draft (NOT send) an email to Jordan at Maersk to start/progress a transfer, with links to the Commercial Invoice + Packing List. Show the user the draft; only send_email_draft when they explicitly approve.',
    input_schema: { type: 'object', properties: { reference: { type: 'string' } }, required: ['reference'] },
  },
  {
    name: 'get_internal_transfers',
    description: 'Internal stock transfers between sites (e.g. Altona AU → Manchester UK pallets). Returns reference, status, ETA, carrier/BL, and the SKUs + units inbound. These units already count toward the destination site\'s inbound stock. Use for "what\'s on the way to the UK / Manchester", "the pallet", "internal transfer", "INTERNAL2".',
    input_schema: { type: 'object', properties: { reference: { type: 'string', description: 'optional transfer reference e.g. INTERNAL2' } } },
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
    description: 'Read & parse the docket PDF → SKUs, lots, best-before dates, qty, linked PO. Use messageId from check_docket. ALWAYS show the user the lots + best-befores and ask them to confirm before creating a WRO.',
    input_schema: { type: 'object', properties: { messageId: { type: 'string' } }, required: ['messageId'] },
  },
  {
    name: 'create_wro',
    description: 'Create the ShipBob WRO from the docket (with lots + expiry) and link the PO. ONLY after the user has confirmed the best-befores. Returns the WRO number.',
    input_schema: { type: 'object', properties: { messageId: { type: 'string' } }, required: ['messageId'] },
  },
  {
    name: 'draft_sharon_reply',
    description: 'Draft (NOT send) the reply to Sharon with the WRO box-labels PDF attached. Use her email + docket ref from check_docket and the WRO id from create_wro. Returns the exact subject + body — show the user the body VERBATIM (do not paraphrase) so what they approve is what sends. Only send_email_draft after they approve.',
    input_schema: { type: 'object', properties: { to: { type: 'string' }, docket_ref: { type: 'string' }, wro_id: { type: 'number' } }, required: ['to', 'wro_id'] },
  },
  {
    name: 'send_email_draft',
    description: 'Send a Gmail draft. ONLY when the user explicitly approves sending (e.g. "send it to Sharon").',
    input_schema: { type: 'object', properties: { draft_id: { type: 'string' } }, required: ['draft_id'] },
  },
];

let _media: string | null = null; // screenshot URL set by draft_po within a single run
let _phone: string | null = null; // WhatsApp recipient for tools that send media directly

async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
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
    let out = rows.map((r) => ({
      sku: r.sku, flavour: r.flavour, size: r.unit_size_g >= 1000 ? `${r.unit_size_g / 1000}kg` : `${r.unit_size_g}g`,
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
    return acts.length ? acts.map((a) => ({ priority: a.severity, title: a.title, detail: a.detail, say_to_action: a.command })) : { note: 'All clear — nothing needs action right now. ✅' };
  }
  if (name === 'suggest_transfer') {
    const pallets = input.pallets ? Number(input.pallets) : undefined;
    const s = await suggestRestock((input.destination as string) || 'MANCHESTER', 'ALTONA', { pallets });
    return {
      destination: s.destination, origin: s.origin, target_days: s.target_days,
      pallets: s.pallets, cartons: s.cartons, cartons_per_pallet: s.cartons_per_pallet,
      total_units: s.total_units, total_kg: s.total_kg, total_value: s.total_value,
      lines: s.lines.map((l) => ({ sku: l.sku, flavour: l.flavour, size: l.size, units: l.suggested, cartons: l.cartons, uk_cover_days: l.days_cover, daily: l.daily, inbound: l.inbound, altona_available: l.origin_available, note: l.reason })),
      note: s.lines.length ? `Preview only — ${s.pallets} pallet(s), ${s.cartons} cartons (~${s.total_kg}kg). 520g + 1kg only. Confirm with the user, then call create_transfer with the same pallets value.` : 'Nothing to send — no Altona stock or demand signal.',
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
  if (name === 'draft_transfer_email') {
    const ref = String(input.reference || '');
    const t = await getTransfer(ref);
    if (!t) return { error: `No transfer found with reference ${ref}.` };
    const route = `${t.origin_code || 'AU'} → ${t.destination_code || 'UK'}`;
    const subject = `The Protein Pancake — ${ref} ${route} pallet transfer`;
    const body =
`Hi ${MAERSK.name.split(' ')[0]},

Please find the documents to start our next stock transfer (${ref}), ${route}.

• Commercial Invoice: ${APP_URL}/api/transfers/${ref}/commercial-invoice
• Packing List: ${APP_URL}/api/transfers/${ref}/packing-list

Summary: ${transferUnits(t).toLocaleString()} units${t.cartons ? `, ${t.cartons} cartons` : ''}${t.gross_kg ? `, ~${t.gross_kg}kg gross` : ''}. Incoterms DDP Heywood. Let me know what else you need from my end to get this booked.

Thanks,
Luke`;
    try {
      const draftId = await gmailCreateDraft(MAERSK.email, subject, body);
      return { draft_id: draftId, to: MAERSK.email, subject, note: 'Draft created — show the user and ask before sending.' };
    } catch (e) { return { error: String(e).slice(0, 160) }; }
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
    try { return await parseDocket(String(input.messageId)); }
    catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  if (name === 'create_wro') {
    try {
      const parsed = await parseDocket(String(input.messageId));
      const res = await createWROFromParsed(parsed);
      return { ...res, docket_ref: parsed.docket_ref, po_ref: parsed.po_ref };
    } catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  if (name === 'draft_sharon_reply') {
    try {
      return await draftSharonReply(String(input.to), (input.docket_ref as string) || null, Number(input.wro_id));
    } catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  if (name === 'send_email_draft') {
    try { await gmailSendDraft(String(input.draft_id)); return { sent: true }; }
    catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  return { error: 'unknown tool' };
}

const SYSTEM = `You are the logistics operations assistant for The Protein Pancake (TPP), messaging the founder on WhatsApp. You are the single point of contact for ALL logistics tasks.
Live data + real actions via tools. Sites: Altona (AU, AUD) & Manchester (UK, GBP). Primary SKUs: ${PRIMARY_FLAVOURS.join(', ')}.
"Days of cover" = available ÷ daily sales. "Inbound" = units on open POs.

CRITICAL RULE — never say you can't do something logistics-related without FIRST calling the relevant tool. If a tool returns no rows, say "no data found right now", NOT "I don't have access". You DO have every capability below. Do not describe your own tool list to the user; just answer.

Your full toolkit:
- get_action_center — the proactive cross-site priority list (transfers due, POs, packaging, expiry, billing). Lead with this for "what needs my attention" and when opening a proactive check-in; then offer to action the top items.
- get_stock — live on-hand, available, days of cover, inbound, velocity, status, per SKU per site.
- get_expiring_stock — batch/lot best-before dates, days left, soonest-expiring stock (BOTH sites). This covers ALL expiry / shortest-dated / batch / best-before questions.
- get_purchase_orders — POs: supplier, status, expected date, outstanding units.
- get_po_forecast — the 3-month rolling ABC order schedule (what to order each month). Use for "PO schedule / plan / what to order over the next months".
- get_reorder_recommendations — what to order & how many (velocity × lead+target − stock − inbound).
- get_shipping_billing — shipping cost trends, monthly spend, MoM change, cost OUTLIERS/overcharges, invoices.
- get_internal_transfers — AU→UK stock transfers (pallets) in transit; their units already feed the destination site's inbound. Use for "what's on the way to the UK", "the pallet", "INTERNAL2".
- suggest_transfer → create_transfer — propose a UK restock transfer (520g medium bags ONLY; live velocity, 180-day cover + best-seller pallet-fill, Altona-capped); show the preview, confirm, then create the draft. send_transfer_docs — WhatsApp the Commercial Invoice + Packing List PDFs for a transfer to the user. draft_transfer_email — draft (not send) the Maersk/Jordan email to start the transfer. For sending the email, use send_email_draft only after explicit approval.
Transfer STATUS — never overstate it. in_transit = en route (not landed); customs = arrived in-country, CLEARING CUSTOMS (NOT landed/received, not sellable); arrived = at the ShipBob FC being put away (not sellable); received = in available stock. in_transit/customs/arrived all count as INBOUND (baked into cover) but are NOT "landed". Use get_internal_transfers' status_meaning field; describe the real stage (e.g. "INTERNAL2 is clearing UK customs"), don't say a transfer has "landed/arrived" unless status is received.
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
B) When the user then CONFIRMS (e.g. "yes", "correct", "looks good", "go ahead", "create it") in reply to that confirmation request: DO NOT parse or re-show the docket again — go straight to create_wro. (Call check_docket first ONLY to get the messageId, then create_wro with it.) Report the WRO number, then offer the Sharon reply.
Look at the recent conversation: if your previous message already showed the parsed docket and asked them to confirm, a "yes" means CREATE — never show the confirmation a second time or ask them to confirm the same docket twice.
Then offer to reply to Sharon: draft_sharon_reply → show the exact draft → send_email_draft only when they say send. Never create a WRO or send an email without explicit confirmation.

Email drafts: when a draft_* tool returns a subject + body, show the user that EXACT subject and body verbatim (quote it as-is — never rewrite, embellish or summarise it) so what they approve is exactly what gets sent. Mention if a file is attached. Only send after explicit approval.

Multi-step memory: you can see the recent conversation. When the user replies "yes"/"confirm"/"SEND"/"do it", act on what you just proposed — re-fetch any IDs you need (e.g. call check_docket again to get the docket, then create_wro). Never lose the thread.

Voice: you're a fun, witty member of the TPP team with Gen-Z energy — playful and a bit cheeky, light natural slang ("lowkey", "no cap", "sorted", "we move", "that's cooked", "say less") used sparingly so it never feels forced or cringe. Warm and human, like a sharp mate who's got ops handled. BUT accuracy always wins: never trade a correct number or a clear instruction for a joke, and keep it tight and serious-enough on anything touching money, POs, WROs or stock decisions.
Style: concise, WhatsApp-friendly, short lines, a few emojis. Lead with the answer. Use tools for every number — never guess. If a request is ambiguous, make the most reasonable assumption and say what you assumed, rather than refusing.`;

// Recent conversation history (last 6h) so multi-step flows (confirm / SEND / yes) work.
const HISTORY_LIMIT = 12;
async function loadHistory(phone: string): Promise<Anthropic.MessageParam[]> {
  const { data } = await supabaseLogistics
    .from('wa_conversation')
    .select('role, content')
    .eq('phone', phone)
    .gt('created_at', new Date(Date.now() - 6 * 3600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  const rows = (data ?? []).reverse() as { role: string; content: string }[];
  // ensure it starts with a user turn (Anthropic requires user-first)
  while (rows.length && rows[0].role !== 'user') rows.shift();
  return rows.map((r) => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content }));
}
async function saveTurn(phone: string, userText: string, assistantText: string) {
  await supabaseLogistics.from('wa_conversation').insert([
    { phone, role: 'user', content: userText },
    { phone, role: 'assistant', content: assistantText },
  ]);
}

export async function askStockAgent(question: string, phone?: string): Promise<{ text: string; media?: string }> {
  _media = null;
  _phone = phone || null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { text: 'Assistant is not configured (missing API key).' };
  const client = new Anthropic({ apiKey });

  const history = phone ? await loadHistory(phone) : [];
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: question }];

  let answer = '';
  for (let i = 0; i < 8; i++) {
    const resp = await client.messages.create({ model: MODEL, max_tokens: 1500, system: SYSTEM, tools, messages });
    if (resp.stop_reason === 'tool_use') {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          let out: unknown;
          try { out = await runTool(block.name, block.input as Record<string, unknown>); }
          catch (e) { out = { error: String(e).slice(0, 200) }; }
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
  if (phone) await saveTurn(phone, question, answer).catch(() => {});
  return { text: answer, media: _media || undefined };
}
