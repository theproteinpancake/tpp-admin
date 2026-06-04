// Server-ONLY Supabase client for the tpp-dashboard project (logistics / stock).
// Uses the service-role key — never import this into a client component.
import { createClient } from '@supabase/supabase-js';

const url = process.env.LOGISTICS_SUPABASE_URL!;
const serviceKey = process.env.LOGISTICS_SUPABASE_SERVICE_KEY!;

export const supabaseLogistics = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type Tier = 'primary' | 'secondary';
export type Category = 'mix' | 'syrup' | 'accessory' | 'component' | 'bundle';

// One row of the public.v_stock_current view (per SKU per site).
export interface StockRow {
  product_id: string;
  sku: string;
  name: string;
  flavour: string | null;
  flavour_code: string | null;
  size_code: 'S' | 'M' | 'L' | 'SAMPLE' | null;
  unit_size_g: number | null;
  serves: number | null;
  tier: Tier;
  category: Category;
  format: string | null;
  active: boolean;
  cogs: number | null;
  base_units: number | null;
  location_id: string;
  location_code: string;
  location_name: string;
  currency: string | null;
  snapshot_date: string | null;
  on_hand: number;
  available: number;
  committed: number;
  inbound: number;
  velocity_as_of: string | null;
  avg_daily_units_7d: number | null;
  avg_daily_units_30d: number | null;
  avg_daily_units_90d: number | null;
  days_of_cover: number | null;
  trend: 'up' | 'down' | 'flat' | null;
}

export interface SiteLocation {
  id: string;
  code: string;
  name: string;
  country: string | null;
  currency: string | null;
}

export interface SnapshotPoint {
  snapshot_date: string;
  location_code: string;
  product_id: string;
  on_hand: number;
  available: number;
}
