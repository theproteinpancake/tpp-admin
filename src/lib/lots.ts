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

export const EXPIRY_META: Record<ExpiryStatus, { label: string; bg: string }> = {
  expired:  { label: 'Expired',    bg: '#b91c1c' }, // red-700
  critical: { label: '< 30 days',  bg: '#dc2626' }, // red-600
  warning:  { label: '< 3 months', bg: '#d97706' }, // amber-600
  ok:       { label: 'OK',         bg: '#059669' }, // emerald-600
  unknown:  { label: 'No date',    bg: '#9ca3af' }, // gray-400
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
