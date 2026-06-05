// PO reconciliation: keep "inbound" honest by closing out POs once their goods land.
// A PO counts as inbound only while status is open ('placed'/'in_production'/
// 'partially_received'). Once received, it drops out of inbound everywhere (the
// v_stock_current po_inbound CTE and the agent's get_purchase_orders tool).
import { supabaseLogistics } from './supabase-logistics';
import { markXeroPOBilled, xeroConfigured } from './xero';
import { getWRO } from './shipbob';

// ShipBob WRO statuses that mean the stock has physically arrived/been counted.
const WRO_DONE = /complete|completed|received|arrived|closed|fulfilled/i;

// Mark a single PO received locally and (best-effort) BILLED in Xero so it stops
// being treated as inbound and won't be re-pulled by the AUTHORISED-only sync.
export async function markPOReceived(
  poNumber: string,
  opts: { pushXero?: boolean } = {},
): Promise<{ po_number: string; local: boolean; xero: boolean }> {
  const { data: po } = await supabaseLogistics
    .from('purchase_orders')
    .select('id, xero_po_id, status')
    .eq('po_number', poNumber)
    .maybeSingle();
  if (!po) return { po_number: poNumber, local: false, xero: false };

  let xero = false;
  if (opts.pushXero !== false && xeroConfigured() && po.xero_po_id) {
    xero = await markXeroPOBilled(po.xero_po_id);
  }
  await supabaseLogistics
    .from('purchase_orders')
    .update({ status: 'received', xero_status: xero ? 'BILLED' : undefined, updated_at: new Date().toISOString() })
    .eq('id', po.id);

  return { po_number: poNumber, local: true, xero };
}

// Daily check: for every open PO that has a linked ShipBob WRO, look up the WRO's
// live status; if it has landed, close the PO. This is the "if a WRO has been
// received that matches a PO, mark it delivered" rule, run hands-free.
export async function reconcilePOsFromWROs(): Promise<{ checked: number; reconciled: string[] }> {
  const { data: pos } = await supabaseLogistics
    .from('purchase_orders')
    .select('po_number, shipbob_wro_id, destination_location_id, status, locations:destination_location_id(code)')
    .not('shipbob_wro_id', 'is', null)
    .in('status', ['placed', 'in_production', 'partially_received']);

  const reconciled: string[] = [];
  for (const po of (pos ?? []) as any[]) {
    const site = po.locations?.code || 'ALTONA';
    try {
      const wro = await getWRO(site, Number(po.shipbob_wro_id));
      const status = String(wro?.status ?? '');
      if (WRO_DONE.test(status)) {
        await markPOReceived(po.po_number, { pushXero: true });
        reconciled.push(po.po_number);
      }
    } catch {
      /* skip POs whose WRO can't be fetched */
    }
  }
  return { checked: (pos ?? []).length, reconciled };
}
