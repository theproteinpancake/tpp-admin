'use server';

import { revalidatePath } from 'next/cache';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseLogistics } from './supabase-logistics';

const num = (v: FormDataEntryValue | null) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: FormDataEntryValue | null) => (v && String(v).trim() ? String(v).trim() : null);

// Set / update an ABC pouch baseline for a finished-good SKU. POs placed from today deduct from it.
export async function setPouchBaseline(formData: FormData) {
  const product_id = str(formData.get('product_id'));
  const baseline_qty = num(formData.get('baseline_qty'));
  const lead_days = num(formData.get('lead_days')) ?? 60;
  const baseline_date = str(formData.get('baseline_date')) ?? new Date().toISOString().slice(0, 10);
  if (!product_id || baseline_qty == null) return { ok: false, error: 'Need product and quantity' };

  const { error } = await supabaseLogistics.from('packaging').upsert(
    { product_id, kind: 'pouch', baseline_qty, baseline_date, lead_days, active: true },
    { onConflict: 'product_id,kind' },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/logistics/packaging');
  return { ok: true };
}

// Natural-language packaging updates (Luke's "AI sorter"): one text box replaces the per-row
// baseline/delivery forms. "VISY dropped 1000 BMS boxes", "ordered 20k buttermilk 520g
// pouches from China, landing mid Sept", "stocktake: salted caramel 520g pouches 8000" →
// parsed to typed actions, matched to real packaging rows, applied. Fail-closed: anything
// unmatched is reported back, nothing guessed.
export async function packagingCommand(formData: FormData): Promise<{ ok: boolean; summary: string }> {
  const text = String(formData.get('command') || '').trim();
  if (!text) return { ok: false, summary: 'Type what happened first.' };
  try {
    const [{ data: products }, { data: srp }] = await Promise.all([
      supabaseLogistics.from('products').select('id, sku, flavour, unit_size_g').eq('active', true).eq('category', 'mix'),
      supabaseLogistics.from('packaging').select('id, linked_product_id, name').eq('kind', 'srp').eq('active', true),
    ]);
    const skuList = (products ?? []).map((p: any) => `${p.sku} = ${p.flavour} ${p.unit_size_g >= 1000 ? p.unit_size_g / 1000 + 'kg' : p.unit_size_g + 'g'}`).join('; ');
    const today = new Date().toISOString().slice(0, 10);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 700,
      system: `You parse packaging-stock updates for The Protein Pancake into JSON actions. Today is ${today}.
Product SKUs: ${skuList}. Two stock pools per product: POUCHES (empty pouches at ABC) and SRP BOXES (shelf-ready cartons, 320g SKUs only — "boxes"/"cartons"/"SRP" means these).
Actions:
- {"type":"delivery","target":"pouch"|"srp","sku":"BMM","qty":20000,"date":"YYYY-MM-DD"} — stock ARRIVED at ABC (date=today unless stated). If the user says they ORDERED/purchased with a future arrival, use the expected arrival date (estimate mid-month = 15th); future dates count as inbound.
- {"type":"baseline","target":"pouch"|"srp","sku":"SCM","qty":8000} — a stock-take / correction ("we have X on hand", "set X to", "stocktake").
Multiple actions allowed. Quantities are POUCHES for pouch target, BOXES for srp target. NEVER inverse-convert. If something can't be matched to a SKU or a number is ambiguous, put it in "unmatched" instead of guessing.
Reply ONLY JSON: {"actions":[...],"unmatched":["..."]}`,
      messages: [{ role: 'user', content: text }],
    });
    const out = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    const bySku = new Map((products ?? []).map((p: any) => [p.sku.toUpperCase(), p]));
    const srpByProduct = new Map((srp ?? []).map((r: any) => [r.linked_product_id, r]));
    const done: string[] = [];
    const skipped: string[] = [...(parsed.unmatched ?? [])];

    for (const a of parsed.actions ?? []) {
      const prod = bySku.get(String(a.sku || '').toUpperCase());
      const qty = Math.round(Number(a.qty));
      if (!prod || !qty || qty <= 0) { skipped.push(`${a.sku || '?'} ${a.qty ?? ''} (couldn't match)`); continue; }
      const label = `${prod.flavour} ${prod.unit_size_g >= 1000 ? prod.unit_size_g / 1000 + 'kg' : prod.unit_size_g + 'g'}`;

      if (a.type === 'baseline') {
        if (a.target === 'srp') {
          const row = srpByProduct.get(prod.id);
          if (!row) { skipped.push(`${label}: no SRP carton tracked for it`); continue; }
          await supabaseLogistics.from('packaging').update({ baseline_qty: qty, baseline_date: today }).eq('id', row.id);
          done.push(`${label}: SRP boxes reset to ${qty.toLocaleString('en-AU')} (stock-take today)`);
        } else {
          await supabaseLogistics.from('packaging').upsert(
            { product_id: prod.id, kind: 'pouch', baseline_qty: qty, baseline_date: today, lead_days: 60, active: true },
            { onConflict: 'product_id,kind' });
          done.push(`${label}: pouches reset to ${qty.toLocaleString('en-AU')} (stock-take today)`);
        }
      } else if (a.type === 'delivery') {
        let packagingId: string | null = null;
        if (a.target === 'srp') packagingId = srpByProduct.get(prod.id)?.id ?? null;
        else {
          const { data: packRow } = await supabaseLogistics.from('packaging').select('id').eq('product_id', prod.id).eq('kind', 'pouch').maybeSingle();
          packagingId = (packRow as any)?.id ?? null;
          if (!packagingId) {
            const { data: created } = await supabaseLogistics.from('packaging')
              .insert({ product_id: prod.id, kind: 'pouch', baseline_qty: 0, baseline_date: today, lead_days: 60, active: true })
              .select('id').single();
            packagingId = (created as any)?.id ?? null;
          }
        }
        if (!packagingId) { skipped.push(`${label}: no ${a.target === 'srp' ? 'SRP carton' : 'pouch'} row to log against`); continue; }
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || '')) ? a.date : today;
        await supabaseLogistics.from('packaging_deliveries').insert({ packaging_id: packagingId, qty, delivered_on: date, note: `via packaging command: "${text.slice(0, 140)}"` });
        const unit = a.target === 'srp' ? 'boxes' : 'pouches';
        done.push(date > today
          ? `${label}: ${qty.toLocaleString('en-AU')} ${unit} on order, expected ${date} (counts as inbound until then)`
          : `${label}: +${qty.toLocaleString('en-AU')} ${unit} delivered ${date}`);
      } else skipped.push(`${a.sku}: unknown action "${a.type}"`);
    }
    revalidatePath('/logistics/packaging');
    const parts = [];
    if (done.length) parts.push(`✅ ${done.join(' · ')}`);
    if (skipped.length) parts.push(`⚠️ Not applied: ${skipped.join(' · ')}`);
    if (!parts.length) parts.push('Nothing actionable found in that — try e.g. "VISY delivered 1000 BMS boxes" or "stocktake: BMM pouches 6400".');
    return { ok: done.length > 0, summary: parts.join('\n') };
  } catch (e) {
    return { ok: false, summary: `Couldn't process that: ${String(e).slice(0, 160)}` };
  }
}

// Log a delivery INTO packaging stock (VISY SRP boxes → ABC, empty-pouch drops).
// Adds on top of the baseline instead of forcing a full baseline reset — a delivery of
// 1,000 BMS boxes once went unrecorded because baseline-reset was the only write path.
export async function logPackagingDelivery(formData: FormData) {
  const packaging_id = str(formData.get('packaging_id'));
  const qty = num(formData.get('qty'));
  const delivered_on = str(formData.get('delivered_on')) ?? new Date().toISOString().slice(0, 10);
  const note = str(formData.get('note'));
  if (!packaging_id || !qty || qty <= 0) return { ok: false, error: 'Need item and a positive quantity' };

  const { error } = await supabaseLogistics.from('packaging_deliveries').insert({ packaging_id, qty, delivered_on, note });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/logistics/packaging');
  return { ok: true };
}

export async function saveCustomPackaging(formData: FormData) {
  const id = str(formData.get('id'));
  const row = {
    kind: str(formData.get('kind')) || 'box',
    name: str(formData.get('name')),
    sku: str(formData.get('sku')),
    site: str(formData.get('site')),
    supplier: str(formData.get('supplier')),
    lead_days: num(formData.get('lead_days')) ?? 14,
    manual_on_hand: num(formData.get('manual_on_hand')),
    reorder_point: num(formData.get('reorder_point')),
    daily_usage: num(formData.get('daily_usage')),
    notes: str(formData.get('notes')),
    active: true,
  };
  if (!row.name) return { ok: false, error: 'Name required' };

  const q = id
    ? supabaseLogistics.from('packaging').update(row).eq('id', id)
    : supabaseLogistics.from('packaging').insert(row);
  const { error } = await q;
  if (error) return { ok: false, error: error.message };
  revalidatePath('/logistics/packaging');
  return { ok: true };
}

export async function deletePackaging(id: string) {
  const { error } = await supabaseLogistics.from('packaging').update({ active: false }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/logistics/packaging');
  return { ok: true };
}
