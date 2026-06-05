import { ShoppingCart } from 'lucide-react';
import { getWholesaleOrders } from '@/lib/wholesale';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const money = (n: number, ccy: string) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || 'AUD' }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

const STATUS: Record<string, string> = {
  PAID: 'bg-emerald-100 text-emerald-700', AUTHORISED: 'bg-blue-100 text-blue-700',
  SUBMITTED: 'bg-amber-100 text-amber-700', DRAFT: 'bg-gray-100 text-gray-600',
};

export default async function WholesaleOrders() {
  const orders = await getWholesaleOrders(80);
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <ShoppingCart className="h-6 w-6 text-caramel" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Wholesale Orders</h1>
          <p className="text-sm text-gray-500">Sales invoices synced from Xero</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Date</th><th className="px-4 py-3 text-right">Cartons</th>
              <th className="px-4 py-3">Items</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.invoice_number} className="border-b border-gray-50 hover:bg-cream/40">
                <td className="px-4 py-3 font-medium text-gray-700">{o.invoice_number}</td>
                <td className="px-4 py-3 text-gray-800">{o.customer}</td>
                <td className="px-4 py-3 text-gray-500">{fmtDate(o.order_date)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{o.cartons || '—'}</td>
                <td className="px-4 py-3 text-xs text-gray-400">{o.items || '—'}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-800">{money(o.total, o.currency)}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[o.status || ''] || 'bg-gray-100 text-gray-600'}`}>{o.status}</span></td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No orders yet — hit “Sync from Xero” on the dashboard.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
