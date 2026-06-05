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
        // ShipBob's field is `lot_date` (best-before), ISO 8601. Noon UTC keeps the
        // same calendar date in both AU and US timezones (no day-shift on display).
        lot_date: i.expiration_date ? `${i.expiration_date}T12:00:00Z` : undefined,
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

// Fetch the WRO labels PDF as base64. NOTE: ShipBob's API only serves the 2-page
// receiving doc (WRO #, barcode, lot/expiry/qty) — the QR "box label" is UI-only
// (the box-labels endpoints 404), so it can't be retrieved here.
export async function getWROLabels(site: string, id: number): Promise<string | null> {
  const token = TOKENS[site];
  if (!token) return null;
  try {
    const res = await fetch(`https://api.shipbob.com/2.0/receiving/${id}/labels`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 1000 && buf.subarray(0, 4).toString('latin1') === '%PDF') return buf.toString('base64');
  } catch { /* labels optional */ }
  return null;
}

export interface B2CRecipient {
  name: string;
  email?: string;
  phone?: string;
  address1: string; address2?: string; city: string; state?: string; zip_code: string; country: string;
}
export interface B2CProduct { reference_id: string; quantity: number; }

// Create a standard DTC/B2C order in ShipBob (uses the per-site token → that account's FC).
// `products` are referenced by SKU (reference_id); include the box SKU as a line so the
// packer uses the right outer (e.g. PANSMALL) instead of auto-selecting.
export async function createB2COrder(opts: {
  site: string;
  reference: string;
  recipient: B2CRecipient;
  products: B2CProduct[];
  shipping_method?: string;
}): Promise<{ id: number; status: string; order_number?: string }> {
  const token = TOKENS[opts.site];
  if (!token) throw new Error(`No ShipBob token for ${opts.site}`);
  const r = opts.recipient;
  const body = {
    shipping_method: opts.shipping_method || 'Standard',
    reference_id: opts.reference,
    recipient: {
      name: r.name, email: r.email || undefined, phone_number: r.phone || undefined,
      address: {
        address1: r.address1, address2: r.address2 || undefined, city: r.city,
        state: r.state || undefined, zip_code: r.zip_code, country: r.country,
      },
    },
    products: opts.products.map((p) => ({ reference_id: p.reference_id, quantity: p.quantity })),
  };
  const res = await fetch('https://api.shipbob.com/1.0/order', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ShipBob order create failed: ${res.status} ${await res.text()}`);
  const o = await res.json();
  return { id: o.id, status: o.status, order_number: o.order_number };
}

// Read an order's current status + tracking (for the influencer dashboard).
export async function getOrderTracking(site: string, id: number): Promise<{ status: string; tracking_number: string | null; tracking_url: string | null; carrier: string | null } | null> {
  const token = TOKENS[site];
  if (!token) return null;
  try {
    const res = await fetch(`https://api.shipbob.com/1.0/order/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const o = await res.json();
    const sh = (o.shipments || [])[0] || {};
    const t = sh.tracking || {};
    return {
      status: sh.status || o.status || 'Processing',
      tracking_number: t.tracking_number || null,
      tracking_url: t.tracking_url || null,
      carrier: t.carrier || null,
    };
  } catch { return null; }
}

export async function getWRO(site: string, id: number): Promise<any> {
  const token = TOKENS[site];
  const res = await fetch(`https://api.shipbob.com/1.0/receiving/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`ShipBob get WRO failed: ${res.status}`);
  return res.json();
}
