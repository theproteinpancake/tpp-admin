// Batch / lot (best-before) data + expiry classification.
import { supabaseLogistics } from './supabase-logistics';

export interface LotRow {
  id: string;
  product_id: string;
  sku: string;
  flavour: string | null;
  unit_size_g: number | null;
  tier: string;
  category: string;
  site: string;
  site_name: string;
  lot_number: string;
  expiry_date: string | null;
  on_hand: number;
  source: string;
  days_left: number | null;
}

export type ExpiryStatus = 'expired' | 'critical' | 'warning' | 'ok' | 'unknown';

export function expiryStatus(daysLeft: number | null): ExpiryStatus {
  if (daysLeft == null) return 'unknown';
  if (daysLeft < 0) return 'expired';
  if (daysLeft < 30) return 'critical';
  if (daysLeft < 90) return 'warning'; // < 3 months
  return 'ok';
}

export const EXPIRY_META: Record<ExpiryStatus, { label: string; chip: string }> = {
  expired:  { label: 'Expired',    chip: 'bg-red-700 text-white ring-red-800/30' },
  critical: { label: '< 30 days',  chip: 'bg-red-600 text-white ring-red-700/30' },
  warning:  { label: '< 3 months', chip: 'bg-amber-600 text-white ring-amber-700/30' },
  ok:       { label: 'OK',         chip: 'bg-emerald-600 text-white ring-emerald-700/30' },
  unknown:  { label: 'No date',    chip: 'bg-gray-400 text-white ring-gray-500/30' },
};

export async function getLots(): Promise<LotRow[]> {
  const { data } = await supabaseLogistics.from('v_lots').select('*')
    .order('expiry_date', { ascending: true, nullsFirst: false });
  return (data ?? []) as LotRow[];
}

// soonest-dated lots with stock (for the homepage mini-panel)
export async function getShortestDated(limit = 5): Promise<LotRow[]> {
  const all = await getLots();
  return all.filter((l) => l.expiry_date).slice(0, limit);
}
