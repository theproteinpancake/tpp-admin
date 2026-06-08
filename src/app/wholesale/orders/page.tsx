import { ShoppingCart } from 'lucide-react';
import { getWholesaleOrders } from '@/lib/wholesale';
import OrdersTable from '@/components/wholesale/OrdersTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

      <OrdersTable rows={orders.map((o) => ({
        invoice_number: o.invoice_number, customer: o.customer, order_date: o.order_date,
        cartons: o.cartons, items: o.items, total: o.total, currency: o.currency, status: o.status,
        reference: o.reference, xero_url: o.xero_url, shipbob_url: o.shipbob_url,
      }))} />
    </div>
  );
}
