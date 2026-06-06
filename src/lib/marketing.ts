// Marketing: influencer gifting (ShipBob B2C) + collab tracking.
import { supabaseLogistics } from './supabase-logistics';
import { createB2COrder, getOrderTracking, type B2CRecipient } from './shipbob';

export const INFLUENCER_STATUSES = ['order_processing', 'shipped', 'delivered', 'posted', 'completed'] as const;
export const COLLAB_STATUSES = ['planned', 'samples_incoming', 'active', 'completed', 'cancelled'] as const;

function regionFromCountry(c?: string): string {
  const t = (c || '').toUpperCase().trim();
  if (['AU', 'AUS', 'AUSTRALIA'].includes(t)) return 'AU';
  if (['NZ', 'NEW ZEALAND'].includes(t)) return 'NZ';
  if (['UK', 'GB', 'UNITED KINGDOM', 'ENGLAND', 'SCOTLAND', 'WALES'].includes(t)) return 'UK';
  if (['US', 'USA', 'UNITED STATES', 'AMERICA'].includes(t)) return 'USA';
  return 'OTHER';
}

// 520g bags: 1–2 fit PANSMALL (the common case); more → a larger outer.
function boxForGift(size_g: number, qty: number): string {
  if (size_g === 520 && qty <= 2) return 'PANSMALL';
  if (qty <= 2) return 'PANSMALL';
  return 'PANXLARGE';
}

async function resolveSku(flavour: string, size_g: number): Promise<{ sku: string; label: string } | null> {
  const { data } = await supabaseLogistics.from('products')
    .select('sku, flavour, unit_size_g').eq('active', true).eq('unit_size_g', size_g);
  const f = flavour.toLowerCase().trim();
  const hit = (data ?? []).find((p: any) => (p.flavour || '').toLowerCase() === f)
    || (data ?? []).find((p: any) => (p.flavour || '').toLowerCase().includes(f) || f.includes((p.flavour || '').toLowerCase()));
  if (!hit) return null;
  const sz = size_g >= 1000 ? `${size_g / 1000}kg` : `${size_g}g`;
  return { sku: hit.sku, label: `${hit.flavour} ${sz}` };
}

export interface GiftInput {
  name: string; handle?: string; followers?: number; email?: string;
  address1: string; address2?: string; city: string; state?: string; zip_code: string; country: string;
  flavour: string; size_g: number; qty?: number; site?: string;
}

// Create the ShipBob gifting order AND save the influencer to the dashboard.
export async function sendInfluencerGift(input: GiftInput):
  Promise<{ ok: true; order_id: number; summary: string; box: string; sku: string } | { error: string }> {
  const qty = input.qty && input.qty > 0 ? input.qty : 1;
  const site = (input.site || 'ALTONA').toUpperCase();
  const prod = await resolveSku(input.flavour, input.size_g);
  if (!prod) return { error: `Couldn't match "${input.flavour} ${input.size_g}g" to a product SKU.` };
  const box = boxForGift(input.size_g, qty);

  const recipient: B2CRecipient = {
    name: input.name, email: input.email, address1: input.address1, address2: input.address2,
    city: input.city, state: input.state, zip_code: input.zip_code, country: input.country,
  };
  const reference = `TPP-INF-${Date.now()}`;
  let order;
  try {
    order = await createB2COrder({
      site, reference, recipient,
      products: [{ reference_id: prod.sku, quantity: qty }, { reference_id: box, quantity: 1 }],
    });
  } catch (e) {
    return { error: `ShipBob order failed: ${String(e).slice(0, 160)}` };
  }

  const summary = `${qty}× ${prod.label} (${prod.sku}) + 1× ${box} box → ${input.name}${input.handle ? ` (${input.handle})` : ''}, ${input.city} ${input.country}. ShipBob order #${order.id}.`;
  await supabaseLogistics.from('influencers').insert({
    name: input.name, handle: input.handle || null, followers: input.followers || null, email: input.email || null,
    address: [input.address1, input.address2, input.city, input.state, input.zip_code, input.country].filter(Boolean).join(', '),
    flavour_sent: `${qty}× ${prod.label}`, sent_from: site, region: regionFromCountry(input.country),
    date_initiated: new Date().toISOString().slice(0, 10), post_type: 'None',
    shipbob_order_id: String(order.id), order_summary: summary, status: 'order_processing',
  });
  return { ok: true, order_id: order.id, summary, box, sku: prod.sku };
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
  const { data } = await supabaseLogistics.from('influencers').select('*').order('date_initiated', { ascending: false, nullsFirst: false });
  return data ?? [];
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
