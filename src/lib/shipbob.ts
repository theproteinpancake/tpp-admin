// ShipBob write helpers (WRO creation). Uses the per-site PAT (already write-scoped).
// API VERSION: legacy /1.0 + /2.0 paths are SUNSET on 31 Jul 2026 — everything here runs on
// the dated version below (12-month support windows; bump twice yearly). Migration notes:
// channel + inventory-level responses are paginated ({items}), quantities moved from
// /inventory/{id} to /inventory-level, cancel is /receiving/{id}:cancel.
export const SB = 'https://api.shipbob.com/2026-01';
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

// Create a Warehouse Receiving Order at a site. Pass `boxes` (one WROItem[] per physical
// pallet/box) when the delivery arrives as MORE than one — each box gets its own label page
// in the WRO labels PDF (VISY needs a label per pallet; a single label on a 2-pallet delivery
// meant hand-editing the WRO last time). Plain `items` = whole delivery on one pallet.
export async function createWRO(opts: {
  site: string;
  expected_arrival_date: string;     // YYYY-MM-DD
  tracking_ref: string;              // docket / reference number
  purchase_order_number?: string;
  package_type?: 'Pallet' | 'Package' | 'FloorLoadedContainer';
  items?: WROItem[];
  boxes?: WROItem[][];
}): Promise<{ id: number; status: string }> {
  const token = TOKENS[opts.site];
  if (!token) throw new Error(`No ShipBob token for ${opts.site}`);
  const fcId = FC[opts.site];
  const boxes = opts.boxes?.length ? opts.boxes : [opts.items || []];
  if (!boxes[0]?.length) throw new Error('createWRO: no items');

  const body = {
    fulfillment_center: { id: fcId },
    package_type: opts.package_type || 'Pallet',
    // Always EverythingInOneBox, even multi-box: ShipBob 500s ("Object reference not set") on
    // the 'MultipleBoxes' enum, but happily accepts N boxes under this one — verified live
    // (WRO 969533): 2 boxes → labels PDF with "Pallet: 1 of 2" / "Pallet: 2 of 2" pages.
    box_packaging_type: 'EverythingInOneBox',
    expected_arrival_date: opts.expected_arrival_date,
    purchase_order_number: opts.purchase_order_number || undefined,
    boxes: boxes.map((boxItems, bi) => ({
      // per-box refs must be distinct or ShipBob treats them as one package
      tracking_number: boxes.length > 1 ? `${opts.tracking_ref}-P${bi + 1}` : opts.tracking_ref,
      box_items: boxItems.map((i) => ({
        inventory_id: i.inventory_id,
        quantity: i.quantity,
        lot_number: i.lot_number || undefined,
        // ShipBob's field is `lot_date` (best-before), ISO 8601. Noon UTC keeps the
        // same calendar date in both AU and US timezones (no day-shift on display).
        lot_date: i.expiration_date ? `${i.expiration_date}T12:00:00Z` : undefined,
      })),
    })),
  };

  const res = await fetch(`${SB}/receiving`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ShipBob WRO create failed: ${res.status} ${await res.text()}`);
  const wro = await res.json();
  return { id: wro.id, status: wro.status };
}

// Cancel a WRO (e.g. one orphaned by a superseded VISY draft — its replacement gets a new WRO).
export async function cancelWRO(site: string, id: number): Promise<boolean> {
  const token = TOKENS[site];
  if (!token) return false;
  const res = await fetch(`${SB}/receiving/${id}:cancel`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

// Fetch the WRO labels PDF as base64. NOTE: ShipBob's API only serves the 2-page
// receiving doc (WRO #, barcode, lot/expiry/qty) — the QR "box label" is UI-only
// (the box-labels endpoints 404), so it can't be retrieved here.
export async function getWROLabels(site: string, id: number): Promise<string | null> {
  const token = TOKENS[site];
  if (!token) return null;
  try {
    const res = await fetch(`${SB}/receiving/${id}/labels`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
    });
    if (!res.ok) return null;
    let buf = Buffer.from(await res.arrayBuffer());
    // 2026-01 may respond with JSON carrying a label URI instead of raw PDF bytes — follow it.
    if (buf.subarray(0, 4).toString('latin1') !== '%PDF') {
      try {
        const j = JSON.parse(buf.toString('utf8'));
        const uri = j?.uri || j?.url || j?.labels_uri || j?.box_labels_uri;
        if (!uri) return null;
        const res2 = await fetch(uri, { headers: { Authorization: `Bearer ${token}` } });
        if (!res2.ok) return null;
        buf = Buffer.from(await res2.arrayBuffer());
      } catch { return null; }
    }
    if (buf.length > 1000 && buf.subarray(0, 4).toString('latin1') === '%PDF') return buf.toString('base64');
  } catch { /* labels optional */ }
  return null;
}

// ShipBob B2C order creation requires the channel context (the integration/store the
// order belongs to). Fetch + cache the channel id per site.
const _channelCache: Record<string, number> = {};
export async function getShipbobChannelId(site: string): Promise<number | null> {
  if (_channelCache[site]) return _channelCache[site];
  const token = TOKENS[site];
  if (!token) return null;
  try {
    const res = await fetch(`${SB}/channel`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const j = await res.json();
    const channels = Array.isArray(j) ? j : j?.items || []; // 2026-01 paginates: { items, next, prev }
    // MUST use the channel that can WRITE orders (the PAT/SMA channel) — the
    // Shopify/Amazon/Triple Whale channels are read-only and 403 on order create.
    const writable = channels.find((c: any) => (c.scopes || []).includes('orders_write'))
      || channels.find((c: any) => (c.scopes || []).some((s: string) => /write/i.test(s)));
    if (writable?.id) { _channelCache[site] = writable.id; return writable.id; }
  } catch { /* ignore */ }
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
  const channelId = await getShipbobChannelId(opts.site);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (channelId) headers['shipbob_channel_id'] = String(channelId);
  const res = await fetch(`${SB}/order`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ShipBob order create failed: ${res.status}${channelId ? '' : ' (no channel id found)'} ${await res.text()}`);
  const o = await res.json();
  return { id: o.id, status: o.status, order_number: o.order_number };
}

// Read an order's current status + tracking (for the influencer dashboard).
// Fetch a B2C order back from ShipBob — used to VERIFY what was actually saved (products,
// address lines incl. door codes) so the agent reports confirmed reality, not intent.
export async function getB2COrder(site: string, id: number): Promise<any | null> {
  const token = TOKENS[site];
  if (!token) return null;
  const res = await fetch(`${SB}/order/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.ok ? res.json() : null;
}

export async function getOrderTracking(site: string, id: number): Promise<{ status: string; tracking_number: string | null; tracking_url: string | null; carrier: string | null } | null> {
  const token = TOKENS[site];
  if (!token) return null;
  try {
    const res = await fetch(`${SB}/order/${id}`, { headers: { Authorization: `Bearer ${token}` } });
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

// Has a ShipBob order already been created for this reference recently? (dedup guard)
export async function findRecentOrderByReference(site: string, reference: string, days = 14): Promise<{ id: number } | null> {
  const token = TOKENS[site];
  if (!token || !reference) return null;
  try {
    for (let page = 1; page <= 4; page++) {
      const res = await fetch(`${SB}/order?Page=${page}&Limit=100&SortOrder=Newest`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const batch = await res.json();
      if (!batch?.length) return null;
      for (const o of batch) {
        if (String(o.reference_id || '') === reference || String(o.order_number || '') === reference) return { id: o.id };
      }
      // stop scanning once we're past the recency window
      const oldest = batch[batch.length - 1];
      const od = (oldest?.purchase_date || oldest?.created_date || '').slice(0, 10);
      if (od && od < new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)) break;
      if (batch.length < 100) break;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Past ShipBob orders for a recipient, newest first — the SHIPPING source of truth.
 *
 * ShipBob's saved address for a store is the one that has actually been delivered to; Xero
 * holds BILLING data and mangles the delivery details (centre names, "Deliveries via Loading
 * Dock on Cator St" pushed into an address line, wrong suburb/postcode). Trusting Xero over
 * this created a duplicate ShipBob profile for Tony & Marks Burnside and an Invalid Address
 * hold on order #381476902.
 *
 * Names are matched on token overlap because the two systems punctuate differently —
 * "Tony & Marks Burnside" (Xero) vs "Tony and Marks Burnside" vs "Tony  Marks Unley" (ShipBob).
 */
const shipNameTokens = (s: string) => new Set(
  String(s || '').toLowerCase()
    .replace(/\b(pty|ltd|inc|co|the|and|p\/l|llc|group)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean),
);
export function recipientNameMatches(a: string, b: string): boolean {
  const A = shipNameTokens(a), B = shipNameTokens(b);
  if (!A.size || !B.size) return false;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

const isFulfilled = (status: string) => /fulfil|complete|shipped/i.test(String(status || ''));

/**
 * Scans newest-first and STOPS as soon as a delivered order for this recipient is found, else
 * keeps going to `sinceDays`. A flat page cap doesn't work: a store ordering monthly sits ~1,300
 * orders back in a busy account, so a 12-page (1,200) window returned Tony & Marks Unley's own
 * brand-new bad order instead of the one that actually delivered on 8 Jul.
 */
export async function findOrdersByRecipient(site: string, name: string, sinceDays = 180, maxPages = 40): Promise<{
  id: number; date: string; status: string; name: string;
  address: { address1?: string; address2?: string; city?: string; state?: string; zip_code?: string; country?: string };
  email?: string;
}[]> {
  const token = TOKENS[site];
  if (!token || !name) return [];
  const out: any[] = [];
  try {
    for (let page = 1; page <= maxPages; page++) {
      const res = await fetch(`${SB}/order?Page=${page}&Limit=100&SortOrder=Newest`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) break;
      const batch: any[] = await res.json();
      if (!batch?.length) break;
      for (const o of batch) {
        if (!recipientNameMatches(o.recipient?.name || '', name)) continue;
        out.push({
          id: o.id, date: String(o.purchase_date || o.created_date || '').slice(0, 10),
          status: String(o.status || ''), name: o.recipient?.name || '',
          address: o.recipient?.address || {}, email: o.recipient?.email || undefined,
        });
      }
      if (out.some((o) => isFulfilled(o.status))) break;   // proven address in hand — stop paging
      const oldest = String(batch[batch.length - 1]?.purchase_date || batch[batch.length - 1]?.created_date || '').slice(0, 10);
      if (oldest && oldest < new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10)) break;
      if (batch.length < 100) break;
    }
  } catch { /* history is best-effort */ }
  return out;
}

/** A SKU's lots at one FC, with fulfillable qty — oldest best-before first (FIFO order). */
export async function getInventoryLots(site: string, inventoryId: number):
  Promise<{ lot_number: string; expiration_date: string; qty: number }[]> {
  const token = TOKENS[site];
  if (!token || !inventoryId) return [];
  const fc = FC[site];
  try {
    const res = await fetch(`${SB}/inventory-level/${inventoryId}/lots`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const inv = await res.json();
    const out: { lot_number: string; expiration_date: string; qty: number }[] = [];
    for (const l of (inv.lots ?? []) as any[]) {
      if (!l.lot_number || !l.lot_date) continue;
      const atFc = (l.locations ?? []).find((f: any) => f.location_id === fc);
      const qty = Number(atFc?.fulfillable_quantity ?? l.fulfillable_quantity) || 0;
      if (qty > 0) out.push({ lot_number: l.lot_number, expiration_date: String(l.lot_date).slice(0, 10), qty });
    }
    return out.sort((a, b) => a.expiration_date.localeCompare(b.expiration_date)); // oldest first
  } catch { return []; }
}

export async function getWRO(site: string, id: number): Promise<any> {
  const token = TOKENS[site];
  const res = await fetch(`${SB}/receiving/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`ShipBob get WRO failed: ${res.status}`);
  return res.json();
}

// Live fulfillable/on-hand for a set of inventory ids (e.g. shipping cartons at Altona).
// Returns a map id → { fulfillable, onhand }; ids that error are simply absent.
export async function getInventoryLevels(site: string, ids: number[]): Promise<Map<number, { fulfillable: number; onhand: number }>> {
  const token = TOKENS[site];
  const out = new Map<number, { fulfillable: number; onhand: number }>();
  if (!token || !ids.length) return out;
  // 2026-01 moved quantities off /inventory/{id} onto /inventory-level (bulk, paginated) and
  // renamed total_onhand_quantity → total_on_hand_quantity. One batched call replaces the
  // per-id fan-out.
  try {
    let url: string | null = `${SB}/inventory-level?InventoryIds=${ids.join(',')}&PageSize=100`;
    for (let page = 0; page < 5 && url; page++) {
      const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) break;
      const j: any = await res.json();
      for (const inv of j?.items || []) {
        out.set(Number(inv.inventory_id), {
          fulfillable: Number(inv.total_fulfillable_quantity) || 0,
          onhand: Number(inv.total_on_hand_quantity) || 0,
        });
      }
      url = j?.next ? (String(j.next).startsWith('http') ? String(j.next) : `https://api.shipbob.com${j.next}`) : null;
    }
  } catch { /* absent ids just mean no live overlay */ }
  return out;
}
