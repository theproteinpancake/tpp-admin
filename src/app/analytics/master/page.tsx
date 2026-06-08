import Link from 'next/link';
import { Table2 } from 'lucide-react';
import { getMasterYear } from '@/lib/analytics';
import SalesMaster from '@/components/analytics/SalesMaster';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function SalesMasterPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const current = new Date(Date.now() + 10 * 3600_000).getFullYear();
  const year = Number(sp.year) || current;
  const { weeks, years } = await getMasterYear(year);

  return (
    <div className="px-3 py-5 sm:px-6 sm:py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Table2 className="h-6 w-6 text-caramel" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-caramel sm:text-2xl">Sales &amp; Data</h1>
            <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">Your weekly master — full year, colour-graded. Scroll across →</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {years.map((y) => (
            <Link key={y} href={`/analytics/master?year=${y}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${y === year ? 'bg-caramel text-white shadow-sm' : 'border border-gray-200 bg-white text-caramel hover:bg-cream'}`}>{y}</Link>
          ))}
        </div>
      </div>
      <SalesMaster weeks={weeks} year={year} />
    </div>
  );
}
