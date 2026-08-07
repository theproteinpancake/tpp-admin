// One-off ShipBob orders that aren't driven by a wholesale PO — sample drops, gifting runs,
// "send GoodnessMe 700 BM80". The wholesale flow can't serve these: it's bound to a parsed
// customer PO, carton maths, box logic and a Xero invoice. This is the plain version — a
// recipient, some SKUs, an order.
//
// Recipient resolution deliberately mirrors the wholesale fix: ShipBob's own DELIVERED address
// is the source of truth, Xero is a cross-reference. GoodnessMe already had a delivered address
// on file (order #374136574, 8 Jul) when the agent told Luke it had "no contact on file" — it
// had no tool that looked.
import { supabaseLogistics } from './supabase-logistics';
import { createB2COrder, createB2BOrder, getB2COrder, getInventoryLots, type B2CRecipient } from './shipbob';
import { findLastShipBobRecipient } from './wholesaleActions';
import { xeroGet } from './xero';

// B2C and B2B are DIFFERENT FULFILMENT PATHS in ShipBob, not just different postage — a bulk
// drop pushed through the D2C endpoint would go down the retail pick. Both are creatable via the
// 2026-01 API (type B2B + shipping_terms + required_lot), so the path is CHOSEN here and the
// right endpoint used; it is never silently collapsed to D2C.
//
// Packing instructions have no API field. Luke's standing "PLEASE PICK AS CASE PICK NOT
// INDIVIDUAL UNITS" is ShipBob's default behaviour anyway, and he adds anything unusual by hand,
// so the created order surfaces that as a note rather than blocking on it.
const PARCEL_KG_LIMIT = 25;
const PARCEL_UNIT_LIMIT = 200;

export type FulfilPath = 'B2C' | 'B2B';

export interface DirectOrderItem { sku: string; quantity: number }
export interface LotPick { lot_number: string; expiration_date: string; take: number; of: number }

/**
 * Which lots to pick, Luke's rule for outbound B2B: ONE lot if a single one covers the whole
 * quantity, otherwise OLDEST FIRST. Note this is the opposite of the AU→UK transfer picker,
 * which deliberately sends the LONGEST-dated stock so the UK holds maximum shelf life — here
 * we're clearing oldest stock on a domestic drop.
 */
export function pickLotsFifo(lots: { lot_number: string; expiration_date: string; qty: number }[], needed: number):
  { picks: LotPick[]; shortfall: number; single: boolean } {
  const asc = [...lots].sort((a, b) => a.expiration_date.localeCompare(b.expiration_date));
  const one = asc.find((l) => l.qty >= needed);
  if (one) return { picks: [{ lot_number: one.lot_number, expiration_date: one.expiration_date, take: needed, of: one.qty }], shortfall: 0, single: true };
  const picks: LotPick[] = [];
  let left = needed;
  for (const l of asc) {
    if (left <= 0) break;
    const take = Math.min(l.qty, left);
    picks.push({ lot_number: l.lot_number, expiration_date: l.expiration_date, take, of: l.qty });
    left -= take;
  }
  return { picks, shortfall: Math.max(0, left), single: false };
}

export interface DirectOrderPlan {
  recipient: B2CRecipient | null;
  recipient_source: string;
  items: { sku: string; name: string; quantity: number; available: number; enough: boolean; kg: number; lots?: LotPick[]; lot_note?: string }[];
  total_units: number; total_kg: number;
  path: FulfilPath;
  path_reason: string;
  can_create_via_api: boolean;
  place_in_shipbob?: { where: string; steps: string[] };
  warnings: string[];
  ready: boolean;
  summary: string;
}

async function xeroAddressFor(customerName: string): Promise<{ addr: Partial<B2CRecipient>; email?: string } | null> {
  const { data: cust } = await supabaseLogistics.from('wholesale_customers')
    .select('name, xero_contact_id').ilike('name', `%${customerName}%`).limit(1).maybeSingle() as any;
  if (!cust?.xero_contact_id) return null;
  try {
    const r = await xeroGet(`/Contacts/${cust.xero_contact_id}`);
    const c = r.Contacts?.[0];
    const a = (c?.Addresses ?? []).find((x: any) => x.AddressType === 'STREET' && x.AddressLine1)
      || (c?.Addresses ?? []).find((x: any) => x.AddressLine1);
    if (!a) return null;
    return {
      addr: {
        name: c.Name, address1: a.AddressLine1, address2: a.AddressLine2 || undefined,
        city: a.City, state: a.Region, zip_code: a.PostalCode, country: a.Country || 'Australia',
      },
      email: c.EmailAddress || undefined,
    };
  } catch { return null; }
}

/** Resolve, price and stock-check an order WITHOUT creating anything. */
export async function planDirectOrder(input: {
  recipient_name: string;
  items: DirectOrderItem[];
  site?: string;
  address?: Partial<B2CRecipient>;
  path?: FulfilPath;       // force a path; omitted = decide from size
  reference?: string;
  reserve_note?: string;   // e.g. "push out a week, waiting on the Maple"
  payment_term?: 'Prepaid' | 'MerchantResponsible';  // Prepaid = ShipBob buys (default)
}): Promise<DirectOrderPlan> {
  const site = input.site || 'ALTONA';
  const warnings: string[] = [];

  // 1) Recipient — delivered ShipBob address first, then Xero, then whatever was passed in.
  let recipient: B2CRecipient | null = null;
  let recipient_source = 'not found';
  const prev = await findLastShipBobRecipient(input.recipient_name, site).catch(() => null);
  if (prev?.address1 && prev.city && prev.zip_code) {
    recipient = {
      name: prev.name, email: prev.email, address1: prev.address1, address2: prev.address2,
      city: prev.city, state: prev.state, zip_code: prev.zip_code, country: prev.country || 'Australia',
    };
    recipient_source = prev.fulfilled
      ? `ShipBob — DELIVERED to this address on ${prev.shipped_on} (order #${prev.from_order})`
      : `ShipBob order #${prev.from_order} (not yet fulfilled — unproven)`;
  }
  const xero = await xeroAddressFor(input.recipient_name).catch(() => null);
  if (!recipient && xero?.addr?.address1) {
    recipient = { ...(xero.addr as B2CRecipient), country: xero.addr.country || 'Australia' };
    recipient_source = 'Xero contact (BILLING address — no ShipBob delivery on file, so confirm before sending)';
    warnings.push('⚠️ No delivered ShipBob address for this recipient — using Xero, which is billing data. Confirm the ship-to with the user first.');
  }
  if (input.address?.address1) {
    recipient = { ...(recipient || {} as B2CRecipient), ...(input.address as B2CRecipient) };
    recipient_source = 'supplied in the request';
  }
  if (recipient && xero?.email && !recipient.email) recipient.email = xero.email;

  // 2) Items — must exist at the site, and be in stock
  const skus = input.items.map((i) => i.sku.toUpperCase());
  const { data: rows } = await supabaseLogistics.from('v_stock_current')
    .select('sku, name, available, unit_size_g').eq('location_code', site).in('sku', skus);
  const bySku = new Map((rows ?? []).map((r: any) => [String(r.sku).toUpperCase(), r]));
  const { data: pls } = await supabaseLogistics.from('product_locations')
    .select('shipbob_inventory_id, products(sku), location:location_id(code)');
  const invBySku = new Map(((pls ?? []) as any[])
    .filter((r) => String(r.location?.code || '').toUpperCase() === site)
    .map((r) => [String(r.products?.sku || '').toUpperCase(), r.shipbob_inventory_id]));

  const items: DirectOrderPlan['items'] = input.items.map((i) => {
    const sku = i.sku.toUpperCase();
    const r: any = bySku.get(sku);
    const available = Number(r?.available) || 0;
    const kg = ((Number(r?.unit_size_g) || 0) / 1000) * i.quantity;
    if (!r) warnings.push(`🛑 ${sku} isn't stocked at ${site} — check the SKU.`);
    // NB: a snapshot shortfall is NOT warned here — the live lot check below supersedes it.
    return { sku, name: r?.name || sku, quantity: i.quantity, available, enough: !!r && available >= i.quantity, kg: Math.round(kg * 10) / 10 };
  });

  const total_units = items.reduce((s, i) => s + i.quantity, 0);
  const total_kg = Math.round(items.reduce((s, i) => s + i.kg, 0) * 10) / 10;

  // Which fulfilment path this belongs on. Bulk drops to a business go down the B2B pick.
  const bulk = total_kg > PARCEL_KG_LIMIT || total_units > PARCEL_UNIT_LIMIT;
  const path: FulfilPath = input.path || (bulk ? 'B2B' : 'B2C');
  const path_reason = input.path
    ? `caller specified ${input.path}`
    : bulk
      ? `${total_units} units / ~${total_kg}kg — over the ${PARCEL_UNIT_LIMIT}-unit / ${PARCEL_KG_LIMIT}kg parcel threshold, so this is a bulk drop`
      : `${total_units} units / ~${total_kg}kg — small enough for the normal retail parcel pick`;
  const can_create_via_api = true;   // both paths are API-creatable; `path` picks the endpoint

  // Lot picks — the one part of the manual flow that genuinely needs data, since the UI makes
  // you choose a lot per SKU. One lot if it covers the qty, else oldest first (Luke's rule).
  const fcName = site === 'MANCHESTER' ? 'Manchester' : 'Altona VIC';
  const international = !!recipient?.country && !/^(au|australia)$/i.test(String(recipient.country).trim());
  for (const it of items) {
    const invId = Number(invBySku.get(it.sku));
    if (!invId) continue;
    const lots = await getInventoryLots(site, invId).catch(() => []);
    if (!lots.length) continue;
    // ShipBob's lots are LIVE; v_stock_current is a periodic snapshot and was reading 116 for
    // BM80 while ShipBob held 1,494 fulfillable. Trust the live number for the go/no-go, or a
    // stale snapshot blocks a perfectly shippable order.
    const live = lots.reduce((sum, l) => sum + l.qty, 0);
    if (live !== it.available) {
      if (live >= it.quantity && !it.enough) {
        warnings.push(`ℹ️ ${it.sku}: our snapshot said ${it.available} but ShipBob has ${live} fulfillable right now — going with ShipBob's live figure.`);
      } else if (live < it.quantity) {
        warnings.push(`⚠️ ${it.sku}: ShipBob has ${live} fulfillable live (snapshot said ${it.available}), need ${it.quantity}.`);
      }
      it.available = live; it.enough = live >= it.quantity;
    }
    const { picks, shortfall, single } = pickLotsFifo(lots, it.quantity);
    it.lots = picks;
    it.lot_note = single
      ? `one lot covers it: ${picks[0].lot_number} (BB ${picks[0].expiration_date}, ${picks[0].of} on hand)`
      : `no single lot covers ${it.quantity} — oldest first: ${picks.map((l) => `${l.take}× ${l.lot_number} (BB ${l.expiration_date})`).join(' + ')}`;
    if (shortfall > 0) warnings.push(`⚠️ ${it.sku}: lots only cover ${it.quantity - shortfall} of ${it.quantity}.`);
  }

  const place_in_shipbob = path === 'B2C' ? undefined : {
    where: `Will be created as a B2B order at ShipBob ${fcName} — these are the settings it will use:`,
    steps: [
      '1. How to ship: FREIGHT (they palletise). Parcel is only for a box or two.'
        + (international ? ' NOTE: ShipBob does NOT support international freight — check before relying on this.' : ''),
      `2. Pay for shipping: ${input.payment_term === 'MerchantResponsible' ? 'WE UPLOAD OUR OWN LABEL (MerchantResponsible) — as on Maersk transfers' : 'SHIPBOB BUYS (Prepaid — the default)'}`,
      `3. Packing instructions: NOT sent (no API field). ShipBob case-pick by default.${international ? ' This one is INTERNATIONAL — add "PLEASE PALLETISE TO STANDARD FOR INTERNATIONAL SEA FREIGHT" in the UI yourself, and note ShipBob does not support international freight.' : ''}`,
      `4. Fulfillment centre: ${fcName}. Then add each item WITH ITS LOT:`,
      ...items.map((i) => `     ${i.quantity}× ${i.sku} (${i.name})${i.lot_note ? ` — ${i.lot_note}` : ' — no lot data, pick oldest'}`),
      `5. Reserve inventory: same day — the API has no reservation-date field, so it starts processing on creation.${input.reserve_note ? ` YOU ASKED TO DELAY (${input.reserve_note}) — that has to be set in the UI, or hold off creating this until you're ready.` : ''}`,
      recipient
        ? `   Ship to: ${recipient.name} — ${[recipient.address1, recipient.address2, recipient.city, recipient.state, recipient.zip_code, recipient.country].filter(Boolean).join(', ')}`
        : '   Ship to: ASK — no address on file',
      `   Reference: ${input.reference || '(set one, e.g. TPP-SAMPLE-GOODNESSME)'}`,
    ],
  };

  if (input.reserve_note) {
    warnings.push(`⏳ You asked to delay the inventory reservation (${input.reserve_note}), but the order API has no reservation-date field — it starts processing as soon as it's created. Either set the date in the UI or wait to create it.`);
  }
  if (path === 'B2B') {
    warnings.push(`📦 This will go on ShipBob's B2B pick (freight, ${input.payment_term === 'MerchantResponsible' ? 'we upload our own label' : 'ShipBob buys the freight'}) — a different fulfilment path from the retail parcel one. Confirm the settings above before I create it.`);
  }
  if (!recipient) warnings.push('🛑 No ship-to address found — ask for the contact name and full address.');

  for (const i of items) if (!i.enough && !warnings.some((w) => w.includes(`${i.sku}:`))) {
    warnings.push(`⚠️ ${i.sku}: only ${i.available} available at ${site}, need ${i.quantity}.`);
  }
  const ready = !!recipient && items.every((i) => i.enough) && items.length > 0;
  const summary = [
    `${input.recipient_name} — ${total_units} units (~${total_kg}kg) from ${site}`,
    ...items.map((i) => `• ${i.name} (${i.sku}) ×${i.quantity}${i.enough ? '' : ` ⚠️ only ${i.available} on hand`}`),
    recipient ? `Ship to: ${[recipient.name, recipient.address1, recipient.address2, recipient.city, recipient.state, recipient.zip_code].filter(Boolean).join(', ')}` : 'Ship to: UNKNOWN',
    `Address source: ${recipient_source}`,
    `Fulfilment path: ${path} — ${path_reason}`,
    ...(warnings.length ? ['', ...warnings] : []),
  ].join('\n');

  return { recipient, recipient_source, items, total_units, total_kg, path, path_reason, can_create_via_api, place_in_shipbob, warnings, ready, summary };
}

/** Create it for real. Only after the user has seen a plan and approved it. */
export async function createDirectOrder(input: {
  recipient_name: string;
  items: DirectOrderItem[];
  site?: string;
  address?: Partial<B2CRecipient>;
  reference?: string;
  boxes?: { sku: string; quantity: number }[];
  path?: FulfilPath;
  payment_term?: 'Prepaid' | 'MerchantResponsible';
}): Promise<{ ok: true; order_id: number; reference: string; verified: Record<string, unknown> | null; plan: DirectOrderPlan }
  | { error: string; plan?: DirectOrderPlan }> {
  const site = input.site || 'ALTONA';
  const plan = await planDirectOrder(input);
  if (!plan.recipient) return { error: 'No ship-to address — ask for the contact name and full address first.' };

  const short = plan.items.filter((i) => !i.enough);
  if (short.length) return { error: `Not enough stock at ${site}: ${short.map((i) => `${i.sku} (need ${i.quantity}, have ${i.available})`).join('; ')}. Confirm with the user before overriding.` };

  const reference = input.reference || `TPP-SAMPLE-${Date.now().toString().slice(-8)}`;
  try {
    // Route to the pick the plan chose. Not interchangeable: B2B is a different physical
    // process, so a bulk drop must never fall back to the D2C endpoint on error.
    const order = plan.path === 'B2B'
      ? await createB2BOrder({
        site, reference, recipient: plan.recipient,
        purchase_order_number: input.reference,
        carrier_type: 'Freight',
        payment_term: input.payment_term || 'Prepaid',
        // One required_lot per line, so a quantity spanning lots becomes several lines.
        products: plan.items.flatMap((i) => (
          i.lots?.length
            ? i.lots.map((l) => ({ reference_id: i.sku, quantity: l.take, lot_number: l.lot_number, lot_date: l.expiration_date }))
            : [{ reference_id: i.sku, quantity: i.quantity }]
        )),
      })
      : await createB2COrder({
        site, reference, recipient: plan.recipient,
        products: [
          ...plan.items.map((i) => ({ reference_id: i.sku, quantity: i.quantity })),
          ...(input.boxes ?? []).map((b) => ({ reference_id: b.sku, quantity: b.quantity })),
        ],
      });
    // Report what ShipBob SAVED, not what we asked for — same discipline as the wholesale flow.
    let verified: Record<string, unknown> | null = null;
    try {
      const saved = await getB2COrder(site, order.id);
      if (saved) verified = {
        products: (saved.products || []).map((p: any) => `${p.quantity ?? 1}× ${p.reference_id}`),
        recipient: saved.recipient?.name,
        address: [saved.recipient?.address?.address1, saved.recipient?.address?.address2, saved.recipient?.address?.city, saved.recipient?.address?.zip_code].filter(Boolean).join(', '),
        status: saved.status,
        // Did ShipBob keep the B2B path and the lots? required_lot is in the 2026-01 schema but
        // isn't in the orders guide, so it gets CHECKED rather than assumed on every order.
        order_type: saved.type ?? '(not returned)',
        shipping_terms: saved.shipping_terms ?? '(not returned)',
        lots_applied: (saved.products || []).some((p: any) => p.required_lot || p.lot_number) ? 'yes' : 'NOT VISIBLE on the saved order — check the lots in ShipBob',
      };
    } catch { /* verification best-effort */ }
    return { ok: true, order_id: order.id, reference, verified, plan };
  } catch (e) {
    return { error: `ShipBob order failed: ${String(e).slice(0, 220)}` };
  }
}
