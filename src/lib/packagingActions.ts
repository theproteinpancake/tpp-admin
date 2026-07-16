'use server';

import { revalidatePath } from 'next/cache';
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
