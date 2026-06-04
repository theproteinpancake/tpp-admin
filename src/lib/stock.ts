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

export type StockStatus = 'oos' | 'reorder_now' | 'reorder_soon' | 'healthy' | 'inbound' | 'unknown';

export function computeStatus(row: Pick<StockRow, 'available' | 'days_of_cover' | 'tier' | 'inbound'>): StockStatus {
  const base = ((): StockStatus => {
    if (row.available <= 0) return 'oos';
    if (row.days_of_cover == null) return 'unknown';
    const p = POLICY[row.tier];
    if (row.days_of_cover < p.safetyDays) return 'reorder_now';
    if (row.days_of_cover < p.targetDays) return 'reorder_soon';
    return 'healthy';
  })();
  // inbound-aware: a PO is on the way, so don't scream "reorder"
  if ((row.inbound ?? 0) > 0 && (base === 'oos' || base === 'reorder_now')) return 'inbound';
  return base;
}

// Stronger contrast (darker text, solid-ish fills) for readability.
export const STATUS_META: Record<StockStatus, { label: string; dot: string; chip: string }> = {
  healthy:      { label: 'Healthy',      dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800 ring-emerald-600/30' },
  reorder_soon: { label: 'Reorder soon', dot: 'bg-amber-500',   chip: 'bg-amber-100 text-amber-900 ring-amber-600/40' },
  reorder_now:  { label: 'Reorder now',  dot: 'bg-red-500',     chip: 'bg-red-100 text-red-800 ring-red-600/40' },
  oos:          { label: 'Out of stock', dot: 'bg-red-600',     chip: 'bg-red-100 text-red-800 ring-red-600/40' },
  inbound:      { label: 'Inbound',      dot: 'bg-blue-500',    chip: 'bg-blue-100 text-blue-800 ring-blue-600/30' },
  unknown:      { label: 'No velocity',  dot: 'bg-gray-400',    chip: 'bg-gray-100 text-gray-600 ring-gray-400/30' },
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
