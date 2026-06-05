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

export async function parseWholesalePO(text: string): Promise<ParsedPO> {
  const skus = await wholesaleSkus();
  const skuList = skus.map((s) => `${s.sku} = ${s.flavour} 320g`).join('; ');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: MODEL, max_tokens: 800,
    system: `You parse a wholesale purchase order (free text or forwarded email) for The Protein Pancake into structured lines.
Our wholesale 320g SKUs: ${skuList}.
Customers order in CARTONS (each carton = 4× 320g bags). They may write a SKU ("BMS x4", "4x CIS"), or describe it ("4 cartons of buttermilk", "two boxes of cinnamon churro", "3 maple"). Map flavour → the matching 320g SKU. "buttermilk" = BMS, "gluten free buttermilk"/"GF buttermilk" = GFBS, "cinnamon churro"/"churro" = CIS, "maple" = MAS, and any other listed flavours by name. A bare number with a flavour = cartons. Capture the customer/store name if present.
Reply ONLY with JSON: {"customer_name": "store name or null", "lines": [{"sku":"BMS","flavour":"Buttermilk","cartons":4}], "unmatched": ["any line you could not map"]}`,
    messages: [{ role: 'user', content: `Parse this wholesale PO:\n\n${text.slice(0, 4000)}` }],
  });
  const out = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  return { customer_name: json.customer_name ?? null, lines: json.lines ?? [], unmatched: json.unmatched ?? [] };
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

export async function processWholesalePO(text: string): Promise<POAssessment> {
  return assessPO(await parseWholesalePO(text));
}

// OOS reply (Kate's voice) when we can't fully fulfil an order.
export function oosReplyBody(assessment: POAssessment): string {
  const flavours = assessment.oos.map((o) => o.flavour).join(', ');
  return `Hi there,\n\nThanks for your order! So sorry we're actually OOS ${flavours} at the moment. Would you like me to swap that to another flavour for you for now?\n\nThanks,\nKate`;
}
