// Wholesale PO intake: parse a free-text/email PO into SKU + carton lines (handles
// "4 cartons of buttermilk", bare SKUs like "BMS x4", mixed formats), check Altona
// stock can fulfil it, pick the ShipBob box, and apply the free-shipping rule.
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';

const MODEL = 'claude-sonnet-4-6';

// ShipBob B2C box rules (320g cartons): ≤24 cartons go as a Customer order.
// 2 cartons → PANXLARGE; ≤4 → PANOUTERSMALL; ≤8 → PANOUTER; larger = multiple boxes.
const PANOUTER_CAP = 8, PANOUTERSMALL_CAP = 4;
export const B2C_MAX_CARTONS = 24;

export interface POLine { sku: string; flavour: string; cartons: number; }
export interface ParsedPO { customer_name: string | null; lines: POLine[]; unmatched: string[]; }

export interface AssessedLine extends POLine { available: number; ok: boolean; }
export interface POAssessment {
  customer_name: string | null;
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

const PARSE_SYSTEM = (skuList: string) => `You parse a wholesale purchase order for The Protein Pancake into structured lines.
Our wholesale 320g SKUs: ${skuList}.
Customers order in CARTONS (each carton = 4× 320g bags; "box" = carton). POs arrive in MANY formats — plain email text, an HTML table, a CSV, and/or a PDF attachment — sometimes SEVERAL at once for the SAME order. If multiple sources are given, they describe ONE order: extract it ONCE, de-duplicate, and prefer the most complete/structured source — NEVER sum the same line across formats.
Map each flavour → the matching 320g SKU: "buttermilk"=BMS, "gluten free buttermilk"/"GF buttermilk"=GFBS, "cinnamon churro"/"churro"=CIS, "maple"=MAS, "cookies & cream"=CCS, "chocolate"=CHS, "salted caramel"=SCS, "GF cinnamon churro"=GFCIS, "sugar free maple syrup"/"maple syrup"=MSS, and any other listed flavour by name + size. Supplier SKUs/codes (e.g. TPPBP01, TPPMP01, TPPCC01) map by the product name shown. Quantities are cartons unless clearly bags. Ignore freight/shipping/discount/total lines. Capture the customer/store name.
Reply ONLY with JSON: {"customer_name":"store or null","lines":[{"sku":"BMS","flavour":"Buttermilk","cartons":4}],"unmatched":["lines you couldn't map"]}`;

function parseJson(out: string): ParsedPO {
  const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  return { customer_name: json.customer_name ?? null, lines: json.lines ?? [], unmatched: json.unmatched ?? [] };
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
  const free_shipping = total > 4;
  const over = total > B2C_MAX_CARTONS;

  const cust = parsed.customer_name ? ` for *${parsed.customer_name}*` : '';
  const lineStr = lines.map((l) => `• ${l.flavour} (${l.sku}) ×${l.cartons}${l.ok ? '' : ` ⚠️ only ${l.available} in stock`}`).join('\n');
  const ship = free_shipping ? 'FREE shipping (>4 cartons)' : 'add $15 freight (≤4 cartons)';
  const boxStr = fulfillable ? planBoxes(total).join(' + ') : '—';
  const flags = [
    over ? '⚠️ >24 cartons — this is a B2B/courier order, not the standard B2C flow.' : '',
    oos.length ? `⚠️ Short on: ${oos.map((o) => `${o.flavour} (need ${o.cartons}, have ${o.available})`).join('; ')}` : '',
  ].filter(Boolean).join('\n');
  const summary = `Wholesale PO${cust}:\n${lineStr}\n\n${total} cartons · ${ship}\nBox: ${boxStr}${flags ? `\n\n${flags}` : ''}`;

  return { customer_name: parsed.customer_name, lines, total_cartons: total, fulfillable, oos, boxes: fulfillable ? planBoxes(total) : [], free_shipping, over_b2c_limit: over, summary };
}

function applyExclusions(parsed: ParsedPO, exclude?: string[]): ParsedPO {
  if (!exclude?.length) return parsed;
  const ex = exclude.map((e) => e.toLowerCase().trim()).filter(Boolean);
  parsed.lines = parsed.lines.filter((l) => !ex.some((x) => (l.flavour || '').toLowerCase().includes(x) || (l.sku || '').toLowerCase() === x));
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
