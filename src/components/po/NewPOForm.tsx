'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';

interface Supplier { id: string; name: string; currency: string | null; default_lead_days: number | null }
interface Location { id: string; code: string; name: string }
interface Product { id: string; sku: string; name: string; flavour: string | null; size_code: string | null; unit_size_g: number | null; cogs: number | null }
interface Line { product_id: string; qty_ordered: string; unit_cost: string }

const sizeLabel = (g: number | null) => (g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`);

export default function NewPOForm({ suppliers, locations, products }: { suppliers: Supplier[]; locations: Location[]; products: Product[] }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [destId, setDestId] = useState(locations.find((l) => l.code === 'ALTONA')?.id ?? locations[0]?.id ?? '');
  const [poNumber, setPoNumber] = useState('');
  const [expected, setExpected] = useState('');
  const [status, setStatus] = useState('placed');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ product_id: '', qty_ordered: '', unit_cost: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const currency = suppliers.find((s) => s.id === supplierId)?.currency ?? 'AUD';
  const total = lines.reduce((s, l) => s + (Number(l.qty_ordered) || 0) * (Number(l.unit_cost) || 0), 0);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const onPickProduct = (i: number, pid: string) => {
    const p = products.find((x) => x.id === pid);
    setLine(i, { product_id: pid, unit_cost: p?.cogs != null ? String(p.cogs) : '' });
  };

  const submit = async () => {
    setError('');
    const items = lines.filter((l) => l.product_id && Number(l.qty_ordered) > 0);
    if (items.length === 0) { setError('Add at least one product with a quantity.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/logistics/purchase-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_id: supplierId, destination_location_id: destId, po_number: poNumber,
          expected_date: expected || null, status, notes, currency, items,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      router.push('/logistics/purchase-orders');
      router.refresh();
    } catch (e) {
      setError(String(e)); setBusy(false);
    }
  };

  const field = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-caramel';

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">Supplier</span>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={field}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">Destination</span>
          <select value={destId} onChange={(e) => setDestId(e.target.value)} className={field}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
            {['draft', 'placed', 'in_production'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">PO number (optional)</span>
          <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className={field} placeholder="e.g. ABC-1042" /></label>
        <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">Expected date</span>
          <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={field} /></label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-caramel">Line items</h3>
          <span className="text-xs text-gray-400">Currency: {currency}</span>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2">
              <select value={l.product_id} onChange={(e) => onPickProduct(i, e.target.value)} className={`${field} flex-1 min-w-[180px]`}>
                <option value="">Select product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{(p.flavour ?? p.name)} {sizeLabel(p.unit_size_g)} ({p.sku})</option>
                ))}
              </select>
              <input type="number" min="0" value={l.qty_ordered} onChange={(e) => setLine(i, { qty_ordered: e.target.value })}
                placeholder="Qty" className={`${field} w-24`} />
              <input type="number" min="0" step="0.01" value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })}
                placeholder="Unit cost" className={`${field} w-28`} />
              <span className="w-20 text-right text-sm text-gray-500">
                {((Number(l.qty_ordered) || 0) * (Number(l.unit_cost) || 0)).toFixed(0)}
              </span>
              <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                className="rounded-md p-1.5 text-gray-400 hover:text-red-600" aria-label="Remove line">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button onClick={() => setLines((ls) => [...ls, { product_id: '', qty_ordered: '', unit_cost: '' }])}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-cream hover:text-maple">
          <Plus className="h-4 w-4" /> Add line
        </button>
      </div>

      <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={field} /></label>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <div className="text-sm text-gray-500">Total: <span className="font-semibold text-caramel">{currency} {total.toFixed(2)}</span></div>
        <button onClick={submit} disabled={busy}
          className="rounded-lg bg-caramel px-4 py-2 text-sm font-semibold text-white hover:bg-maple disabled:opacity-50">
          {busy ? 'Saving…' : 'Create PO'}
        </button>
      </div>
    </div>
  );
}
