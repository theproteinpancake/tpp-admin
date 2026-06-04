import { ImageResponse } from 'next/og';
import { supabaseLogistics } from '@/lib/supabase-logistics';

export const runtime = 'nodejs';

// Public PNG render of a PO, for sending as a WhatsApp "screenshot".
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { data: po } = await supabaseLogistics
    .from('purchase_orders')
    .select(`po_number, reference, currency, expected_date, total_cost, status,
      supplier:supplier_id(name), destination:destination_location_id(name),
      items:po_items(qty_ordered, unit_cost, product:product_id(sku, flavour, unit_size_g))`)
    .eq('id', id).single() as any;

  if (!po) return new Response('not found', { status: 404 });
  const sizeLabel = (g: number | null) => (g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`);
  const money = (n: number) => `${po.currency || 'AUD'} ${Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#FFF8E7', padding: 48, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 40, fontWeight: 800, color: '#8B4513' }}>Purchase Order — DRAFT</span>
            <span style={{ fontSize: 24, color: '#6b7280', marginTop: 6 }}>{po.reference || po.po_number || ''}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, borderRadius: 16, background: '#C4814A', fontSize: 40 }}>🥞</div>
        </div>

        <div style={{ display: 'flex', gap: 48, marginTop: 28, fontSize: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#9ca3af', fontSize: 18 }}>Supplier</span>
            <span style={{ color: '#111827', fontWeight: 600 }}>{po.supplier?.name || '—'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#9ca3af', fontSize: 18 }}>Deliver to</span>
            <span style={{ color: '#111827', fontWeight: 600 }}>{po.destination?.name || '—'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: '#9ca3af', fontSize: 18 }}>Expected</span>
            <span style={{ color: '#111827', fontWeight: 600 }}>{po.expected_date || 'TBC'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 32, background: 'white', borderRadius: 16, padding: 8 }}>
          <div style={{ display: 'flex', padding: '10px 16px', fontSize: 18, color: '#9ca3af' }}>
            <span style={{ flex: 1 }}>Item</span>
            <span style={{ width: 120, textAlign: 'right' }}>Qty</span>
            <span style={{ width: 160, textAlign: 'right' }}>Unit</span>
            <span style={{ width: 200, textAlign: 'right' }}>Amount</span>
          </div>
          {(po.items || []).slice(0, 8).map((it: any, i: number) => (
            <div key={i} style={{ display: 'flex', padding: '12px 16px', fontSize: 22, borderTop: '1px solid #f3f4f6' }}>
              <span style={{ flex: 1, color: '#111827' }}>{(it.product?.flavour || it.product?.sku || '?')} {sizeLabel(it.product?.unit_size_g)}</span>
              <span style={{ width: 120, textAlign: 'right', color: '#111827' }}>{it.qty_ordered}</span>
              <span style={{ width: 160, textAlign: 'right', color: '#6b7280' }}>{it.unit_cost != null ? money(it.unit_cost) : '—'}</span>
              <span style={{ width: 200, textAlign: 'right', color: '#111827' }}>{money((it.qty_ordered || 0) * (it.unit_cost || 0))}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', fontSize: 32, fontWeight: 800, color: '#8B4513' }}>
          Total: {money(po.total_cost)}
        </div>
      </div>
    ),
    { width: 1000, height: 700 },
  );
}
