import { Table2 } from 'lucide-react';
import { listWeeks } from '@/lib/analytics';
import SalesMaster from '@/components/analytics/SalesMaster';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SalesMasterPage() {
  const { weeks } = await listWeeks(60);
  return (
    <div className="px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-4 flex items-center gap-2.5">
        <Table2 className="h-6 w-6 text-caramel" />
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-caramel sm:text-2xl">Sales &amp; Data</h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">Your weekly master — every week, every metric, colour-graded. Scroll across →</p>
        </div>
      </div>
      <SalesMaster weeks={weeks} />
    </div>
  );
}
