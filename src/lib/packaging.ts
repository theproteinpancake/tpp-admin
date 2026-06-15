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

// SRP carton tied to a 320g pouch row: 320g sells only as 4-packs, so the usable count is
// capped by whichever runs out first (pouches OR cartons). `binding` = cartons are the limit.
export interface SrpOnRow {
  units_per: number; boxes_baseline: number | null; boxes_consumed: number; boxes_remaining: number | null;
  packable_bags: number | null; binding: boolean; days_cover: number | null; status: PackStatus;
}
export interface PouchRow {
  product_id: string; sku: string; flavour: string | null; size: string;
  baseline_qty: number | null; baseline_date: string | null;
  consumed: number; remaining: number | null; daily: number | null;
  days_cover: number | null; lead_days: number; status: PackStatus;
  srp: SrpOnRow | null;          // attached SRP carton constraint (320g only)
  packable: number | null;       // usable 4-packs in bags = min(pouch remaining, srp packable)
}

const SEV: Record<PackStatus, number> = { unset: 0, ok: 1, order_soon: 2, order_now: 3 };
const worse = (a: PackStatus, b: PackStatus): PackStatus => (SEV[a] >= SEV[b] ? a : b);

export interface CustomPack {
  id: string; kind: string; name: string; sku: string | null; site: string | null;
  supplier: string | null; lead_days: number; on_hand: number | null;
  reorder_point: number | null; status: PackStatus; notes: string | null;
}

const sizeLabel = (g: number | null) => (g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`);

export async function getPouchTracking(): Promise<PouchRow[]> {
  const [{ data: products }, { data: packs }, { data: srpPacks }, { data: poItems }, { data: vel }] = await Promise.all([
    supabaseLogistics.from('products').select('id, sku, flavour, unit_size_g').eq('active', true).eq('category', 'mix'),
    supabaseLogistics.from('packaging').select('*').eq('kind', 'pouch'),
    supabaseLogistics.from('packaging').select('*').eq('kind', 'srp').eq('active', true),
    supabaseLogistics.from('po_items').select('product_id, qty_ordered, po:po_id(created_at)'),
    supabaseLogistics.from('v_stock_current').select('product_id, avg_daily_units_30d').eq('location_code', 'ALTONA'),
  ]);

  const packByProduct = new Map((packs ?? []).map((p: any) => [p.product_id, p]));
  const srpByLinked = new Map((srpPacks ?? []).map((s: any) => [s.linked_product_id, s]));
  const velByProduct = new Map((vel ?? []).map((v: any) => [v.product_id, Number(v.avg_daily_units_30d) || 0]));
  const consumedSince = (productId: string, since: string | null) =>
    since ? (poItems ?? []).filter((i: any) => i.product_id === productId && (i.po?.created_at ?? '').slice(0, 10) >= since)
      .reduce((s: number, i: any) => s + (i.qty_ordered || 0), 0) : 0;

  const rows: PouchRow[] = (products ?? []).map((p: any) => {
    const pack = packByProduct.get(p.id);
    const baseline_qty = pack?.baseline_qty ?? null;
    const baseline_date = pack?.baseline_date ?? null;
    const lead_days = pack?.lead_days ?? 60;
    // consumed = units ordered on POs placed on/after the baseline date
    const consumed = consumedSince(p.id, baseline_date);
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

    // Attach the SRP carton (320g only). 320g sells ONLY as 4-packs, so the usable count is
    // min(pouches remaining, cartons remaining × units_per). Cartons being the limit = `binding`.
    const sp = srpByLinked.get(p.id);
    let srp: SrpOnRow | null = null;
    let packable = remaining;
    let rowStatus = status;
    if (sp) {
      const units_per = sp.units_per || 4;
      const boxes_baseline = sp.baseline_qty ?? null;
      const boxes_consumed = Math.round(consumedSince(p.id, sp.baseline_date) / units_per);
      const boxes_remaining = boxes_baseline == null ? null : boxes_baseline - boxes_consumed;
      const packable_bags = boxes_remaining == null ? null : boxes_remaining * units_per;
      const srpDaily = daily && daily > 0 ? daily : null; // bags/day; packable is in bags too
      const srpDays = packable_bags != null && srpDaily ? Math.round(packable_bags / srpDaily) : null;
      let srpStatus: PackStatus = 'unset';
      if (boxes_baseline != null) {
        if (boxes_remaining != null && boxes_remaining <= 0) srpStatus = 'order_now';
        else if (srpDays != null && srpDays < lead_days) srpStatus = 'order_now';
        else if (srpDays != null && srpDays < lead_days + 21) srpStatus = 'order_soon';
        else srpStatus = 'ok';
      }
      const binding = packable_bags != null && remaining != null && packable_bags < remaining;
      packable = packable_bags != null && remaining != null ? Math.min(remaining, packable_bags) : (packable_bags ?? remaining);
      rowStatus = worse(status, srpStatus);
      srp = { units_per, boxes_baseline, boxes_consumed, boxes_remaining, packable_bags, binding, days_cover: srpDays, status: srpStatus };
    }
    return {
      product_id: p.id, sku: p.sku, flavour: p.flavour, size: sizeLabel(p.unit_size_g),
      baseline_qty, baseline_date, consumed, remaining, daily, days_cover, lead_days, status: rowStatus,
      srp, packable,
    };
  });
  // soonest-to-run-out first, unset last
  return rows.sort((a, b) => {
    const av = a.days_cover ?? (a.baseline_qty == null ? 1e8 : 1e7);
    const bv = b.days_cover ?? (b.baseline_qty == null ? 1e8 : 1e7);
    return av - bv;
  });
}

export interface SrpRow {
  id: string; name: string; sku: string | null; linked_sku: string | null; linked_flavour: string | null;
  units_per: number; baseline_qty: number | null; baseline_date: string | null;
  consumed_units: number; consumed_boxes: number; remaining: number | null;
  daily: number | null; days_cover: number | null; lead_days: number; status: PackStatus;
}

// Shelf-ready (SRP) cartons for DISCONTINUED 320g SKUs only — active ones now show inline on
// their pouch row (getPouchTracking). These are held cartons for sizes we no longer produce.
export async function getSrpTracking(): Promise<SrpRow[]> {
  const [{ data: srpAll }, { data: poItems }, { data: vel }, { data: activeMix }] = await Promise.all([
    supabaseLogistics.from('packaging').select('*').eq('kind', 'srp').eq('active', true),
    supabaseLogistics.from('po_items').select('product_id, qty_ordered, po:po_id(created_at)'),
    supabaseLogistics.from('v_stock_current').select('product_id, avg_daily_units_30d').eq('location_code', 'ALTONA'),
    supabaseLogistics.from('products').select('id').eq('active', true).eq('category', 'mix'),
  ]);
  // exclude SRP cartons whose linked product is an ACTIVE mix SKU (shown on the pouch row instead)
  const activeIds = new Set((activeMix ?? []).map((p: any) => p.id));
  const srp = (srpAll ?? []).filter((s: any) => !s.linked_product_id || !activeIds.has(s.linked_product_id));
  const products = srp.map((s: any) => s.linked_product_id).filter(Boolean);
  const { data: prod } = products.length
    ? await supabaseLogistics.from('products').select('id, sku, flavour').in('id', products)
    : { data: [] as any[] };
  const prodById = new Map((prod ?? []).map((p: any) => [p.id, p]));
  const velByProduct = new Map((vel ?? []).map((v: any) => [v.product_id, Number(v.avg_daily_units_30d) || 0]));

  const rows: SrpRow[] = (srp ?? []).map((s: any) => {
    const lp = prodById.get(s.linked_product_id);
    const units_per = s.units_per || 4;
    const baseline_qty = s.baseline_qty ?? null;
    const baseline_date = s.baseline_date ?? null;
    const lead_days = s.lead_days ?? 60;
    // bags of the linked 320g SKU ordered on/after the baseline → boxes consumed
    const consumed_units = baseline_date && s.linked_product_id
      ? (poItems ?? []).filter((i: any) => i.product_id === s.linked_product_id && (i.po?.created_at ?? '').slice(0, 10) >= baseline_date)
          .reduce((acc: number, i: any) => acc + (i.qty_ordered || 0), 0)
      : 0;
    const consumed_boxes = Math.round(consumed_units / units_per);
    const remaining = baseline_qty == null ? null : baseline_qty - consumed_boxes;
    // box usage/day = the linked SKU's daily velocity ÷ bags-per-box
    const unitDaily = s.linked_product_id ? (velByProduct.get(s.linked_product_id) ?? 0) : 0;
    const daily = unitDaily > 0 ? unitDaily / units_per : null;
    const days_cover = remaining != null && daily && daily > 0 ? Math.round(remaining / daily) : null;

    let status: PackStatus = 'unset';
    if (baseline_qty != null) {
      if (remaining != null && remaining <= 0) status = 'order_now';
      else if (days_cover != null && days_cover < lead_days) status = 'order_now';
      else if (days_cover != null && days_cover < lead_days + 21) status = 'order_soon';
      else status = 'ok';
    }
    return {
      id: s.id, name: s.name, sku: s.sku, linked_sku: lp?.sku ?? null, linked_flavour: lp?.flavour ?? null,
      units_per, baseline_qty, baseline_date, consumed_units, consumed_boxes, remaining,
      daily, days_cover, lead_days, status,
    };
  });
  return rows.sort((a, b) => {
    const av = a.days_cover ?? (a.baseline_qty == null ? 1e8 : 1e7);
    const bv = b.days_cover ?? (b.baseline_qty == null ? 1e8 : 1e7);
    return av - bv;
  });
}

export async function getCustomPackaging(): Promise<CustomPack[]> {
  const { data } = await supabaseLogistics.from('packaging').select('*').not('kind', 'in', '("pouch","srp")').eq('active', true).order('name');
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
