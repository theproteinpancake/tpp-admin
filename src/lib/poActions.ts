// PO drafting/approval actions used by the WhatsApp agent.
import { supabaseLogistics } from './supabase-logistics';
import { getReorderRecommendations } from './reorder';
import { getConnection, createXeroPurchaseOrder } from './xero';

const APP_URL = process.env.PUBLIC_APP_URL || 'https://appadmin.theproteinpancake.co';

export interface DraftLine { product_id: string; qty_ordered: number; unit_cost: number | null }

// Create a DRAFT PO in our DB (not yet in Xero) for ABC → Altona.
export async function draftWhatsAppPO(lines?: DraftLine[]): Promise<{ id: string; image_url: string; summary: string } | { error: string }> {
  let items = lines;
  if (!items || items.length === 0) {
    const recs = await getReorderRecommendations('ALTONA');
    items = recs.map((r) => ({ product_id: r.product_id, qty_ordered: r.recommend_units, unit_cost: null }));
  }
  if (!items.length) return { error: 'Nothing needs reordering at Altona right now.' };

  // fill unit costs from product COGS where missing
  const { data: prods } = await supabaseLogistics.from('products')
    .select('id, sku, flavour, unit_size_g, cogs').in('id', items.map((i) => i.product_id));
  const byId = new Map((prods ?? []).map((p: any) => [p.id, p]));
  items = items.map((i) => ({ ...i, unit_cost: i.unit_cost ?? byId.get(i.product_id)?.cogs ?? null }));

  const { data: abc } = await supabaseLogistics.from('suppliers').select('id').eq('name', 'ABC Blending').single();
  const { data: altona } = await supabaseLogistics.from('locations').select('id').eq('code', 'ALTONA').single();
  const total = items.reduce((s, i) => s + i.qty_ordered * (i.unit_cost || 0), 0);

  const { data: po, error } = await supabaseLogistics.from('purchase_orders').insert({
    supplier_id: abc?.id, destination_location_id: altona?.id, status: 'draft',
    currency: 'AUD', order_date: new Date().toISOString().slice(0, 10),
    total_cost: total, source: 'whatsapp', reference: 'WhatsApp draft', notes: 'Drafted via WhatsApp assistant',
  }).select('id').single();
  if (error || !po) return { error: 'Could not create draft.' };
  await supabaseLogistics.from('po_items').insert(items.map((i) => ({ ...i, po_id: po.id, qty_received: 0 })));

  const lineSummary = items.map((i) => {
    const p = byId.get(i.product_id);
    const sz = p?.unit_size_g >= 1000 ? `${p.unit_size_g / 1000}kg` : `${p?.unit_size_g}g`;
    return `• ${p?.flavour ?? p?.sku} ${sz} ×${i.qty_ordered}`;
  }).join('\n');
  const summary = `Drafted PO for ABC Blending (→ Altona):\n${lineSummary}\nTotal: AUD ${total.toFixed(2)}`;
  return { id: po.id, image_url: `${APP_URL}/api/whatsapp/po-image/${po.id}`, summary };
}

// Approve the most recent WhatsApp draft → push to Xero as AUTHORISED.
export async function approveLatestWhatsAppDraft(): Promise<{ ok: true; xero_number: string } | { error: string }> {
  if (!(await getConnection())) return { error: 'Xero is not connected yet — connect it on the Purchase Orders page first.' };
  const { data: po } = await supabaseLogistics.from('purchase_orders')
    .select('id, reference, expected_date, items:po_items(qty_ordered, unit_cost, product:product_id(sku))')
    .eq('source', 'whatsapp').eq('status', 'draft')
    .order('created_at', { ascending: false }).limit(1).maybeSingle() as any;
  if (!po) return { error: 'No pending WhatsApp draft to approve.' };

  const lines = (po.items || [])
    .filter((i: any) => i.product?.sku)
    .map((i: any) => ({ ItemCode: i.product.sku, Quantity: i.qty_ordered, UnitAmount: i.unit_cost }));
  if (!lines.length) return { error: 'Draft has no valid line items.' };

  try {
    const xero = await createXeroPurchaseOrder({
      contactName: 'ABC Blending', lines, reference: 'TPP WhatsApp PO', status: 'AUTHORISED',
    });
    await supabaseLogistics.from('purchase_orders')
      .update({ status: 'placed', xero_po_id: xero.id, po_number: xero.number, xero_status: 'AUTHORISED', updated_at: new Date().toISOString() })
      .eq('id', po.id);
    return { ok: true, xero_number: xero.number };
  } catch (e) {
    return { error: `Xero push failed: ${String(e).slice(0, 120)}` };
  }
}
