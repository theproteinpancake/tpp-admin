import { NextRequest, NextResponse } from 'next/server';
import { supabaseLogistics } from '@/lib/supabase-logistics';

// Editable (manual) fields — saving any of these LOCKS it so auto-fill won't overwrite.
const EDITABLE = new Set([
  'amazon_purchases', 'amazon_sales_au', 'amazon_sales_uk', 'amazon_spend', 'amazon_roas',
  'meta_spend', 'meta_roas', 'meta_purchases', 'meta_nc_roas', 'meta_cpa', 'meta_nc_cpa',
  'google_spend', 'google_roas', 'google_purchases', 'google_nc_roas', 'google_cpa', 'google_nc_cpa',
  'cr', 'nz_cr', 'uk_cr', 'notes',
  // allow manual override of auto fields too
  'online_sales', 'orders', 'aov', 'shipping_charged', 'gross_profit', 'shipbob_charges', 'wholesale_invoices',
]);

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.week_start || !b.field || !EDITABLE.has(b.field)) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  const { data: cur } = await supabaseLogistics.from('sales_week').select('locked').eq('week_start', b.week_start).maybeSingle();
  const locked = new Set<string>(((cur?.locked as string[]) || []));
  const raw = b.value;
  const value = b.field === 'notes' ? (raw ? String(raw) : null) : (raw === '' || raw == null ? null : Number(raw));
  if (value == null) locked.delete(b.field); else if (b.field !== 'notes') locked.add(b.field); // clearing a number unlocks; notes never locks auto fields

  const { error } = await supabaseLogistics.from('sales_week').upsert(
    { week_start: b.week_start, [b.field]: value, locked: [...locked], updated_at: new Date().toISOString() },
    { onConflict: 'week_start' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
