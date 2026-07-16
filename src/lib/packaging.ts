// Packaging tracking: empty pouches at ABC (manual baseline, auto-deducted by POs)
// + custom shipping packaging (boxes / thank-you cards) with lead-time reorder flags.
import { supabaseLogistics } from './supabase-logistics';
import { getInventoryLevels } from './shipbob';

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
  pack_id: string; units_per: number; boxes_baseline: number | null; boxes_consumed: number;
  boxes_delivered: number; boxes_remaining: number | null;
  packable_bags: number | null; binding: boolean; days_cover: number | null; status: PackStatus;
}
export interface PouchRow {
  product_id: string; pack_id: string | null; sku: string; flavour: string | null; size: string;
  baseline_qty: number | null; baseline_date: string | null;
  consumed: number; delivered: number; remaining: number | null; daily: number | null;
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
  const [{ data: products }, { data: packs }, { data: srpPacks }, { data: poItems }, { data: vel }, { data: dels }] = await Promise.all([
    supabaseLogistics.from('products').select('id, sku, flavour, unit_size_g').eq('active', true).eq('category', 'mix'),
    supabaseLogistics.from('packaging').select('*').eq('kind', 'pouch'),
    supabaseLogistics.from('packaging').select('*').eq('kind', 'srp').eq('active', true),
    supabaseLogistics.from('po_items').select('product_id, qty_ordered, po:po_id(created_at)'),
    supabaseLogistics.from('v_stock_current').select('product_id, avg_daily_units_30d').eq('location_code', 'ALTONA'),
    supabaseLogistics.from('packaging_deliveries').select('packaging_id, qty, delivered_on'),
  ]);
  // Deliveries ADD stock (VISY SRP boxes → ABC, pouch drops); only those on/after the row's
  // baseline count — a fresh stock-take baseline already includes anything delivered before it.
  const deliveredSince = (packagingId: string | null, since: string | null) =>
    packagingId && since
      ? (dels ?? []).filter((d: any) => d.packaging_id === packagingId && String(d.delivered_on) >= since)
          .reduce((s: number, d: any) => s + (d.qty || 0), 0)
      : 0;

  const packByProduct = new Map((packs ?? []).map((p: any) => [p.product_id, p]));
  const srpByLinked = new Map((srpPacks ?? []).map((s: any) => [s.linked_product_id, s]));
  // UNITS TRAP: ShipBob tracks 320g SKUs as 4-pack cartons, so their velocity arrives in
  // CARTONS/day — but pouch counts here are POUCHES. Scale to pouches/day or 320g cover
  // reads 4× too long (same conversion the PO builder needs).
  const velByProduct = new Map((vel ?? []).map((v: any) => [v.product_id, Number(v.avg_daily_units_30d) || 0]));
  const pouchDaily = (productId: string, unitSizeG: number | null) =>
    (velByProduct.get(productId) ?? 0) * (unitSizeG === 320 ? 4 : 1);
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
    const delivered = deliveredSince(pack?.id ?? null, baseline_date);
    const remaining = baseline_qty == null ? null : baseline_qty - consumed + delivered;
    const daily = pack?.daily_usage != null ? Number(pack.daily_usage) : (pouchDaily(p.id, p.unit_size_g) || null);
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
      const boxes_delivered = deliveredSince(sp.id, sp.baseline_date);
      const boxes_remaining = boxes_baseline == null ? null : boxes_baseline - boxes_consumed + boxes_delivered;
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
      srp = { pack_id: sp.id, units_per, boxes_baseline, boxes_consumed, boxes_delivered, boxes_remaining, packable_bags, binding, days_cover: srpDays, status: srpStatus };
    }
    return {
      product_id: p.id, pack_id: pack?.id ?? null, sku: p.sku, flavour: p.flavour, size: sizeLabel(p.unit_size_g),
      baseline_qty, baseline_date, consumed, delivered, remaining, daily, days_cover, lead_days, status: rowStatus,
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
  const [{ data: srpAll }, { data: poItems }, { data: vel }, { data: activeMix }, { data: dels }] = await Promise.all([
    supabaseLogistics.from('packaging').select('*').eq('kind', 'srp').eq('active', true),
    supabaseLogistics.from('po_items').select('product_id, qty_ordered, po:po_id(created_at)'),
    supabaseLogistics.from('v_stock_current').select('product_id, avg_daily_units_30d').eq('location_code', 'ALTONA'),
    supabaseLogistics.from('products').select('id').eq('active', true).eq('category', 'mix'),
    supabaseLogistics.from('packaging_deliveries').select('packaging_id, qty, delivered_on'),
  ]);
  // exclude SRP cartons whose linked product is an ACTIVE mix SKU (shown on the pouch row instead)
  const activeIds = new Set((activeMix ?? []).map((p: any) => p.id));
  const srp = (srpAll ?? []).filter((s: any) => !s.linked_product_id || !activeIds.has(s.linked_product_id));
  const products = srp.map((s: any) => s.linked_product_id).filter(Boolean);
  const { data: prod } = products.length
    ? await supabaseLogistics.from('products').select('id, sku, flavour, unit_size_g').in('id', products)
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
    const delivered_boxes = baseline_date
      ? (dels ?? []).filter((d: any) => d.packaging_id === s.id && String(d.delivered_on) >= baseline_date)
          .reduce((acc: number, d: any) => acc + (d.qty || 0), 0)
      : 0;
    const remaining = baseline_qty == null ? null : baseline_qty - consumed_boxes + delivered_boxes;
    // box usage/day = the linked SKU's daily velocity (pouches/day) ÷ bags-per-box.
    // 320g velocity arrives in CARTONS/day (ShipBob tracks the 4-pack) → ×4 to pouches first.
    const unitDaily = s.linked_product_id
      ? (velByProduct.get(s.linked_product_id) ?? 0) * (lp?.unit_size_g === 320 ? 4 : 1)
      : 0;
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

export interface ShipperRow {
  id: string; name: string; visy_code: string | null; sku: string | null;
  min_order: number | null; reorder_point: number | null; inventory_id: number | null;
  fulfillable: number | null; onhand: number | null; live: boolean; status: PackStatus;
}

// ShipBob Altona shipping cartons (PANSMALL etc.) — stock is pulled LIVE from ShipBob (not a
// baseline), since they're consumed by every outbound order. Ordering one creates a WRO for the pallet.
export async function getShipperTracking(): Promise<ShipperRow[]> {
  const { data } = await supabaseLogistics.from('packaging').select('*').eq('kind', 'shipper').eq('active', true).order('name');
  const rows = (data ?? []) as any[];
  const ids = rows.map((p) => p.shipbob_inventory_id).filter(Boolean) as number[];
  const live = await getInventoryLevels('ALTONA', ids).catch(() => new Map());
  const out: ShipperRow[] = rows.map((p) => {
    const lvl = p.shipbob_inventory_id ? live.get(p.shipbob_inventory_id) : undefined;
    const fulfillable = lvl ? lvl.fulfillable : null;
    const rp = p.reorder_point ?? 0;
    let status: PackStatus = 'unset';
    if (fulfillable != null) {
      if (fulfillable <= rp) status = 'order_now';
      else if (fulfillable <= rp * 1.5) status = 'order_soon';
      else status = 'ok';
    }
    return {
      id: p.id, name: p.name, visy_code: p.visy_code, sku: p.sku,
      min_order: p.min_order, reorder_point: p.reorder_point, inventory_id: p.shipbob_inventory_id ?? null,
      fulfillable, onhand: lvl ? lvl.onhand : null, live: !!lvl, status,
    };
  });
  // lowest cover first (order_now → order_soon → ok → unknown)
  const sev = (s: PackStatus) => SEV[s];
  return out.sort((a, b) => sev(b.status) - sev(a.status) || ((a.fulfillable ?? 1e9) - (b.fulfillable ?? 1e9)));
}

// Plain-English packaging snapshot for the WhatsApp agent: what ABC holds (empty pouches +
// shelf-ready SRP cartons) vs what ShipBob Altona holds (shipping cartons, live). Clearly
// labelled by location so the agent never confuses empties at ABC with finished goods at Altona.
export async function getPackagingSummary() {
  const [pouches, srp, shippers] = await Promise.all([getPouchTracking(), getSrpTracking(), getShipperTracking()]);
  const tracked = pouches.filter((p) => p.baseline_qty != null);
  const abc_empties = tracked.map((p) => ({
    item: `${p.flavour} ${p.size}`, sku: p.sku,
    empty_pouches_remaining: p.remaining,
    srp_cartons_remaining: p.srp ? p.srp.boxes_remaining : null,   // 320g only (4 bags/carton)
    packable_4packs_in_bags: p.srp ? p.srp.packable_bags : null,
    carton_limited: p.srp?.binding ?? false,
    status: p.status, days_cover: p.days_cover,
  }));
  const abc_srp_discontinued = srp.map((s) => ({ item: s.name.replace('SRP Box (small) — ', ''), cartons_remaining: s.remaining, note: 'discontinued 320g size — held, not drawn down' }));
  const altona_shippers = shippers.map((s) => ({
    carton: s.name, visy_code: s.visy_code, fulfillable: s.fulfillable, onhand: s.onhand, reorder_point: s.reorder_point, status: s.status, live: s.live,
  }));
  const reorder_now = [
    ...abc_empties.filter((e) => e.status === 'order_now').map((e) => `${e.item} (ABC — ${e.carton_limited ? 'SRP cartons' : 'pouches'})`),
    ...altona_shippers.filter((s) => s.status === 'order_now').map((s) => `${s.carton} (Altona shipping carton, ${s.fulfillable} left)`),
  ];
  return {
    note: 'ABC holds EMPTY pouches + SRP cartons (used on the packing line). ShipBob Altona holds the shipping cartons. 320g sells only as 4-packs, so its usable count = min(pouches, SRP cartons × 4).',
    abc_on_hand: { empty_pouches_and_srp_cartons: abc_empties, discontinued_srp: abc_srp_discontinued },
    altona_shipping_cartons: altona_shippers,
    reorder_now: reorder_now.length ? reorder_now : ['nothing urgent'],
  };
}

export async function getCustomPackaging(): Promise<CustomPack[]> {
  const { data } = await supabaseLogistics.from('packaging').select('*').not('kind', 'in', '("pouch","srp","shipper")').eq('active', true).order('name');
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
