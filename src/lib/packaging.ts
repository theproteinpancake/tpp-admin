// Packaging tracking: empty pouches at ABC (manual baseline, auto-deducted by POs)
// + custom shipping packaging (boxes / thank-you cards) with lead-time reorder flags.
import { supabaseLogistics } from './supabase-logistics';

export type PackStatus = 'unset' | 'order_now' | 'order_soon' | 'ok';
export const PACK_STATUS_META: Record<PackStatus, { label: string; bg: string }> = {
  unset: { label: 'No baseline', bg: '#9ca3af' },
  order_now: { label: 'Order now', bg: '#dc2626' },
  order_soon: { label: 'Order soon', bg: '#d97706' },
  ok: { label: 'Healthy', bg: '#059669' },
};

export interface PouchRow {
  product_id: string; sku: string; flavour: string | null; size: string;
  baseline_qty: number | null; baseline_date: string | null;
  consumed: number; remaining: number | null; daily: number | null;
  days_cover: number | null; lead_days: number; status: PackStatus;
}

export interface CustomPack {
  id: string; kind: string; name: string; sku: string | null; site: string | null;
  supplier: string | null; lead_days: number; on_hand: number | null;
  reorder_point: number | null; status: PackStatus; notes: string | null;
}

const sizeLabel = (g: number | null) => (g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`);

export async function getPouchTracking(): Promise<PouchRow[]> {
  const [{ data: products }, { data: packs }, { data: poItems }, { data: vel }] = await Promise.all([
    supabaseLogistics.from('products').select('id, sku, flavour, unit_size_g').eq('active', true).eq('category', 'mix'),
    supabaseLogistics.from('packaging').select('*').eq('kind', 'pouch'),
    supabaseLogistics.from('po_items').select('product_id, qty_ordered, po:po_id(created_at)'),
    supabaseLogistics.from('v_stock_current').select('product_id, avg_daily_units_30d').eq('location_code', 'ALTONA'),
  ]);

  const packByProduct = new Map((packs ?? []).map((p: any) => [p.product_id, p]));
  const velByProduct = new Map((vel ?? []).map((v: any) => [v.product_id, Number(v.avg_daily_units_30d) || 0]));

  const rows: PouchRow[] = (products ?? []).map((p: any) => {
    const pack = packByProduct.get(p.id);
    const baseline_qty = pack?.baseline_qty ?? null;
    const baseline_date = pack?.baseline_date ?? null;
    const lead_days = pack?.lead_days ?? 60;
    // consumed = units ordered on POs placed on/after the baseline date
    const consumed = baseline_date
      ? (poItems ?? []).filter((i: any) => i.product_id === p.id && (i.po?.created_at ?? '').slice(0, 10) >= baseline_date)
          .reduce((s: number, i: any) => s + (i.qty_ordered || 0), 0)
      : 0;
    const remaining = baseline_qty == null ? null : baseline_qty - consumed;
    const daily = pack?.daily_usage != null ? Number(pack.daily_usage) : (velByProduct.get(p.id) ?? null);
    const days_cover = remaining != null && daily && daily > 0 ? Math.round(remaining / daily) : null;

    let status: PackStatus = 'unset';
    if (baseline_qty != null) {
      if (remaining != null && remaining <= 0) status = 'order_now';
      else if (days_cover != null && days_cover < lead_days) status = 'order_now';
      else if (days_cover != null && days_cover < lead_days + 21) status = 'order_soon';
      else status = 'ok';
    }
    return {
      product_id: p.id, sku: p.sku, flavour: p.flavour, size: sizeLabel(p.unit_size_g),
      baseline_qty, baseline_date, consumed, remaining, daily, days_cover, lead_days, status,
    };
  });
  // soonest-to-run-out first, unset last
  return rows.sort((a, b) => {
    const av = a.days_cover ?? (a.baseline_qty == null ? 1e8 : 1e7);
    const bv = b.days_cover ?? (b.baseline_qty == null ? 1e8 : 1e7);
    return av - bv;
  });
}

export async function getCustomPackaging(): Promise<CustomPack[]> {
  const { data } = await supabaseLogistics.from('packaging').select('*').neq('kind', 'pouch').eq('active', true).order('name');
  return (data ?? []).map((p: any): CustomPack => {
    const on_hand = p.manual_on_hand ?? null;
    let status: PackStatus = 'unset';
    if (on_hand != null) {
      const rp = p.reorder_point ?? 0;
      const daily = p.daily_usage != null ? Number(p.daily_usage) : null;
      const days = daily && daily > 0 ? on_hand / daily : null;
      if (on_hand <= rp) status = 'order_now';
      else if (days != null && days < p.lead_days) status = 'order_now';
      else if (days != null && days < p.lead_days + 21) status = 'order_soon';
      else status = 'ok'; // a count is recorded — 'unset' only means no count at all
    }
    return {
      id: p.id, kind: p.kind, name: p.name, sku: p.sku, site: p.site, supplier: p.supplier,
      lead_days: p.lead_days, on_hand, reorder_point: p.reorder_point, status, notes: p.notes,
    };
  });
}
