// Supplier / logistics contact directory — queried by the WhatsApp agent ("what's Janny's
// email", "ABC's address", "who do I escalate to at ShipBob"). One row per person/company.
import { supabaseLogistics } from './supabase-logistics';

export interface Contact {
  id: string; category: string; company: string | null; name: string | null; role: string | null;
  email: string | null; phone: string | null; address: string | null; notes: string | null;
}

const CATEGORY_ALIASES: Record<string, string> = {
  abc: 'blending', blend: 'blending', blending: 'blending',
  visy: 'boxes', box: 'boxes', boxes: 'boxes', carton: 'boxes', cartons: 'boxes',
  pouch: 'pouches', pouches: 'pouches', liantai: 'pouches',
  shipbob: '3pl', '3pl': '3pl', warehouse: 'warehouse', fc: 'warehouse',
  syrup: 'maple_syrup', maple: 'maple_syrup', pakco: 'maple_syrup',
  sample: 'product_dev', samples: 'product_dev', dev: 'product_dev',
  freight: 'freight', shipping: 'freight',
};

// Free-text search across name/company/role/category/email. Returns best matches.
export async function findContacts(query: string): Promise<Contact[]> {
  const q = (query || '').trim().toLowerCase();
  const { data } = await supabaseLogistics.from('contacts').select('*').order('category');
  const all = (data ?? []) as Contact[];
  if (!q) return all;
  // category alias hit → return that whole category
  const aliasCat = Object.entries(CATEGORY_ALIASES).find(([k]) => q.includes(k))?.[1];
  const hay = (c: Contact) => `${c.name || ''} ${c.company || ''} ${c.role || ''} ${c.category} ${c.email || ''}`.toLowerCase();
  const direct = all.filter((c) => q.split(/\s+/).some((w) => w.length > 1 && hay(c).includes(w)));
  if (direct.length) return direct;
  if (aliasCat) return all.filter((c) => c.category === aliasCat);
  return [];
}
