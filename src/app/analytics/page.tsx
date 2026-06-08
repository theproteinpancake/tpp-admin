import { BarChart3 } from 'lucide-react';
import { listWeeks } from '@/lib/analytics';
import SalesGrid from '@/components/analytics/SalesGrid';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AnalyticsPage() {
  const { weeks, assumptions } = await listWeeks(16);
  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex items-center gap-2.5">
        <BarChart3 className="h-6 w-6 text-caramel" />
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-caramel sm:text-2xl">Sales &amp; Data</h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">Your weekly master — auto-filled from Shopify, Xero &amp; ShipBob</p>
        </div>
      </div>
      <SalesGrid weeks={weeks} targetSales={assumptions.weekly_target_sales} targetNp={assumptions.weekly_target_np} />
    </div>
  );
}
