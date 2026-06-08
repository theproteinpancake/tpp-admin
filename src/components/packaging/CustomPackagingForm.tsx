'use client';

import { useState, useTransition } from 'react';
import { Plus, X } from 'lucide-react';
import { saveCustomPackaging } from '@/lib/packagingActions';

const field = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-caramel focus:outline-none';

export default function CustomPackagingForm() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-caramel px-3 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90">
        <Plus className="h-4 w-4" /> Add packaging item
      </button>
    );
  }

  return (
    <form
      action={(fd) => start(async () => { setErr(null); const r = await saveCustomPackaging(fd); if (r?.ok) setOpen(false); else setErr(r?.error || 'Failed'); })}
      className="rounded-xl border border-gray-200 bg-paper p-5 shadow-sm"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-caramel">Add custom packaging</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">Name
          <input name="name" required className={field} placeholder="e.g. Custom Shipping Box (Mailer)" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">Type
          <select name="kind" className={field} defaultValue="box">
            <option value="box">Shipping box</option>
            <option value="card">Thank you card</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">ShipBob SKU <span className="font-normal text-gray-400">(optional)</span>
          <input name="sku" className={field} placeholder="e.g. TY1500" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">Supplier
          <select name="supplier" className={field} defaultValue="VISY">
            <option value="VISY">Visy (AU)</option>
            <option value="CBS">CBS (UK)</option>
            <option value="China">China manufacturer</option>
            <option value="Other">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">Site
          <select name="site" className={field} defaultValue="AU">
            <option value="AU">AU</option><option value="UK">UK</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">Lead time (days)
          <input name="lead_days" type="number" className={field} defaultValue={14} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">On hand
          <input name="manual_on_hand" type="number" className={field} placeholder="units" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">Reorder point
          <input name="reorder_point" type="number" className={field} placeholder="flag at ≤" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">Daily usage <span className="font-normal text-gray-400">(optional)</span>
          <input name="daily_usage" type="number" step="0.1" className={field} placeholder="units/day" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 sm:col-span-2 lg:col-span-3">Notes
          <input name="notes" className={field} placeholder="optional" />
        </label>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-4 flex items-center gap-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-caramel px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50">{pending ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
      </div>
    </form>
  );
}
