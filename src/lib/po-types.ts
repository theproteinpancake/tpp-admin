// Pure PO constants/types/helpers — safe to import from client OR server.
// (No Supabase client here, so client components can use it.)

export const PO_STATUSES = [
  'draft', 'placed', 'in_production', 'partially_received', 'received', 'closed', 'cancelled',
] as const;
export type POStatus = (typeof PO_STATUSES)[number];

// statuses that count as inbound / pending stock
export const OPEN_STATUSES: POStatus[] = ['placed', 'in_production', 'partially_received'];

export const PO_STATUS_META: Record<POStatus, { label: string; chip: string }> = {
  draft:              { label: 'Draft',              chip: 'bg-gray-100 text-gray-600 ring-gray-400/20' },
  placed:             { label: 'Placed',             chip: 'bg-blue-50 text-blue-700 ring-blue-600/20' },
  in_production:      { label: 'In production',      chip: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20' },
  partially_received: { label: 'Partially received', chip: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  received:           { label: 'Received',           chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  closed:             { label: 'Closed',             chip: 'bg-gray-100 text-gray-500 ring-gray-400/20' },
  cancelled:          { label: 'Cancelled',          chip: 'bg-red-50 text-red-600 ring-red-600/20' },
};

export interface POItemRow {
  qty_ordered: number;
  qty_received: number;
  unit_cost: number | null;
  product: { sku: string; name: string; size_code: string | null; unit_size_g: number | null } | null;
}
export interface PORow {
  id: string;
  po_number: string | null;
  status: POStatus;
  currency: string | null;
  order_date: string | null;
  expected_date: string | null;
  received_date: string | null;
  total_cost: number | null;
  notes: string | null;
  supplier: { name: string; currency: string | null } | null;
  destination: { code: string; name: string } | null;
  items: POItemRow[];
}

export function poUnits(po: PORow) {
  const ordered = po.items.reduce((s, i) => s + (i.qty_ordered || 0), 0);
  const received = po.items.reduce((s, i) => s + (i.qty_received || 0), 0);
  return { ordered, received, outstanding: Math.max(ordered - received, 0) };
}
