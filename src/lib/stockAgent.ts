// Claude agent that answers logistics questions from live data (used by WhatsApp).
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { computeStatus, STATUS_META, PRIMARY_FLAVOURS } from './stock';
import { OPEN_STATUSES } from './po-types';

const MODEL = 'claude-sonnet-4-6';

const tools: Anthropic.Tool[] = [
  {
    name: 'get_stock',
    description: 'Live stock per SKU per site: on hand, available, days of cover, inbound (pending PO units), sales velocity and a status (healthy / reorder soon / reorder now / out of stock / inbound / no velocity). Use filters to narrow.',
    input_schema: {
      type: 'object',
      properties: {
        site: { type: 'string', enum: ['ALTONA', 'MANCHESTER'], description: 'Altona=AU, Manchester=UK' },
        tier: { type: 'string', enum: ['primary', 'secondary'] },
        search: { type: 'string', description: 'flavour or SKU substring, e.g. "buttermilk"' },
        needs_attention: { type: 'boolean', description: 'only items out of stock or with < 21 days cover (and not covered by inbound)' },
      },
    },
  },
  {
    name: 'get_purchase_orders',
    description: 'Purchase orders with supplier, destination, status, expected date and outstanding (inbound) units.',
    input_schema: {
      type: 'object',
      properties: { open_only: { type: 'boolean', description: 'only open/inbound POs' } },
    },
  },
];

async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  if (name === 'get_stock') {
    let q = supabaseLogistics.from('v_stock_current')
      .select('sku,flavour,size_code,unit_size_g,tier,location_code,on_hand,available,inbound,days_of_cover,avg_daily_units_30d,trend')
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
      tier: r.tier, site: r.location_code, on_hand: r.on_hand, available: r.available,
      inbound: r.inbound, days_of_cover: r.days_of_cover, daily_sales: r.avg_daily_units_30d, trend: r.trend,
      status: STATUS_META[computeStatus(r)].label,
    }));
    if (input.needs_attention) {
      out = out.filter((r) => r.status === 'Out of stock' || r.status === 'Reorder now' || r.status === 'Reorder soon');
    }
    return out;
  }
  if (name === 'get_purchase_orders') {
    const { data } = await supabaseLogistics.from('purchase_orders')
      .select(`status, expected_date, total_cost, currency, supplier:supplier_id(name), destination:destination_location_id(code), items:po_items(qty_ordered,qty_received,product:product_id(sku))`)
      .order('created_at', { ascending: false });
    let pos = (data ?? []) as any[];
    if (input.open_only) pos = pos.filter((p) => OPEN_STATUSES.includes(p.status));
    return pos.map((p) => ({
      supplier: p.supplier?.name, destination: p.destination?.code, status: p.status,
      expected: p.expected_date, value: p.total_cost, currency: p.currency,
      items: (p.items ?? []).map((i: any) => ({ sku: i.product?.sku, ordered: i.qty_ordered, received: i.qty_received })),
    }));
  }
  return { error: 'unknown tool' };
}

const SYSTEM = `You are the operations assistant for The Protein Pancake (TPP), answering the founder over WhatsApp.
You have live data via tools. Two stock sites: Altona (AU) and Manchester (UK).
Primary SKUs (top priority, keep stocked): ${PRIMARY_FLAVOURS.join(', ')}. Everything else is secondary.
"Days of cover" = current available units ÷ recent daily sales. "Inbound" = units on open purchase orders heading to that site.

Style: concise, WhatsApp-friendly. Short lines, no markdown tables. A few emojis are fine (📦 ⚠️ ✅). Lead with the answer.
Always use the tools for numbers — never guess. If asked something you have no data for (e.g. pallet ETA, emails), say it's not wired up yet.`;

export async function askStockAgent(question: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 'Assistant is not configured (missing API key).';
  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];

  for (let i = 0; i < 5; i++) {
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
    return resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim()
      || 'Sorry, I had nothing to say.';
  }
  return 'That took too many steps — try narrowing the question.';
}
