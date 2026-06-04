// Purchase Order data (server-side, logistics project).
import { supabaseLogistics } from './supabase-logistics';
import type { PORow } from './po-types';

// re-export pure constants/types/helpers so server pages can import from one place
export * from './po-types';

export async function getPurchaseOrders(): Promise<PORow[]> {
  const { data } = await supabaseLogistics
    .from('purchase_orders')
    .select(`id, po_number, status, currency, order_date, expected_date, received_date, total_cost, notes,
      supplier:supplier_id ( name, currency ),
      destination:destination_location_id ( code, name ),
      items:po_items ( qty_ordered, qty_received, unit_cost,
        product:product_id ( sku, name, size_code, unit_size_g ) )`)
    .order('created_at', { ascending: false });
  return (data ?? []) as unknown as PORow[];
}

export async function getPOFormOptions() {
  const [{ data: suppliers }, { data: locations }, { data: products }] = await Promise.all([
    supabaseLogistics.from('suppliers').select('id, name, currency, default_lead_days').eq('active', true).order('name'),
    supabaseLogistics.from('locations').select('id, code, name').eq('active', true).order('name'),
    supabaseLogistics.from('products')
      .select('id, sku, name, flavour, size_code, unit_size_g, cogs')
      .eq('active', true).in('category', ['mix', 'syrup', 'accessory'])
      .order('flavour', { nullsFirst: false }).order('unit_size_g'),
  ]);
  return { suppliers: suppliers ?? [], locations: locations ?? [], products: products ?? [] };
}
