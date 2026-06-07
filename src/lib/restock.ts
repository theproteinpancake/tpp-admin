// Restock ETAs per flavour — used in OOS WhatsApp pings + stockist email drafts.
import { supabaseLogistics } from './supabase-logistics';

const norm = (s: string) => s.toLowerCase().replace(/\b(520g|320g|g|gluten\s*free|gf|bag|bags|carton|cartons)\b/g, '').replace(/[^a-z]/g, '').trim();

export interface RestockEta { flavour: string; eta_text?: string | null; eta_date?: string | null; updated_at?: string }

export async function setRestockEta(flavour: string, etaText?: string | null, etaDate?: string | null) {
  await supabaseLogistics.from('restock_eta').upsert(
    { flavour: flavour.trim(), eta_text: etaText || null, eta_date: etaDate || null, updated_at: new Date().toISOString() },
    { onConflict: 'flavour' },
  );
}

export async function getAllRestockEtas(): Promise<RestockEta[]> {
  const { data } = await supabaseLogistics.from('restock_eta').select('*');
  return (data ?? []) as RestockEta[];
}

// Best-effort fuzzy match of an OOS flavour name to a stored ETA. Returns a human phrase or null.
export async function getRestockPhrase(flavour: string): Promise<string | null> {
  const all = await getAllRestockEtas();
  if (!all.length) return null;
  const f = norm(flavour);
  const hit = all.find((r) => { const n = norm(r.flavour); return !!n && (n === f || f.includes(n) || n.includes(f)); });
  if (!hit) return null;
  if (hit.eta_text) return hit.eta_text;
  if (hit.eta_date) {
    const d = new Date(hit.eta_date + 'T00:00:00');
    return `due back around ${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`;
  }
  return null;
}
