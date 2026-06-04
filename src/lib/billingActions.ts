'use server';

import { revalidatePath } from 'next/cache';
import { supabaseLogistics } from './supabase-logistics';
import { SITE_CCY } from './billing';

export async function addInvoice(formData: FormData) {
  const num = (k: string) => {
    const v = formData.get(k);
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const str = (k: string) => {
    const v = formData.get(k);
    return v && String(v).trim() ? String(v).trim() : null;
  };

  const site = str('site');
  const fulfillment = num('fulfillment_amount');
  const storage = num('storage_amount');
  const other = num('other_amount');
  let total = num('total_amount');
  if (total == null) total = (fulfillment ?? 0) + (storage ?? 0) + (other ?? 0) || null;

  const row = {
    site,
    invoice_number: str('invoice_number'),
    invoice_date: str('invoice_date'),
    period_start: str('period_start'),
    period_end: str('period_end'),
    currency: str('currency') || (site ? SITE_CCY[site] : null),
    fulfillment_amount: fulfillment,
    storage_amount: storage,
    other_amount: other,
    total_amount: total,
    status: str('status') || 'unpaid',
    notes: str('notes'),
    source: 'manual',
  };

  const { error } = await supabaseLogistics
    .from('billing_invoices')
    .upsert(row, { onConflict: 'invoice_number' });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/logistics/shipping');
  revalidatePath('/logistics/stock');
  return { ok: true };
}

export async function setInvoiceStatus(id: string, status: string) {
  const { error } = await supabaseLogistics.from('billing_invoices').update({ status }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/logistics/shipping');
  revalidatePath('/logistics/stock');
  return { ok: true };
}
