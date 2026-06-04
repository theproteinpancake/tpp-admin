import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getPOFormOptions } from '@/lib/po';
import NewPOForm from '@/components/po/NewPOForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function NewPOPage() {
  const { suppliers, locations, products } = await getPOFormOptions();
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/logistics/purchase-orders" className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-maple">
        <ArrowLeft className="h-4 w-4" /> Back to Purchase Orders
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">New Purchase Order</h1>
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <NewPOForm
          suppliers={suppliers as never}
          locations={locations as never}
          products={products as never}
        />
      </div>
    </div>
  );
}
