import { Megaphone } from 'lucide-react';
import Link from 'next/link';
import RefreshButton from '@/components/RefreshButton';
import { listInfluencers } from '@/lib/marketing';
import InfluencerTable from '@/components/marketing/InfluencerTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function InfluencersPage() {
  const influencers = await listInfluencers();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center gap-2.5">
        <Megaphone className="h-6 w-6 text-caramel" />
        <div>
          <h1 className="text-xl font-bold text-caramel">Influencers</h1>
          <p className="text-sm text-gray-500">{(influencers as any[]).length} in the database · seeding pipeline · <Link href="/marketing/influencer-reporting" className="text-caramel underline underline-offset-2 hover:opacity-80">reporting →</Link></p>
        </div>
        <RefreshButton />
      </div>

      <InfluencerTable influencers={influencers as any} />
    </div>
  );
}
