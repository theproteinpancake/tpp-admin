// Claude agent that answers logistics questions + drafts POs (used by WhatsApp).
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';
import { computeStatus, STATUS_META, PRIMARY_FLAVOURS } from './stock';
import { OPEN_STATUSES } from './po-types';
import { getReorderRecommendations } from './reorder';
import { draftWhatsAppPO, approveLatestWhatsAppDraft } from './poActions';
import { findLatestDocket, parseDocket, createWROFromParsed, draftSharonReply } from './wroFlow';
import { gmailSendDraft } from './google';
import { getLots, expiryStatus, EXPIRY_META } from './lots';

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
  {
    name: 'get_expiring_stock',
    description: 'Batch/lot best-before data — stock with the soonest expiry per site (lot number, best-before date, days left, units, status). Use for "what expires soonest / shortest-dated / batch best-befores / expiry".',
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
    description: 'Draft (NOT send) a reply to Sharon with the WRO labels. Use her email + docket ref from check_docket and the WRO id from create_wro.',
    input_schema: { type: 'object', properties: { to: { type: 'string' }, docket_ref: { type: 'string' }, wro_id: { type: 'number' } }, required: ['to', 'wro_id'] },
  },
  {
    name: 'send_email_draft',
    description: 'Send a Gmail draft. ONLY when the user explicitly approves sending (e.g. "send it to Sharon").',
    input_schema: { type: 'object', properties: { draft_id: { type: 'string' } }, required: ['draft_id'] },
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
  if (name === 'get_expiring_stock') {
    let lots = await getLots();
    if (input.site) lots = lots.filter((l) => l.site === input.site);
    return lots.slice(0, 20).map((l) => ({
      flavour: l.flavour, size: l.unit_size_g && l.unit_size_g >= 1000 ? `${l.unit_size_g / 1000}kg` : `${l.unit_size_g}g`,
      site: l.site, lot: l.lot_number, best_before: l.expiry_date, days_left: l.days_left,
      on_hand: l.on_hand, status: EXPIRY_META[expiryStatus(l.days_left)].label,
    }));
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
      const draftId = await draftSharonReply(String(input.to), (input.docket_ref as string) || null, Number(input.wro_id));
      return { draft_id: draftId };
    } catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  if (name === 'send_email_draft') {
    try { await gmailSendDraft(String(input.draft_id)); return { sent: true }; }
    catch (e) { return { error: String(e).slice(0, 160) }; }
  }
  return { error: 'unknown tool' };
}

const SYSTEM = `You are the operations assistant for The Protein Pancake (TPP), messaging the founder on WhatsApp.
Live data + actions via tools. Sites: Altona (AU), Manchester (UK). Primary SKUs: ${PRIMARY_FLAVOURS.join(', ')}.
"Days of cover" = available ÷ daily sales. "Inbound" = units on open POs.
You DO have batch/best-before data — use get_expiring_stock for expiry / shortest-dated / lot questions.

Capabilities:
- Answer stock/velocity/PO questions (get_stock, get_purchase_orders).
- Recommend what to order (get_reorder_recommendations).
- Draft a purchase order (draft_po) — this creates a DRAFT only and attaches a screenshot image; then tell the user to reply "SEND" to approve.
- Approve & push to Xero (approve_po) — ONLY when the user has explicitly said to send/approve. Never approve on your own.

Receiving (WRO) flow — when the user says a packing slip / docket arrived from Sharon/ABC:
1. check_docket → parse_docket. 2. Show the parsed lines with LOT NUMBERS and BEST-BEFORE dates clearly, and ask the user to confirm the best-befores (this is critical — expirable stock). 3. Only after they confirm, create_wro. 4. Then offer to reply to Sharon: draft_sharon_reply, show it, and only send_email_draft when they say send. Never create a WRO or send email without explicit confirmation.

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
