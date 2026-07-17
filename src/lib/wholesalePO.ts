// Wholesale PO intake: parse a free-text/email PO into SKU + carton lines (handles
// "4 cartons of buttermilk", bare SKUs like "BMS x4", mixed formats), check Altona
// stock can fulfil it, pick the ShipBob box, and apply the free-shipping rule.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { findInvoiceByReference } from './xero';

const MODEL = 'claude-sonnet-4-6';

import { planWholesaleBoxes } from './boxLogic';

export const B2C_MAX_CARTONS = 24;

// Freight policy (Kate, Jul 2026): every wholesale invoice carries the $15 FREIGHT line by
// DEFAULT — free shipping is a per-supplier exception, not a carton-count rule.
//   Nutrition Warehouse — free on 4+ cartons; every invoice also CC'd to their statements inbox
//   LaManna Direct — always free
//   ASN / Australian Sports Nutrition (David Wilkie) — free on 8+ cartons
export function freightRule(customerName: string | null, totalCartons: number): { free: boolean; reason: string } {
  const n = (customerName || '').toLowerCase();
  if (/nutrition\s*warehouse/.test(n)) {
    return totalCartons >= 4
      ? { free: true, reason: 'Nutrition Warehouse — free shipping on 4+ cartons' }
      : { free: false, reason: 'Nutrition Warehouse under 4 cartons — add $15 freight' };
  }
  if (/lamanna/.test(n)) return { free: true, reason: 'LaManna Direct — always free shipping' };
  if (/australian\s*sports\s*nutrition|\basn\b|david\s*wilkie/.test(n)) {
    return totalCartons >= 8
      ? { free: true, reason: 'ASN — free shipping on 8+ cartons' }
      : { free: false, reason: 'ASN under 8 cartons — add $15 freight' };
  }
  return { free: false, reason: 'standard — add $15 freight' };
}
// Accounts-payable copy address for a customer's invoices (null = none needed).
export function freightCc(customerName: string | null): string | null {
  return /nutrition\s*warehouse/i.test(customerName || '') ? 'statements@nutritionwarehouse.com.au' : null;
}

export interface POLine { sku: string; flavour: string; cartons: number; ordered_qty?: number; qty_basis?: string; flag?: string | null; }
export interface ParsedPO {
  po_number: string | null;         // customer PO number (dedup key)
  customer_name: string | null;     // who we ship to / the Xero contact (the specific store)
  bill_to: string | null;           // who pays (e.g. HQ) — may differ from ship-to
  ship_to: string | null;           // full delivery address (the specific store)
  contact_email: string | null;     // the stockist's REAL contact/orders email from the PO body
  lines: POLine[];
  unmatched: string[];
  flags: string[];                  // parser warnings (unit conversion, ambiguity…)
}

export interface AssessedLine extends POLine { available: number; ok: boolean; }
export interface POAssessment {
  po_number: string | null;
  already_processed: boolean;       // a ShipBob order / Xero invoice already exists for this PO
  existing: { xero_invoice?: string | null; shipbob_order_id?: string | null; when?: string | null } | null;
  customer_name: string | null;
  bill_to: string | null;
  ship_to: string | null;
  contact_email: string | null;     // best human reply address from the PO body (not the relay/system sender)
  previous_recipient: { name: string; address1?: string; address2?: string; city?: string; state?: string; zip_code?: string; country?: string; email?: string; from_order: string } | null; // customer's last ShipBob delivery — the shipping source of truth
  customer_on_file: boolean;        // matched an existing Xero/wholesale customer?
  needs_review: boolean;            // true if Kate must check (new customer / flags)
  flags: string[];
  lines: AssessedLine[];
  total_cartons: number;
  fulfillable: boolean;
  oos: { sku: string; flavour: string; cartons: number; available: number }[];
  boxes: string[];
  free_shipping: boolean;
  over_b2c_limit: boolean;
  summary: string;
}

async function wholesaleSkus(): Promise<{ sku: string; flavour: string }[]> {
  const { data } = await supabaseLogistics.from('products')
    .select('sku, flavour, unit_size_g, category, active')
    .eq('active', true).eq('category', 'mix').eq('unit_size_g', 320);
  return (data ?? []).map((p: any) => ({ sku: p.sku, flavour: p.flavour }));
}

const PARSE_SYSTEM = (skuList: string) => `You parse a wholesale purchase order for The Protein Pancake into structured JSON.
Our wholesale 320g SKUs: ${skuList}. A CARTON = 4× 320g bags ("box" = carton). We ship and invoice in CARTONS.
POs arrive in MANY formats — plain email text, HTML tables, CSV, and/or PDF attachments — and sometimes SEVERAL at once for the SAME order. If multiple sources are given they are ONE order: extract ONCE, de-duplicate, prefer the most complete/structured source — NEVER sum the same line across formats.

FLAVOUR→SKU: "buttermilk"=BMS, "gluten free buttermilk"/"GF buttermilk"=GFBS, "cinnamon churro"/"churro"=CIS, "maple"=MAS, "cookies & cream"=CCS, "chocolate"=CHS, "salted caramel"=SCS, "GF cinnamon churro"=GFCIS, "sugar free maple syrup"/"maple syrup"=MSS, plus any other listed flavour by name+size.
GF IS A DISTINCT PRODUCT: a plain flavour is the REGULAR product only — "Buttermilk"=BMS (NOT GFBS), "Cinnamon Churro"=CIS (NOT GFCIS). The Gluten Free variant applies ONLY when "GF" or "Gluten Free" is explicitly written. Never map a plain flavour to its GF SKU or vice versa. Supplier codes (TPPBP01=Buttermilk, TPPMP01=Maple, TPPCC01=Cinnamon Churro, etc.) map by the product NAME shown. Ignore freight/shipping/discount/total lines.

CARTONS vs UNITS (CRITICAL — get the basis right, never the other way):
- DEFAULT IS CARTONS. A stockist typing a casual order ("Buttermilk x8", "8 x buttermilk", "can I get 5 churro") means 8 CARTONS/boxes — wholesale customers order boxes. ordered_qty=8, qty_basis="cartons", cartons=8.
- UNIT (bag) basis ONLY with explicit evidence: a per-bag price (~$7–12) on a single-320g line, or the words "bags"/"units"/"singles"/"320g x N units", or a retailer ordering-system line for a single 320g item (e.g. Nutrition Warehouse). Then cartons = qty ÷ 4.
- CARTON basis is confirmed by "carton"/"box"/"x4 per carton" wording or a per-carton price (~$32–44).
- NEVER ALTER QUANTITIES: ordered_qty must be EXACTLY the number written in the order. If the basis is genuinely unclear, use CARTONS and add a flag "basis assumed cartons — confirm". If a unit qty does not divide evenly by 4, add a flag like "5 bags ≈ 1.25 cartons — confirm".

ADDRESSES: capture bill_to (who PAYS — e.g. head office, "Bill To") and ship_to (the FULL delivery address — "Deliver To"/"Ship To", the specific store). customer_name = the SPECIFIC store we ship to (e.g. "Nutrition Warehouse Darwin"), NOT the HQ. If bill-to ≠ ship-to, note it.

Also capture the customer's PO NUMBER (e.g. "PO347986", "398022", "401135", "PO #PO347986") as po_number — this is how we avoid processing the same order twice.
CONTACT EMAIL: many POs arrive via an ordering system (Supply'd, an "orderingsystem@"/relay/no-reply sender) — replies must NOT go to those. Capture contact_email = the stockist's REAL email stated in the PO itself: an "Email:" field, an "if I can be of any assistance contact me" line, or a person's signature email (e.g. orders@wholefoodmerchants.com, administration@tonyandmarks.com.au). Prefer the store/orders address over a generic HQ one. null if none shown.
Reply ONLY with JSON: {"po_number":"the PO number or null","customer_name":"specific store or null","bill_to":"payer or null","ship_to":"full delivery address or null","contact_email":"stockist's real email or null","lines":[{"sku":"BMS","flavour":"Buttermilk","ordered_qty":4,"qty_basis":"units","cartons":1,"flag":null}],"unmatched":[],"flags":["any order-level warning"]}`;

function parseJson(out: string): ParsedPO {
  const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  const flags: string[] = [...(json.flags ?? [])];
  // DETERMINISTIC ARITHMETIC — never trust the model's division. cartons is always recomputed
  // from ordered_qty + qty_basis in code; a silent ÷4 (the "x8 became ×2" bug) cannot happen.
  const lines = (json.lines ?? []).map((l: any) => {
    const orderedQty = l.ordered_qty != null ? Math.max(0, Math.round(Number(l.ordered_qty) || 0)) : null;
    const basis = l.qty_basis === 'units' ? 'units' : 'cartons';
    let cartons = Math.max(0, Math.round(Number(l.cartons) || 0));
    if (orderedQty != null && orderedQty > 0) {
      if (basis === 'units') {
        const exact = orderedQty / 4;
        cartons = Math.max(1, Math.round(exact));
        if (orderedQty % 4 !== 0) flags.push(`⚠️ ${l.flavour}: ${orderedQty} bags ≈ ${exact} cartons — confirm`);
      } else if (cartons !== orderedQty) {
        flags.push(`⚠️ ${l.flavour}: corrected cartons ${cartons}→${orderedQty} to match the ordered quantity`);
        cartons = orderedQty;
      }
    }
    return { sku: l.sku, flavour: l.flavour, cartons, ordered_qty: orderedQty, qty_basis: basis, flag: l.flag ?? null };
  });
  const lineFlags = lines.filter((l: any) => l.flag).map((l: any) => l.flag as string);
  return {
    po_number: json.po_number ?? null,
    customer_name: json.customer_name ?? null, bill_to: json.bill_to ?? null, ship_to: json.ship_to ?? null,
    contact_email: json.contact_email ?? null,
    lines, unmatched: json.unmatched ?? [], flags: [...flags, ...lineFlags],
  };
}

// SOURCE-TEXT VERIFICATION for plain-email orders (the hallucination-prone case): every parsed
// quantity must literally appear as a number in the email. A miss → flag + needs_review, so it
// can never silently process. (Skipped when the order came via PDF — qty lives in the PDF.)
function verifyQuantitiesAgainstText(text: string, parsed: ParsedPO): void {
  if (!text || text.trim().length < 20) return;
  const numbersInText = new Set((text.match(/\d+/g) || []).map((n) => String(Number(n))));
  for (const l of parsed.lines) {
    const q = l.ordered_qty;
    if (q != null && q > 0 && !numbersInText.has(String(q))) {
      parsed.flags.push(`🛑 ${l.flavour}: parsed quantity ${q} does NOT appear in the email — verify against the original before processing`);
    }
  }
}

export async function parseWholesalePO(text: string): Promise<ParsedPO> {
  return parseWholesalePOMulti({ text });
}

// Robust parse from any mix of email body text + CSV text + PDF attachments.
export async function parseWholesalePOMulti(src: { text?: string; pdfs?: { filename: string; base64: string }[] }): Promise<ParsedPO> {
  const skus = await wholesaleSkus();
  const skuList = skus.map((s) => `${s.sku} = ${s.flavour} 320g`).join('; ');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const content: any[] = [];
  for (const p of (src.pdfs ?? []).slice(0, 4)) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.base64 } });
  }
  content.push({ type: 'text', text: `Extract the wholesale PO from the following (body text / CSV / and any attached PDFs). Remember it's ONE order across all sources.\n\n${(src.text || '(see attached PDF)').slice(0, 8000)}` });
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 1000,
    system: PARSE_SYSTEM(skuList),
    messages: [{ role: 'user', content }],
  });
  const out = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  const parsed = parseJson(out);
  if (!src.pdfs?.length) verifyQuantitiesAgainstText(src.text || '', parsed);
  return parsed;
}

const planBoxes = planWholesaleBoxes;

// Normalise a business name for matching (drop Pty/Ltd/punctuation/branch noise).
function normName(s: string): string {
  return (s || '').toLowerCase()
    .replace(/\b(pty|ltd|inc|co|the|p\/l|llc|group)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Match a PO's customer/branch name to an existing Xero/wholesale customer, even when
// names differ (PO says "Wholefood Merchants - Ferntree Gully", Xero has "Wholefood
// Merchants Rebecca Wheatley"). Substring either way, else ≥2 shared significant words.
async function findWholesaleCustomer(name: string | null): Promise<{ id: string; name: string } | null> {
  if (!name) return null;
  const target = normName(name);
  if (!target) return null;
  const { data } = await supabaseLogistics.from('wholesale_customers').select('id, name').eq('is_wholesale', true);
  const tTok = target.split(' ').filter((w) => w.length > 2);
  let best: any = null, score = 0;
  for (const c of (data ?? []) as any[]) {
    const cn = normName(c.name);
    if (!cn) continue;
    if (cn === target || cn.includes(target) || target.includes(cn)) return { id: c.id, name: c.name };
    const ov = cn.split(' ').filter((w) => w.length > 2 && tTok.includes(w)).length;
    if (ov > score) { score = ov; best = c; }
  }
  return score >= 2 ? { id: best.id, name: best.name } : null;
}

export async function assessPO(parsed: ParsedPO): Promise<POAssessment> {
  // available cartons at Altona for each ordered SKU — snapshot first, then LIVE ShipBob
  // overlay for the SKUs on this PO. The snapshot refreshes once a day (5am Melb), so a
  // morning restock read as "still out of stock" for the rest of the day without this.
  const { data: stock } = await supabaseLogistics.from('v_stock_current')
    .select('sku, available').eq('location_code', 'ALTONA').eq('active', true);
  const availBySku = new Map((stock ?? []).map((r: any) => [r.sku, r.available || 0]));
  try {
    const { liveAvailable } = await import('./marketing');
    await Promise.all(parsed.lines.map(async (l) => {
      const live = await liveAvailable('ALTONA', l.sku);
      if (live != null) availBySku.set(l.sku, live);
    }));
  } catch { /* live overlay best-effort — snapshot values stand */ }

  const lines: AssessedLine[] = parsed.lines.map((l) => {
    const available = Number(availBySku.get(l.sku) ?? 0);
    return { ...l, available, ok: available >= l.cartons };
  });
  const oos = lines.filter((l) => !l.ok).map((l) => ({ sku: l.sku, flavour: l.flavour, cartons: l.cartons, available: l.available }));
  const total = lines.reduce((s, l) => s + l.cartons, 0);
  const fulfillable = oos.length === 0 && lines.length > 0;
  const freight = freightRule(parsed.customer_name, total);
  const free_shipping = freight.free;
  const over = total > B2C_MAX_CARTONS;

  // Is this customer already on file in Xero/wholesale? (fuzzy match the store name)
  const matched = await findWholesaleCustomer(parsed.customer_name).catch(() => null);
  const customer_on_file = !!matched;

  // DEDUP: has this PO already been invoiced (Xero) or ordered (our log)?
  let already_processed = false;
  let existing: POAssessment['existing'] = null;
  if (parsed.po_number) {
    try {
      const [{ data: logRow }, inv] = await Promise.all([
        supabaseLogistics.from('wholesale_po_log').select('shipbob_order_id, xero_invoice_id, status, created_at').eq('po_number', parsed.po_number).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        findInvoiceByReference(parsed.po_number),   // self-catches → null on error
      ]);
      const lr = logRow as any;
      if (inv || lr?.shipbob_order_id || lr?.xero_invoice_id) {
        already_processed = true;
        existing = { xero_invoice: inv?.number || lr?.xero_invoice_id || null, shipbob_order_id: lr?.shipbob_order_id || null, when: lr?.created_at || null };
      }
    } catch { /* dedup is best-effort */ }
  }

  const flags = [...(parsed.flags || [])];
  // The customer's LAST ShipBob delivery is the SHIPPING source of truth — Xero contact
  // profiles are billing data and regularly lack/mangle the delivery details ("Support Your
  // Gym" ships to Alex Houldsworth). Fetched for EVERY known customer so the agent can default
  // to it whenever the PO itself doesn't state a full ship-to.
  let previous_recipient: POAssessment['previous_recipient'] = null;
  if (matched) {
    try {
      const { findLastShipBobRecipient } = await import('./wholesaleActions');
      previous_recipient = await findLastShipBobRecipient(matched.name);
    } catch { /* best-effort */ }
  }
  if (!parsed.ship_to && previous_recipient) {
    const prev = previous_recipient;
    flags.push(`📦 No ship-to on this PO — last ShipBob delivery for ${matched!.name} went to: ${[prev.name, prev.address1, prev.address2, prev.city, prev.state, prev.zip_code].filter(Boolean).join(', ')}${prev.email ? ` (${prev.email})` : ''} [order #${prev.from_order}]. Confirm with Kate, then use these details as the recipient.`);
  }
  if (already_processed) flags.push(`🛑 ALREADY PROCESSED — PO ${parsed.po_number} already has${existing?.xero_invoice ? ` Xero invoice ${existing.xero_invoice}` : ''}${existing?.shipbob_order_id ? ` / ShipBob order #${existing.shipbob_order_id}` : ''}. Do NOT create another — confirm with the user first.`);
  if (!customer_on_file) flags.push(`🆕 "${parsed.customer_name || 'this customer'}" isn't on file in Xero — needs adding (capture name, ship-to address, email, ABN). Check carefully.`);
  else if (matched && normName(matched.name) !== normName(parsed.customer_name || '')) flags.push(`ℹ️ Matched to existing Xero contact "${matched.name}".`);
  if (over) flags.push('⚠️ >24 cartons — B2B/courier order, not the standard B2C flow.');
  if (oos.length) flags.push(`⚠️ Short on: ${oos.map((o) => `${o.flavour} (need ${o.cartons}, have ${o.available})`).join('; ')}`);
  const needs_review = already_processed || !customer_on_file || (parsed.flags || []).length > 0 || lines.some((l) => l.flag);

  const cust = parsed.customer_name ? ` for *${parsed.customer_name}*` : '';
  const lineStr = lines.map((l) => `• ${l.flavour} (${l.sku}) ×${l.cartons} carton${l.cartons === 1 ? '' : 's'}${l.qty_basis === 'units' ? ` (ordered ${l.ordered_qty} units)` : ''}${l.ok ? '' : ` ⚠️ only ${l.available} in stock`}`).join('\n');
  const ship = `${free_shipping ? 'FREE shipping' : '$15 freight'} (${freight.reason})`;
  const boxStr = fulfillable ? planBoxes(total).join(' + ') : '—';
  const addr = [parsed.ship_to ? `Ship to: ${parsed.ship_to}` : '', parsed.bill_to && parsed.bill_to !== parsed.customer_name ? `Bill to: ${parsed.bill_to}` : ''].filter(Boolean).join('\n');
  const summary = `Wholesale PO${cust}:\n${lineStr}\n\n${total} cartons · ${ship}\nBox: ${boxStr}${addr ? `\n${addr}` : ''}${flags.length ? `\n\n${flags.join('\n')}` : ''}${needs_review ? '\n\n⚠️ NEEDS KATE TO REVIEW before processing.' : ''}`;

  return {
    po_number: parsed.po_number, already_processed, existing,
    customer_name: parsed.customer_name, bill_to: parsed.bill_to, ship_to: parsed.ship_to,
    contact_email: parsed.contact_email ?? null, previous_recipient,
    customer_on_file, needs_review, flags,
    lines, total_cartons: total, fulfillable, oos, boxes: fulfillable ? planBoxes(total) : [],
    free_shipping, over_b2c_limit: over, summary,
  };
}

// GF/Gluten Free is a DISTINCT product. "Buttermilk" = regular only (never GF Buttermilk);
// the GF variant is only meant when "GF"/"Gluten Free" is stated. Match must agree on GF-ness.
const isGF = (s: string) => /\bgf\b|gluten\s*free/i.test(s || '');
const coreFlavour = (s: string) => (s || '').toLowerCase().replace(/gluten\s*free/g, ' ').replace(/\bgf\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function flavourTermMatches(line: { flavour?: string; sku?: string }, term: string): boolean {
  if (line.sku && line.sku.toLowerCase() === term.toLowerCase().trim()) return true;
  const lc = coreFlavour(line.flavour || ''); const tc = coreFlavour(term);
  if (!tc) return false;
  const sameFlavour = lc === tc || lc.includes(tc) || tc.includes(lc);
  return sameFlavour && isGF(line.flavour || '') === isGF(term);   // regular ≠ GF
}

function applyExclusions(parsed: ParsedPO, exclude?: string[]): ParsedPO {
  if (!exclude?.length) return parsed;
  const terms = exclude.map((e) => e.trim()).filter(Boolean);
  parsed.lines = parsed.lines.filter((l) => !terms.some((t) => flavourTermMatches(l, t)));
  return parsed;
}

export async function processWholesalePO(text: string, exclude?: string[]): Promise<POAssessment> {
  return assessPO(applyExclusions(await parseWholesalePO(text), exclude));
}

// Parse + assess from a full email (body text + CSV text + PDF attachments), honouring
// any "leave off X flavour" exclusions.
export async function processWholesalePOMulti(src: { text?: string; pdfs?: { filename: string; base64: string }[] }, exclude?: string[]): Promise<POAssessment> {
  return assessPO(applyExclusions(await parseWholesalePOMulti(src), exclude));
}

// OOS reply (Kate's voice) when we can't fully fulfil an order.
export function oosReplyBody(assessment: POAssessment): string {
  const flavours = assessment.oos.map((o) => o.flavour).join(', ');
  return `Hi there,\n\nThanks for your order! So sorry we're actually OOS ${flavours} at the moment. Would you like me to swap that to another flavour for you for now?\n\nThanks,\nKate`;
}
