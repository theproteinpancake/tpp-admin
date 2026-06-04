// Shipping cost + outlier data (server-side).
import { supabaseLogistics } from './supabase-logistics';

export interface WeeklyCost { site: string; currency: string; week: string; shipments: number; avg_cost: number; total_cost: number }
export interface Outlier {
  id: string; site: string; shipbob_order_id: string; shipbob_shipment_id: string; order_number: string | null;
  ship_date: string | null; cost: number; currency: string; ship_option: string | null;
  region: string | null; city: string | null; median: number; x_median: number;
}

// ShipBob's /orders/{id} deep link resolves the id as a SHIPMENT id, so always pass the shipment id.
export const shipbobOrderUrl = (shipmentId: string) => `https://web.shipbob.com/app/merchant/#/orders/${shipmentId}`;

export async function getShippingData() {
  const since = new Date(Date.now() - 84 * 86400_000).toISOString().slice(0, 10); // 12 weeks
  const [{ data: weekly }, { data: outliers }] = await Promise.all([
    supabaseLogistics.from('v_shipping_weekly').select('*').gte('week', since).order('week'),
    supabaseLogistics.from('v_shipping_outliers').select('*').limit(40),
  ]);
  return { weekly: (weekly ?? []) as WeeklyCost[], outliers: (outliers ?? []) as Outlier[] };
}
