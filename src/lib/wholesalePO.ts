// Wholesale PO intake: parse a free-text/email PO into SKU + carton lines (handles
// "4 cartons of buttermilk", bare SKUs like "BMS x4", mixed formats), check Altona
// stock can fulfil it, pick the ShipBob box, and apply the free-shipping rule.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { findInvoiceByReference } from './xero';

const MODEL = 'claude-sonnet-4-6';

// ShipBob B2C box rules (320g cartons): ≤24 cartons go as a Customer order.
// 2 cartons → PANXLARGE; ≤4 → PANOUTERSMALL; ≤8 → PANOUTER; larger = multiple boxes.
const PANOUTER_CAP = 8, PANOUTERSMALL_CAP = 4;
export const B2C_MAX_CARTONS = 24;

export interface POLine { sku: string; flavour: string; cartons: number; ordered_qty?: number; qty_basis?: string; flag?: string | null; }
export interface ParsedPO {
  po_number: string | null;         // customer PO number (dedup key)
  customer_name: string | null;     // who we ship to / the Xero contact (the specific store)
  bill_to: string | null;           // who pays (e.g. HQ) — may differ from ship-to
  ship_to: string | null;           // full delivery address (the specific store)
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

CARTONS vs UNITS (CRITICAL): some stores (e.g. Nutrition Warehouse) order in individual BAGS/UNITS, not cartons — e.g. qty "4" on a single-320g-bag line = 4 bags = 1 carton. Decide each line's basis:
- CARTON basis if the description says "carton"/"x4 per carton"/"box", OR the unit/line price looks per-carton (~$32–44).
- UNIT (bag) basis if the line is a single 320g bag with a per-bag price (~$7–12). Then cartons = qty ÷ 4.
- Set ordered_qty (as written), qty_basis ("cartons" or "units"), and cartons (final carton count). If a unit qty does NOT divide evenly by 4, round to nearest carton and add a flag like "NW Darwin: 5 bags ≈ 1.25 cartons — confirm".

ADDRESSES: capture bill_to (who PAYS — e.g. head office, "Bill To") and ship_to (the FULL delivery address — "Deliver To"/"Ship To", the specific store). customer_name = the SPECIFIC store we ship to (e.g. "Nutrition Warehouse Darwin"), NOT the HQ. If bill-to ≠ ship-to, note it.

Also capture the customer's PO NUMBER (e.g. "PO347986", "398022", "401135", "PO #PO347986") as po_number — this is how we avoid processing the same order twice.
Reply ONLY with JSON: {"po_number":"the PO number or null","customer_name":"specific store or null","bill_to":"payer or null","ship_to":"full delivery address or null","lines":[{"sku":"BMS","flavour":"Buttermilk","ordered_qty":4,"qty_basis":"units","cartons":1,"flag":null}],"unmatched":[],"flags":["any order-level warning"]}`;

function parseJson(out: string): ParsedPO {
  const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  const lines = (json.lines ?? []).map((l: any) => ({
    sku: l.sku, flavour: l.flavour, cartons: Math.max(0, Math.round(Number(l.cartons) || 0)),
    ordered_qty: l.ordered_qty ?? null, qty_basis: l.qty_basis ?? null, flag: l.flag ?? null,
  }));
  const lineFlags = lines.filter((l: any) => l.flag).map((l: any) => l.flag as string);
  return {
    po_number: json.po_number ?? null,
    customer_name: json.customer_name ?? null, bill_to: json.bill_to ?? null, ship_to: json.ship_to ?? null,
    lines, unmatched: json.unmatched ?? [], flags: [...(json.flags ?? []), ...lineFlags],
  };
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
  return parseJson(out);
}

// Box plan for N cartons of 320g (Altona). Packs into 8s, then a right-sized last box.
function planBoxes(total: number): string[] {
  if (total <= 0) return [];
  if (total === 2) return ['PANXLARGE'];
  if (total <= PANOUTERSMALL_CAP) return ['PANOUTERSMALL'];
  if (total <= PANOUTER_CAP) return ['PANOUTER'];
  const boxes: string[] = [];
  let rem = total;
  while (rem > PANOUTER_CAP) { boxes.push('PANOUTER'); rem -= PANOUTER_CAP; }
  if (rem === 2) boxes.push('PANXLARGE');
  else if (rem <= PANOUTERSMALL_CAP) boxes.push('PANOUTERSMALL');
  else if (rem > 0) boxes.push('PANOUTER');
  return boxes;
}

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
  // available cartons at Altona for each ordered SKU
  const { data: stock } = await supabaseLogistics.from('v_stock_current')
    .select('sku, available').eq('location_code', 'ALTONA').eq('active', true);
  const availBySku = new Map((stock ?? []).map((r: any) => [r.sku, r.available || 0]));

  const lines: AssessedLine[] = parsed.lines.map((l) => {
    const available = Number(availBySku.get(l.sku) ?? 0);
    return { ...l, available, ok: available >= l.cartons };
  });
  const oos = lines.filter((l) => !l.ok).map((l) => ({ sku: l.sku, flavour: l.flavour, cartons: l.cartons, available: l.available }));
  const total = lines.reduce((s, l) => s + l.cartons, 0);
  const fulfillable = oos.length === 0 && lines.length > 0;
  const free_shipping = total >= 4;        // 4+ cartons free; 1–3 → $15 freight
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
  if (already_processed) flags.push(`🛑 ALREADY PROCESSED — PO ${parsed.po_number} already has${existing?.xero_invoice ? ` Xero invoice ${existing.xero_invoice}` : ''}${existing?.shipbob_order_id ? ` / ShipBob order #${existing.shipbob_order_id}` : ''}. Do NOT create another — confirm with the user first.`);
  if (!customer_on_file) flags.push(`🆕 "${parsed.customer_name || 'this customer'}" isn't on file in Xero — needs adding (capture name, ship-to address, email, ABN). Check carefully.`);
  else if (matched && normName(matched.name) !== normName(parsed.customer_name || '')) flags.push(`ℹ️ Matched to existing Xero contact "${matched.name}".`);
  if (over) flags.push('⚠️ >24 cartons — B2B/courier order, not the standard B2C flow.');
  if (oos.length) flags.push(`⚠️ Short on: ${oos.map((o) => `${o.flavour} (need ${o.cartons}, have ${o.available})`).join('; ')}`);
  const needs_review = already_processed || !customer_on_file || (parsed.flags || []).length > 0 || lines.some((l) => l.flag);

  const cust = parsed.customer_name ? ` for *${parsed.customer_name}*` : '';
  const lineStr = lines.map((l) => `• ${l.flavour} (${l.sku}) ×${l.cartons} carton${l.cartons === 1 ? '' : 's'}${l.qty_basis === 'units' ? ` (ordered ${l.ordered_qty} units)` : ''}${l.ok ? '' : ` ⚠️ only ${l.available} in stock`}`).join('\n');
  const ship = free_shipping ? 'FREE shipping (4+ cartons)' : 'add $15 freight (≤3 cartons)';
  const boxStr = fulfillable ? planBoxes(total).join(' + ') : '—';
  const addr = [parsed.ship_to ? `Ship to: ${parsed.ship_to}` : '', parsed.bill_to && parsed.bill_to !== parsed.customer_name ? `Bill to: ${parsed.bill_to}` : ''].filter(Boolean).join('\n');
  const summary = `Wholesale PO${cust}:\n${lineStr}\n\n${total} cartons · ${ship}\nBox: ${boxStr}${addr ? `\n${addr}` : ''}${flags.length ? `\n\n${flags.join('\n')}` : ''}${needs_review ? '\n\n⚠️ NEEDS KATE TO REVIEW before processing.' : ''}`;

  return {
    po_number: parsed.po_number, already_processed, existing,
    customer_name: parsed.customer_name, bill_to: parsed.bill_to, ship_to: parsed.ship_to,
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
