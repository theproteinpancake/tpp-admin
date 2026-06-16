// VISY packaging orders, initiated from the WhatsApp agent.
//  SRP cartons / ABC-line packaging → email to Amanda, deliver to ABC Blending (no WRO).
//  ShipBob shipping cartons → email to Amanda, deliver to ShipBob Altona WITH a WRO label on
//  the pallet (so ShipBob can receive it). The agent drafts; Luke approves; then send_email_draft.
import { supabaseLogistics } from './supabase-logistics';
import { gmailCreateDraft } from './google';
import { getConfig } from './settings';
import { createWRO, getWROLabels } from './shipbob';
import { deliveryBlock, VISY_SIGNATURE } from './visyConstants';
import { melbDate, addDays } from './tz';

export interface VisyContact { name: string; email: string }
export async function getVisyContact(): Promise<VisyContact> {
  const raw = await getConfig('visy_contact');
  let name = 'Amanda Eastley', email = '';
  if (raw) { try { const j = JSON.parse(raw); name = j.name || name; email = j.email || ''; } catch { /* keep defaults */ } }
  return { name, email };
}

export interface VisyItem {
  id: string; kind: string; name: string; sku: string | null; visy_code: string | null;
  destination: 'ABC' | 'ALTONA'; min_order: number | null; units_per: number | null;
  baseline_qty: number | null; shipbob_inventory_id: number | null;
  linked_sku: string | null; linked_flavour: string | null;
}

// Resolve a VISY-orderable item from free text (flavour, pouch SKU, carton name, or VISY code).
// Returns the single match, or a list of candidates when ambiguous.
export async function resolveVisyItem(query: string): Promise<{ item?: VisyItem; candidates?: VisyItem[] }> {
  const q = query.trim().toLowerCase();
  const { data } = await supabaseLogistics.from('packaging')
    .select('*, linked:linked_product_id(sku, flavour)')
    .not('visy_code', 'is', null).eq('active', true);
  const items: VisyItem[] = (data ?? []).map((p: any) => ({
    id: p.id, kind: p.kind, name: p.name, sku: p.sku, visy_code: p.visy_code,
    destination: (p.destination || 'ABC') as 'ABC' | 'ALTONA', min_order: p.min_order, units_per: p.units_per,
    baseline_qty: p.baseline_qty, shipbob_inventory_id: p.shipbob_inventory_id ?? null,
    linked_sku: p.linked?.sku ?? null, linked_flavour: p.linked?.flavour ?? null,
  }));
  // 1) exact VISY code or pouch/carton SKU or linked SKU
  const exact = items.find((i) =>
    i.visy_code?.toLowerCase() === q || i.sku?.toLowerCase() === q || i.linked_sku?.toLowerCase() === q);
  if (exact) return { item: exact };
  // 2) substring on flavour / name / sku / linked sku
  const matches = items.filter((i) =>
    [i.linked_flavour, i.name, i.sku, i.linked_sku, i.visy_code].filter(Boolean)
      .some((s) => String(s).toLowerCase().includes(q)));
  if (matches.length === 1) return { item: matches[0] };
  if (matches.length > 1) return { candidates: matches };
  return {};
}

export interface VisyDraft {
  draft_id: string; to: string; subject: string; body: string;
  destination: 'ABC' | 'ALTONA'; qty: number; visy_code: string | null;
  wro_id?: number; wro_attached?: boolean; notes: string[];
}

// Draft (NOT send) a VISY order email. For ALTONA shipping cartons, also create a WRO + attach
// its label PDF to the pallet's paperwork.
export async function draftVisyOrder(opts: { item: VisyItem; qty?: number }): Promise<VisyDraft> {
  const { item } = opts;
  const notes: string[] = [];
  const contact = await getVisyContact();
  const qty = opts.qty && opts.qty > 0 ? Math.round(opts.qty) : (item.min_order || 1000);
  if (item.min_order && qty < item.min_order) notes.push(`Heads up: VISY's minimum for this item is ${item.min_order.toLocaleString()} — ${qty.toLocaleString()} is below it.`);

  // Description line — SRP cartons read "my SRP cartons for {flavour}", shipping cartons use the item name.
  const desc = item.kind === 'srp' && item.linked_flavour
    ? `my SRP cartons for ${item.linked_flavour}`
    : item.name;
  const shortCode = item.linked_sku || item.visy_code || item.sku || 'ORDER';
  const subject = `NEW ORDER - ${shortCode}`;

  // ALTONA shipping cartons → create the WRO first so its label can ride with the paperwork.
  let attachment: { filename: string; base64: string } | undefined;
  let wro_id: number | undefined;
  let wro_attached = false;
  if (item.destination === 'ALTONA') {
    if (item.shipbob_inventory_id) {
      try {
        const eta = addDays(melbDate(0), 14);
        const wro = await createWRO({
          site: 'ALTONA', expected_arrival_date: eta, tracking_ref: `VISY-${item.visy_code}-${eta}`,
          package_type: 'Pallet', items: [{ inventory_id: item.shipbob_inventory_id, quantity: qty }],
        });
        wro_id = wro.id;
        const labels = await getWROLabels('ALTONA', wro.id);
        if (labels) { attachment = { filename: `WRO-${wro.id}-label.pdf`, base64: labels }; wro_attached = true; }
        else notes.push(`WRO ${wro.id} created but its label PDF wasn't available yet — re-fetch before sending.`);
      } catch (e) { notes.push(`Couldn't create the ShipBob WRO automatically: ${String(e).slice(0, 120)}. Draft made without a label.`); }
    } else {
      notes.push('This carton has no ShipBob inventory id mapped, so no WRO/label was generated — add the inventory id to enable it.');
    }
  }

  const body = [
    `Hi ${contact.name.split(' ')[0] || 'Amanda'},`,
    '',
    `Could I please have a delivery of ${qty.toLocaleString()} units of ${desc} - Product Code: ${item.visy_code || '—'}`,
    '',
    deliveryBlock(item.destination),
    '',
    VISY_SIGNATURE,
  ].join('\n');

  if (!contact.email) notes.push("VISY contact email isn't set yet — the draft has no recipient. Set it in settings (config key `visy_contact`) or tell me Amanda's email.");
  const draft_id = await gmailCreateDraft(contact.email || '', subject, body, attachment);
  return { draft_id, to: contact.email || '(no recipient set)', subject, body, destination: item.destination, qty, visy_code: item.visy_code, wro_id, wro_attached, notes };
}
