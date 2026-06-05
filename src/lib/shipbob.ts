// ShipBob write helpers (WRO creation). Uses the per-site PAT (already write-scoped).
const TOKENS: Record<string, string | undefined> = {
  ALTONA: process.env.SHIPBOB_API_TOKEN,
  MANCHESTER: process.env.SHIPBOB_API_TOKEN_UK,
};
const FC: Record<string, number> = { ALTONA: 28, MANCHESTER: 32 };

export interface WROItem {
  inventory_id: number;
  quantity: number;
  lot_number?: string | null;
  expiration_date?: string | null; // YYYY-MM-DD
}

// Create a Warehouse Receiving Order at a site.
export async function createWRO(opts: {
  site: string;
  expected_arrival_date: string;     // YYYY-MM-DD
  tracking_ref: string;              // docket / reference number
  purchase_order_number?: string;
  package_type?: 'Pallet' | 'Package' | 'FloorLoadedContainer';
  items: WROItem[];
}): Promise<{ id: number; status: string }> {
  const token = TOKENS[opts.site];
  if (!token) throw new Error(`No ShipBob token for ${opts.site}`);
  const fcId = FC[opts.site];

  const body = {
    fulfillment_center: { id: fcId },
    package_type: opts.package_type || 'Pallet',
    box_packaging_type: 'EverythingInOneBox',
    expected_arrival_date: opts.expected_arrival_date,
    purchase_order_number: opts.purchase_order_number || undefined,
    boxes: [{
      tracking_number: opts.tracking_ref,
      box_items: opts.items.map((i) => ({
        inventory_id: i.inventory_id,
        quantity: i.quantity,
        lot_number: i.lot_number || undefined,
        expiration_date: i.expiration_date ? `${i.expiration_date}T00:00:00` : undefined,
      })),
    }],
  };

  const res = await fetch('https://api.shipbob.com/1.0/receiving', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ShipBob WRO create failed: ${res.status} ${await res.text()}`);
  const wro = await res.json();
  return { id: wro.id, status: wro.status };
}

// Fetch the WRO box-labels PDF (v2.0 endpoint) as standard base64, for emailing to the co-packer.
export async function getWROLabels(site: string, id: number): Promise<string | null> {
  const token = TOKENS[site];
  if (!token) return null;
  const res = await fetch(`https://api.shipbob.com/2.0/receiving/${id}/labels`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return null;
  return buf.toString('base64');
}

export async function getWRO(site: string, id: number): Promise<any> {
  const token = TOKENS[site];
  const res = await fetch(`https://api.shipbob.com/1.0/receiving/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`ShipBob get WRO failed: ${res.status}`);
  return res.json();
}
