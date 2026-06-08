'use client';

import { useState, useTransition } from 'react';
import { Plus, X } from 'lucide-react';
import { addInvoice } from '@/lib/billingActions';

export default function InvoiceForm() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-caramel px-3 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90"
      >
        <Plus className="h-4 w-4" /> Log invoice
      </button>
    );
  }

  const field = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-caramel focus:outline-none';

  return (
    <form
      action={(fd) =>
        start(async () => {
          setErr(null);
          const res = await addInvoice(fd);
          if (res?.ok) setOpen(false);
          else setErr(res?.error || 'Failed to save');
        })
      }
      className="rounded-xl border border-gray-200 bg-paper p-5 shadow-sm"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Log a ShipBob invoice</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Site
          <select name="site" className={field} defaultValue="ALTONA">
            <option value="ALTONA">Altona (AU)</option>
            <option value="MANCHESTER">Manchester (UK)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Invoice #
          <input name="invoice_number" required className={field} placeholder="e.g. INV-12345" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Invoice date
          <input name="invoice_date" type="date" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Period start
          <input name="period_start" type="date" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Period end
          <input name="period_end" type="date" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Status
          <select name="status" className={field} defaultValue="unpaid">
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
            <option value="disputed">Disputed</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Fulfilment
          <input name="fulfillment_amount" type="number" step="0.01" className={field} placeholder="0.00" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Storage
          <input name="storage_amount" type="number" step="0.01" className={field} placeholder="0.00" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Other / receiving
          <input name="other_amount" type="number" step="0.01" className={field} placeholder="0.00" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          Total <span className="font-normal text-gray-400">(blank = sum of above)</span>
          <input name="total_amount" type="number" step="0.01" className={field} placeholder="0.00" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 sm:col-span-2">
          Notes
          <input name="notes" className={field} placeholder="optional" />
        </label>
      </div>

      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-caramel px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save invoice'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
      </div>
    </form>
  );
}
