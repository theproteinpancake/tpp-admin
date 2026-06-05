'use server';

import { revalidatePath } from 'next/cache';
import { suggestRestock, createDraftTransfer } from './transferBuilder';

export async function buildRestockDraft(destination = 'MANCHESTER') {
  const s = await suggestRestock(destination);
  if (!s.lines.length) return { ok: false, error: `Nothing due — ${destination} is within target cover (incl. inbound).` };
  const res = await createDraftTransfer(s);
  if ('error' in res) return { ok: false, error: res.error };
  revalidatePath('/logistics/transfers');
  return { ok: true, reference: res.reference, units: res.units, lines: s.lines.length };
}
