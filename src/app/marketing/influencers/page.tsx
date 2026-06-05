import { Megaphone } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function InfluencersPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <Megaphone className="h-6 w-6 text-caramel" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Influencers</h1>
          <p className="text-sm text-gray-500">Influencer marketing pipeline</p>
        </div>
      </div>
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
        <p className="text-sm text-gray-500">Coming next — Kate&apos;s influencer pipeline (prospects, outreach, status, performance).</p>
      </div>
    </div>
  );
}
