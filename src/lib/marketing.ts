// Marketing: influencer gifting (ShipBob B2C) + collab tracking.
import { supabaseLogistics } from './supabase-logistics';
import { createB2COrder, getOrderTracking, getInventoryLevels, type B2CRecipient, getB2COrder } from './shipbob';
import { countersForSkuLines, selectBox } from './boxLogic';

// LIVE ShipBob fulfillable for a SKU at a site (not the once-a-day v_stock_current snapshot).
// Returns null only if we can't resolve the inventory id / ShipBob doesn't answer.
export async function liveAvailable(site: string, sku: string): Promise<number | null> {
  const { data } = await supabaseLogistics
    .from('products').select('id, product_locations(shipbob_inventory_id, active, location:location_id(code))')
    .eq('sku', sku).maybeSingle();
  const locs = ((data as any)?.product_locations ?? []) as any[];
  const inv = locs.find((l) => l.active && (l.location?.code || '').toUpperCase() === site.toUpperCase())?.shipbob_inventory_id;
  if (!inv) return null;
  const levels = await getInventoryLevels(site, [Number(inv)]).catch(() => new Map());
  const lvl = levels.get(Number(inv));
  return lvl ? lvl.fulfillable : null;
}

export const INFLUENCER_STATUSES = ['order_processing', 'shipped', 'delivered', 'completed'] as const;
export const COLLAB_STATUSES = ['planned', 'samples_incoming', 'active', 'completed', 'cancelled'] as const;

function regionFromCountry(c?: string): string {
  const t = (c || '').toUpperCase().trim();
  if (['AU', 'AUS', 'AUSTRALIA'].includes(t)) return 'AU';
  if (['NZ', 'NEW ZEALAND'].includes(t)) return 'NZ';
  if (['UK', 'GB', 'UNITED KINGDOM', 'ENGLAND', 'SCOTLAND', 'WALES'].includes(t)) return 'UK';
  if (['US', 'USA', 'UNITED STATES', 'AMERICA'].includes(t)) return 'USA';
  return 'OTHER';
}
// Which ShipBob warehouse ships to a country: AU + NZ from Altona, UK from Manchester.
// Anything else must be specified explicitly (returns null → caller asks).
export function siteFromCountry(c?: string): string | null {
  const r = regionFromCountry(c);
  if (r === 'AU' || r === 'NZ') return 'ALTONA';
  if (r === 'UK') return 'MANCHESTER';
  return null;
}

async function resolveSku(flavour: string, size_g: number): Promise<{ sku: string; label: string; cogs: number | null } | null> {
  const { data } = await supabaseLogistics.from('products')
    .select('sku, flavour, unit_size_g, cogs').eq('active', true).eq('unit_size_g', size_g);
  const f = flavour.toLowerCase().trim();
  const hit = (data ?? []).find((p: any) => (p.flavour || '').toLowerCase() === f)
    || (data ?? []).find((p: any) => (p.flavour || '').toLowerCase().includes(f) || f.includes((p.flavour || '').toLowerCase()));
  if (!hit) return null;
  const sz = size_g >= 1000 ? `${size_g / 1000}kg` : `${size_g}g`;
  return { sku: hit.sku, label: `${hit.flavour} ${sz}`, cogs: hit.cogs ?? null };
}

export interface GiftInput {
  name: string; handle?: string; followers?: number; email?: string;
  address1: string; address2?: string; city: string; state?: string; zip_code: string; country: string;
  flavour?: string; size_g?: number; qty?: number;               // single-product shorthand
  items?: { flavour: string; size_g: number; qty?: number }[];   // multi-product: EVERY product in the instruction, one shipment
  site?: string; aliases?: string; force?: boolean;
}

// Create the ShipBob gifting order AND save the influencer to the dashboard.
export async function sendInfluencerGift(input: GiftInput):
  Promise<{ ok: true; order_id: number; summary: string; box: string; sku: string; verified: Record<string, unknown> | null; dashboard_logged: boolean } | { needs: string[]; note: string } | { oos: true; sku: string; label: string; available: number; site: string; note: string } | { error: string }> {
  // Multi-product: `items` lists every product in Kate's instruction ("1x 520g salted caramel
  // and 1x 520g buttermilk" = 2 lines, ONE shipment). Single flavour/size/qty stays supported.
  // Partial orders were shipping before this (only the first product went out — Amanda E.).
  const lines = (input.items?.length
    ? input.items
    : [{ flavour: input.flavour || '', size_g: input.size_g || 0, qty: input.qty }]
  ).map((l) => ({ flavour: (l.flavour || '').trim(), size_g: Number(l.size_g) || 0, qty: l.qty && l.qty > 0 ? Math.round(l.qty) : 1 }));

  // FINAL VALIDATION — never create a ShipBob order or influencer record with missing fields.
  // (ShipBob silently rejects addresses with no state/postcode; a missing handle was creating
  // half-formed creator records.) Collect everything missing and ask Kate before doing anything.
  const needs: string[] = [];
  if (!input.name?.trim()) needs.push('name');
  if (!input.address1?.trim()) needs.push('street address');
  if (!input.city?.trim()) needs.push('city/suburb');
  if (!input.state?.trim()) needs.push('state (e.g. NSW)');
  if (!input.zip_code?.trim()) needs.push('postcode');
  if (!input.country?.trim()) needs.push('country');
  if (lines.some((l) => !l.flavour)) needs.push('flavour');
  if (lines.some((l) => !l.size_g)) needs.push('size');
  if (!input.handle?.trim() && !input.force) needs.push('Instagram handle');
  if (needs.length) {
    return { needs, note: `Can't send yet — missing ${needs.join(', ')}. Ask Kate for ${needs.length > 1 ? 'these' : 'this'} before creating anything. (If the creator genuinely has no Instagram handle, Kate can say "no handle, send anyway" and you call again with force:true.)` };
  }

  // site: explicit override, else inferred from the address country (AU/NZ→Altona,
  // UK→Manchester). Other countries must be specified.
  const site = (input.site || siteFromCountry(input.country) || '').toUpperCase();
  if (!site) return { error: `Which warehouse should I ship from for ${input.country || 'this country'}? (reply "from AU" or "from UK")` };
  const prods: { sku: string; label: string; cogs: number | null; qty: number; size_g: number }[] = [];
  for (const l of lines) {
    const prod = await resolveSku(l.flavour, l.size_g);
    if (!prod) return { error: `Couldn't match "${l.flavour} ${l.size_g}g" to a product SKU.` };
    prods.push({ ...prod, qty: l.qty, size_g: l.size_g });
  }

  // Stock check — LIVE from ShipBob (not the daily snapshot), so a fresh restock is seen
  // immediately. Falls back to the snapshot only if ShipBob can't be reached. If OOS, return
  // for Kate's call AND echo the creator details so a "swap flavour" reuses them (no re-asking).
  if (!input.force) {
    for (const prod of prods) {
      let available = await liveAvailable(site, prod.sku);
      if (available == null) {
        const { data: stock } = await supabaseLogistics.from('v_stock_current')
          .select('available').eq('location_code', site).eq('sku', prod.sku).maybeSingle();
        available = Number((stock as any)?.available ?? 0);
      }
      if (available < prod.qty) {
        const sz = prod.size_g >= 1000 ? `${prod.size_g / 1000}kg` : `${prod.size_g}g`;
        const who = `${input.name}${input.handle ? ` (${input.handle})` : ''} — ${[input.address1, input.city, input.state, input.zip_code, input.country].filter(Boolean).join(', ')}${input.email ? `, ${input.email}` : ''}`;
        return { oos: true, sku: prod.sku, label: prod.label, available, site,
          note: `${prod.label} is OUT OF STOCK at ${site} (live: ${available} available)${prods.length > 1 ? ` — the other item(s) in this gift are fine, but nothing was created` : ''}. KEEP THESE CREATOR DETAILS for this gift — do NOT re-ask for them: ${who}. Ask Kate: (1) load it anyway — backorder, auto-fulfils on restock, or (2) swap to another ${sz} flavour. Then call send_influencer_gift again with the SAME creator details + ALL items, using force:true (to proceed) OR the swapped flavour.` };
      }
    }
  }

  // Box from the master box-logic spec (smallest box that genuinely fits) — the old shortcut
  // shipped 3× 520g in a PANXLARGE (spec: PANMEDIUM) and paid the size difference every time.
  const { counters } = countersForSkuLines(prods.map((p2) => ({ sku: p2.sku, size_g: p2.size_g, qty: p2.qty })));
  const box = selectBox(counters);

  const recipient: B2CRecipient = {
    name: input.name, email: input.email, address1: input.address1, address2: input.address2,
    city: input.city, state: input.state, zip_code: input.zip_code, country: input.country,
  };
  const reference = `TPP-INF-${Date.now()}`;
  let order;
  try {
    order = await createB2COrder({
      site, reference, recipient,
      products: [...prods.map((p2) => ({ reference_id: p2.sku, quantity: p2.qty })), { reference_id: box, quantity: 1 }],
    });
  } catch (e) {
    return { error: `ShipBob order failed: ${String(e).slice(0, 160)}` };
  }

  // Verify against the SAVED order, not our intent — the agent reports what ShipBob actually
  // stored (every product line, address incl. unit/door-code line). Kate's rule: never say
  // "Done" about anything not confirmed on the final order.
  let verified: Record<string, unknown> | null = null;
  try {
    const saved = await getB2COrder(site, order.id);
    if (saved) {
      verified = {
        products_on_order: (saved.products || []).map((p2: any) => `${p2.quantity ?? 1}× ${p2.reference_id}`),
        recipient: saved.recipient?.name,
        address1: saved.recipient?.address?.address1,
        address2: saved.recipient?.address?.address2 || null,
        city_zip: `${saved.recipient?.address?.city ?? ''} ${saved.recipient?.address?.zip_code ?? ''}`.trim(),
        status: saved.status,
      };
    }
  } catch { /* verification is best-effort; agent falls back to the request summary */ }

  const itemsLabel = prods.map((p2) => `${p2.qty}× ${p2.label}`).join(' + ');
  const summary = `${itemsLabel} + 1× ${box} box → ${input.name}${input.handle ? ` (${input.handle})` : ''}, ${input.city} ${input.country}. ShipBob order #${order.id}.`;
  const totalCogs = prods.every((p2) => p2.cogs == null) ? null
    : Math.round(prods.reduce((s2, p2) => s2 + (p2.cogs || 0) * p2.qty, 0) * 100) / 100;
  const { error: logErr } = await supabaseLogistics.from('influencers').insert({
    name: input.name, handle: input.handle || null, followers: input.followers || null, email: input.email || null,
    address: [input.address1, input.address2, input.city, input.state, input.zip_code, input.country].filter(Boolean).join(', '),
    flavour_sent: itemsLabel, sent_from: site, region: regionFromCountry(input.country),
    date_initiated: new Date().toISOString().slice(0, 10), post_type: 'None',
    shipbob_order_id: String(order.id), order_summary: summary, status: 'order_processing',
    cost_cogs: totalCogs,
    cost_currency: site === 'MANCHESTER' ? 'GBP' : 'AUD', aliases: input.aliases || null,
  });
  return { ok: true, order_id: order.id, summary, box, sku: prods[0].sku, verified, dashboard_logged: !logErr };
}

// Look up a known/repeat influencer by name, handle, or registered alias (e.g. "regina"
// → regs_healthy_eats). Returns their saved details so we can re-gift without re-asking.
export async function findInfluencer(query: string):
  Promise<{ name: string; handle: string | null; email: string | null; address: string | null; region: string | null; sent_from: string | null; aliases: string | null; followers: number | null } | null> {
  const q = query.replace(/^@/, '').toLowerCase().trim();
  if (!q) return null;
  const { data } = await supabaseLogistics.from('influencers')
    .select('name, handle, email, address, region, sent_from, aliases, followers, date_initiated')
    .order('date_initiated', { ascending: false, nullsFirst: false });
  const rows = (data ?? []) as any[];
  // exact-ish match on name/handle/alias, else contains
  const hit = rows.find((r) => [r.name, r.handle, ...String(r.aliases || '').split(',')].some((v) => (v || '').toLowerCase().replace(/^@/, '').trim() === q))
    || rows.find((r) => (r.name || '').toLowerCase().includes(q) || (r.handle || '').toLowerCase().includes(q) || String(r.aliases || '').toLowerCase().includes(q));
  if (!hit) return null;
  // prefer the most complete address among that person's rows (match by handle or name)
  const same = rows.filter((r) => (hit.handle && r.handle === hit.handle) || (!hit.handle && r.name === hit.name));
  const withAddr = same.find((r) => r.address) || hit;
  return { name: hit.name, handle: hit.handle, email: hit.email || withAddr.email, address: withAddr.address, region: hit.region, sent_from: hit.sent_from, aliases: hit.aliases, followers: hit.followers };
}

export async function setInfluencerAlias(nameOrHandle: string, alias: string): Promise<{ ok: true; name: string } | { error: string }> {
  const q = nameOrHandle.replace(/^@/, '').trim();
  const { data } = await supabaseLogistics.from('influencers')
    .select('id, name, handle, aliases').or(`name.ilike.%${q}%,handle.ilike.%${q}%`).order('date_initiated', { ascending: false }).limit(1).maybeSingle() as any;
  if (!data) return { error: `No influencer matching "${nameOrHandle}".` };
  const a = alias.toLowerCase().trim();
  const existing = String(data.aliases || '').split(',').map((x: string) => x.trim()).filter(Boolean);
  if (!existing.includes(a)) existing.push(a);
  const aliases = existing.join(', ');
  // apply to all rows for this person (so re-gifts keep the alias)
  if (data.handle) await supabaseLogistics.from('influencers').update({ aliases }).eq('handle', data.handle);
  else await supabaseLogistics.from('influencers').update({ aliases }).eq('id', data.id);
  return { ok: true, name: data.name };
}

// Fix/complete an influencer's details after the fact (surname arrived later, email was in a
// second screenshot, wrong address line…). This capability GAP is what made the agent claim
// "record updated" without any tool to actually do it — a hallucinated success (Katrina Lander,
// Jul 2026). Matches by name/handle/alias; applies to the person's latest row.
export async function updateInfluencerDetails(nameOrHandle: string, fields: {
  name?: string; email?: string; handle?: string; followers?: number; address?: string; notes?: string;
}): Promise<{ ok: true; name: string; updated: Record<string, string | number> } | { error: string }> {
  const q = nameOrHandle.replace(/^@/, '').trim();
  const { data } = await supabaseLogistics.from('influencers')
    .select('id, name, handle, aliases').or(`name.ilike.%${q}%,handle.ilike.%${q}%,aliases.ilike.%${q}%`)
    .order('date_initiated', { ascending: false }).limit(1).maybeSingle() as any;
  if (!data) return { error: `No influencer matching "${nameOrHandle}".` };
  const patch: Record<string, any> = {};
  if (fields.name?.trim()) patch.name = fields.name.trim();
  if (fields.email?.trim()) patch.email = fields.email.trim();
  if (fields.handle?.trim()) patch.handle = fields.handle.trim().startsWith('@') ? fields.handle.trim() : `@${fields.handle.trim()}`;
  if (fields.followers != null && Number(fields.followers) > 0) patch.followers = Number(fields.followers);
  if (fields.address?.trim()) patch.address = fields.address.trim();
  if (fields.notes?.trim()) patch.notes = fields.notes.trim();
  if (!Object.keys(patch).length) return { error: 'Nothing to update — pass at least one of name/email/handle/followers/address/notes.' };
  patch.updated_at = new Date().toISOString();
  const { error } = await supabaseLogistics.from('influencers').update(patch).eq('id', data.id);
  if (error) return { error: error.message };
  const { updated_at: _drop, ...updated } = patch;
  return { ok: true, name: patch.name || data.name, updated };
}

export async function updateInfluencerStatus(nameOrHandle: string, status: string):
  Promise<{ ok: true; name: string; status: string } | { error: string }> {
  if (!INFLUENCER_STATUSES.includes(status as any)) return { error: `Invalid status. Use one of: ${INFLUENCER_STATUSES.join(', ')}` };
  const q = nameOrHandle.replace(/^@/, '');
  const { data } = await supabaseLogistics.from('influencers')
    .select('id, name').or(`name.ilike.%${q}%,handle.ilike.%${q}%`).order('created_at', { ascending: false }).limit(1).maybeSingle() as any;
  if (!data) return { error: `No influencer matching "${nameOrHandle}".` };
  await supabaseLogistics.from('influencers').update({ status, updated_at: new Date().toISOString() }).eq('id', data.id);
  return { ok: true, name: data.name, status };
}

// Pull ShipBob tracking for in-flight gifts; advance order_processing → shipped when a label exists.
export async function refreshInfluencerTracking(): Promise<{ updated: number }> {
  const { data } = await supabaseLogistics.from('influencers')
    .select('id, shipbob_order_id, sent_from, status, tracking_number')
    .not('shipbob_order_id', 'is', null).in('status', ['order_processing', 'shipped']);
  let updated = 0;
  for (const inf of (data ?? []) as any[]) {
    const t = await getOrderTracking(inf.sent_from || 'ALTONA', Number(inf.shipbob_order_id));
    if (!t) continue;
    const patch: any = {};
    if (t.tracking_number && t.tracking_number !== inf.tracking_number) {
      patch.tracking_number = t.tracking_number; patch.tracking_url = t.tracking_url; patch.carrier = t.carrier;
      if (inf.status === 'order_processing') patch.status = 'shipped';
    }
    if (Object.keys(patch).length) { patch.updated_at = new Date().toISOString(); await supabaseLogistics.from('influencers').update(patch).eq('id', inf.id); updated++; }
  }
  return { updated };
}

export async function listInfluencers() {
  const [{ data }, { data: costs }] = await Promise.all([
    supabaseLogistics.from('influencers').select('*').order('date_initiated', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
    supabaseLogistics.from('shipment_costs').select('shipbob_order_id, cost'),
  ]);
  const fulfilByOrder = new Map<string, number>();
  for (const c of (costs ?? []) as any[]) if (c.shipbob_order_id) fulfilByOrder.set(String(c.shipbob_order_id), Number(c.cost) || 0);
  return (data ?? []).map((i: any) => {
    const cogs = i.cost_cogs != null ? Number(i.cost_cogs) : null;
    const ful = i.shipbob_order_id ? fulfilByOrder.get(String(i.shipbob_order_id)) ?? null : null;
    const parcel_cost = (cogs != null || ful != null) ? Math.round(((cogs || 0) + (ful || 0)) * 100) / 100 : null;
    return { ...i, cost_fulfilment: ful, parcel_cost };
  });
}

// Top-of-page analytics: monthly send rate + average parcel cost (COGS + fulfilment).
export async function influencerAnalytics() {
  const all = await listInfluencers() as any[];
  // fulfilment cost per order (ShipBob invoice_amount), joined by order id
  const { data: costs } = await supabaseLogistics.from('shipment_costs').select('shipbob_order_id, cost, currency');
  const fulfilByOrder = new Map<string, { cost: number; currency: string }>();
  for (const c of (costs ?? []) as any[]) if (c.shipbob_order_id) fulfilByOrder.set(String(c.shipbob_order_id), { cost: Number(c.cost) || 0, currency: c.currency });

  // 12-month rolling send graph (by date_initiated)
  const now = new Date();
  const months: { label: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: d.toLocaleDateString('en-AU', { month: 'short' }), count: 0 });
  }
  const monthIndex = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    const diff = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    return diff >= 0 && diff <= 11 ? 11 - diff : -1;
  };
  let sentLast12 = 0;
  for (const i of all) {
    if (!i.date_initiated) continue;
    const idx = monthIndex(i.date_initiated);
    if (idx >= 0) { months[idx].count++; sentLast12++; }
  }
  const avgPerMonth = Math.round((sentLast12 / 12) * 10) / 10;

  // average parcel cost = COGS (captured at send) + fulfilment (from ShipBob)
  let cogsSum = 0, cogsN = 0, fulSum = 0, fulN = 0, parcelSum = 0, parcelN = 0;
  for (const i of all) {
    const cogs = i.cost_cogs != null ? Number(i.cost_cogs) : null;
    const ful = i.shipbob_order_id ? fulfilByOrder.get(String(i.shipbob_order_id))?.cost ?? null : null;
    if (cogs != null) { cogsSum += cogs; cogsN++; }
    if (ful != null) { fulSum += ful; fulN++; }
    if (cogs != null || ful != null) { parcelSum += (cogs || 0) + (ful || 0); parcelN++; }
  }
  const avg = (s: number, n: number) => (n ? Math.round((s / n) * 100) / 100 : null);

  return {
    total: all.length, sentLast12, avgPerMonth, months,
    avg_cogs: avg(cogsSum, cogsN), avg_fulfilment: avg(fulSum, fulN), avg_parcel: avg(parcelSum, parcelN),
    costed_count: parcelN, fulfilment_count: fulN,
  };
}

// "Most likely to post next" = shipped/delivered, longest since they got stock, not yet posted.
export async function likelyToPost(limit = 5) {
  const all = await listInfluencers();
  const now = Date.now();
  return all
    .filter((i: any) => ['shipped', 'delivered'].includes(i.status) && i.date_initiated)
    .map((i: any) => ({ name: i.name, handle: i.handle, flavour: i.flavour_sent, received: i.date_initiated, status: i.status, days_since: Math.round((now - new Date(i.date_initiated + 'T00:00:00').getTime()) / 86400_000) }))
    .sort((a, b) => b.days_since - a.days_since)
    .slice(0, limit);
}

// ---- Collabs ----
export interface CollabInput {
  partner_name: string; handle?: string; email?: string; address?: string;
  collab_type?: string; due_date?: string; expecting_samples?: boolean; sample_qty?: number;
  description?: string; status?: string;
}
export async function saveCollab(input: CollabInput): Promise<{ ok: true; partner: string } | { error: string }> {
  if (!input.partner_name) return { error: 'Need the partner/business name.' };
  // update existing partner (by name) or insert new
  const { data: existing } = await supabaseLogistics.from('collabs')
    .select('id').ilike('partner_name', input.partner_name).limit(1).maybeSingle() as any;
  const row: any = {
    partner_name: input.partner_name, handle: input.handle ?? null, email: input.email ?? null, address: input.address ?? null,
    collab_type: input.collab_type ?? null, due_date: input.due_date ?? null,
    expecting_samples: input.expecting_samples ?? false, sample_qty: input.sample_qty ?? null,
    title: input.description ?? null, status: input.status || (input.expecting_samples ? 'samples_incoming' : 'planned'),
    updated_at: new Date().toISOString(),
  };
  if (existing) { await supabaseLogistics.from('collabs').update(row).eq('id', existing.id); }
  else { await supabaseLogistics.from('collabs').insert(row); }
  return { ok: true, partner: input.partner_name };
}
export async function updateCollab(partner: string, fields: Partial<CollabInput> & { samples_received?: boolean }):
  Promise<{ ok: true; partner: string } | { error: string }> {
  const { data } = await supabaseLogistics.from('collabs').select('id, partner_name').ilike('partner_name', `%${partner}%`).limit(1).maybeSingle() as any;
  if (!data) return { error: `No collab matching "${partner}".` };
  await supabaseLogistics.from('collabs').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', data.id);
  return { ok: true, partner: data.partner_name };
}
export async function listCollabs() {
  const { data } = await supabaseLogistics.from('collabs').select('*').order('due_date', { ascending: true, nullsFirst: false });
  return data ?? [];
}
