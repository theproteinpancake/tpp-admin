// Claude agent that answers logistics questions + drafts POs (used by WhatsApp).
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { computeStatus, STATUS_META, PRIMARY_FLAVOURS } from './stock';
import { OPEN_STATUSES } from './po-types';
import { getReorderRecommendations } from './reorder';
import { draftWhatsAppPO, approveLatestWhatsAppDraft } from './poActions';

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
    name: 'get_reorder_recommendations',
    description: 'What to order next and how many units, per site — based on velocity, lead time, target cover, current stock and inbound POs. Use this to answer "what should we order".',
    input_schema: { type: 'object', properties: { site: { type: 'string', enum: ['ALTONA', 'MANCHESTER'] } } },
  },
  {
    name: 'draft_po',
    description: 'Create a DRAFT purchase order for ABC Blending → Altona (not yet sent). Returns a screenshot image of the PO for the user to approve. If no items given, uses the current reorder recommendations. A screenshot is automatically attached to your reply.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'optional explicit lines; omit to use recommendations',
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
];

let _media: string | null = null; // screenshot URL set by draft_po within a single run

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
      .select(`status, expected_date, total_cost, currency, supplier:supplier_id(name), items:po_items(qty_ordered,qty_received,product:product_id(sku))`)
      .order('created_at', { ascending: false });
    let pos = (data ?? []) as any[];
    if (input.open_only) pos = pos.filter((p) => OPEN_STATUSES.includes(p.status));
    return pos.map((p) => ({
      supplier: p.supplier?.name, status: p.status, expected: p.expected_date, value: p.total_cost,
      items: (p.items ?? []).map((i: any) => ({ sku: i.product?.sku, ordered: i.qty_ordered, received: i.qty_received })),
    }));
  }
  if (name === 'get_reorder_recommendations') {
    const recs = await getReorderRecommendations((input.site as string) || 'ALTONA');
    return recs.map((r) => ({
      product_id: r.product_id, flavour: r.flavour, size: r.size, recommend_units: r.recommend_units,
      cartons: r.cartons, available: r.available, inbound: r.inbound, days_of_cover: r.days_of_cover,
      daily_sales: r.daily, reason: r.reason,
    }));
  }
  if (name === 'draft_po') {
    const items = (input.items as any[] | undefined)?.map((i) => ({ product_id: i.product_id, qty_ordered: i.qty_ordered, unit_cost: null }));
    const res = await draftWhatsAppPO(items);
    if ('error' in res) return res;
    _media = res.image_url;
    return { drafted: true, summary: res.summary, note: 'Screenshot attached. Tell the user to reply SEND to approve & push to Xero.' };
  }
  if (name === 'approve_po') {
    return await approveLatestWhatsAppDraft();
  }
  return { error: 'unknown tool' };
}

const SYSTEM = `You are the operations assistant for The Protein Pancake (TPP), messaging the founder on WhatsApp.
Live data + actions via tools. Sites: Altona (AU), Manchester (UK). Primary SKUs: ${PRIMARY_FLAVOURS.join(', ')}.
"Days of cover" = available ÷ daily sales. "Inbound" = units on open POs.

Capabilities:
- Answer stock/velocity/PO questions (get_stock, get_purchase_orders).
- Recommend what to order (get_reorder_recommendations).
- Draft a purchase order (draft_po) — this creates a DRAFT only and attaches a screenshot image; then tell the user to reply "SEND" to approve.
- Approve & push to Xero (approve_po) — ONLY when the user has explicitly said to send/approve. Never approve on your own.

Style: concise, WhatsApp-friendly, short lines, a few emojis (📦 ⚠️ ✅). Lead with the answer. Always use tools for numbers — never guess.
After drafting a PO, end with: "Reply SEND to approve and push to Xero." After approving, confirm the Xero PO number.`;

export async function askStockAgent(question: string): Promise<{ text: string; media?: string }> {
  _media = null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { text: 'Assistant is not configured (missing API key).' };
  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];

  for (let i = 0; i < 6; i++) {
    const resp = await client.messages.create({ model: MODEL, max_tokens: 1024, system: SYSTEM, tools, messages });
    if (resp.stop_reason === 'tool_use') {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') {
          const out = await runTool(block.name, block.input as Record<string, unknown>);
          results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out).slice(0, 7000) });
        }
      }
      messages.push({ role: 'assistant', content: resp.content });
      messages.push({ role: 'user', content: results });
      continue;
    }
    const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    return { text: text || 'Done.', media: _media || undefined };
  }
  return { text: 'That took too many steps — try narrowing the request.', media: _media || undefined };
}
