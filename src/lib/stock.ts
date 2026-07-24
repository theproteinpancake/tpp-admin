// Stock Overview data + status logic (server-side).
import { supabaseLogistics, StockRow, SiteLocation, SnapshotPoint } from './supabase-logistics';

export const PRIMARY_FLAVOURS = [
  'Buttermilk', 'GF Buttermilk', 'Cinnamon Churro', 'Maple', 'GF Cinnamon Churro',
];

// Reorder policy (Phase 2 will move this to a sku_policy table).
export const POLICY = {
  primary:   { targetDays: 30, safetyDays: 14 },
  secondary: { targetDays: 21, safetyDays: 10 },
};
// Non-mix products reorder on SUPPLIER LEAD TIME, not the mix tiers: velocity shifts made
// ShipBob's static low-stock alerts fire too late (the Flipper went OOS off the back of one).
// reorder_now = cover inside the lead time (order today or stock out); reorder_soon = within
// a month of that point.
export const CATEGORY_LEAD_DAYS: Record<string, number> = { syrup: 30, accessory: 60 };

export type StockStatus = 'oos' | 'reorder_now' | 'reorder_soon' | 'healthy' | 'inbound' | 'unknown';

export function computeStatus(row: Pick<StockRow, 'available' | 'days_of_cover' | 'tier' | 'inbound'> & { category?: string | null }): StockStatus {
  const base = ((): StockStatus => {
    if (row.available <= 0) return 'oos';
    if (row.days_of_cover == null) return 'unknown';
    const lead = row.category ? CATEGORY_LEAD_DAYS[row.category] : undefined;
    if (lead != null) {
      if (row.days_of_cover < lead) return 'reorder_now';
      if (row.days_of_cover < lead + 30) return 'reorder_soon';
      return 'healthy';
    }
    const p = POLICY[row.tier];
    if (row.days_of_cover < p.safetyDays) return 'reorder_now';
    if (row.days_of_cover < p.targetDays) return 'reorder_soon';
    return 'healthy';
  })();
  // inbound-aware: a PO is on the way, so don't scream "reorder"
  if ((row.inbound ?? 0) > 0 && (base === 'oos' || base === 'reorder_now')) return 'inbound';
  return base;
}

// Explicit hex (rendered via inline style) so colours always apply — green=healthy,
// orange=reorder soon, red=reorder now/OOS, blue=inbound.
export const STATUS_META: Record<StockStatus, { label: string; bg: string }> = {
  healthy:      { label: 'Healthy',      bg: '#059669' }, // emerald-600
  reorder_soon: { label: 'Reorder soon', bg: '#d97706' }, // amber-600
  reorder_now:  { label: 'Reorder now',  bg: '#dc2626' }, // red-600
  oos:          { label: 'Out of stock', bg: '#b91c1c' }, // red-700
  inbound:      { label: 'Inbound',      bg: '#2563eb' }, // blue-600
  unknown:      { label: 'No velocity',  bg: '#9ca3af' }, // gray-400
};

export interface StockData {
  sites: SiteLocation[];
  rows: StockRow[];
  history: SnapshotPoint[];
  lastSync: string | null;
}

export async function getStockData(): Promise<StockData> {
  const since = new Date(Date.now() - 35 * 86400_000).toISOString().slice(0, 10);

  const [{ data: sites }, { data: rows }, { data: snaps }] = await Promise.all([
    supabaseLogistics.from('locations')
      .select('id, code, name, country, currency')
      .eq('type', 'finished_3pl').eq('active', true)
      .order('is_default_origin', { ascending: false }),
    supabaseLogistics.from('v_stock_current').select('*'),
    supabaseLogistics.from('inventory_snapshots')
      .select('snapshot_date, product_id, location_id, on_hand, available')
      .gte('snapshot_date', since)
      .order('snapshot_date', { ascending: true }),
  ]);

  const codeById = new Map((sites ?? []).map((s) => [s.id, s.code]));
  const history: SnapshotPoint[] = (snaps ?? []).map((s) => ({
    snapshot_date: s.snapshot_date,
    location_code: codeById.get(s.location_id) ?? '?',
    product_id: s.product_id,
    on_hand: s.on_hand,
    available: s.available,
  }));

  const lastSync = (rows ?? []).reduce<string | null>((max, r) => {
    if (r.snapshot_date && (!max || r.snapshot_date > max)) return r.snapshot_date;
    return max;
  }, null);

  return {
    sites: (sites ?? []) as SiteLocation[],
    rows: (rows ?? []) as StockRow[],
    history,
    lastSync,
  };
}

// Per-site headline numbers for the summary cards.
export function summariseSite(rows: StockRow[], code: string) {
  const r = rows.filter((x) => x.location_code === code && x.active);
  const units = r.reduce((s, x) => s + x.on_hand, 0);
  const value = r.reduce((s, x) => s + x.on_hand * (x.cogs ?? 0), 0);
  const oos = r.filter((x) => x.available <= 0).length;
  const reorder = r.filter((x) => {
    const st = computeStatus(x);
    return st === 'reorder_now' || st === 'reorder_soon';
  }).length;
  const primaryOos = r.filter((x) => x.tier === 'primary' && x.available <= 0).length;
  return { skuCount: r.length, units, value, oos, reorder, primaryOos };
}
