import { AlertTriangle, Clock } from 'lucide-react';
import { getLots, expiryStatus, EXPIRY_META } from '@/lib/lots';
import { flavourColor } from '@/lib/flavours';
import BatchesTable from '@/components/stock/BatchesTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const sizeText = (g: number | null) => (g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`);

export default async function BatchesPage() {
  const lots = await getLots();
  const expired = lots.filter((l) => expiryStatus(l.days_left) === 'expired');
  const critical = lots.filter((l) => expiryStatus(l.days_left) === 'critical');
  const warning = lots.filter((l) => expiryStatus(l.days_left) === 'warning');

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Batches</h1>
        <p className="mt-1 text-gray-500">Lot tracking &amp; best-before dates across sites</p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card icon={<AlertTriangle className="h-5 w-5 text-red-600" />} label="Expired (on hand)" value={String(expired.length)} tone={expired.length ? 'text-red-700' : 'text-gray-900'} />
        <Card icon={<Clock className="h-5 w-5 text-red-500" />} label="Under 30 days" value={String(critical.length)} tone="text-gray-900" />
        <Card icon={<Clock className="h-5 w-5 text-amber-500" />} label="Under 3 months" value={String(warning.length)} tone="text-gray-900" />
      </div>

      <BatchesTable rows={lots.map((l) => {
        const meta = EXPIRY_META[expiryStatus(l.days_left)];
        return {
          id: l.id, flavour: l.flavour, sku: l.sku, size: sizeText(l.unit_size_g), site: l.site,
          lot_number: l.lot_number, expiry_date: l.expiry_date, days_left: l.days_left, on_hand: l.on_hand,
          color: flavourColor(l.flavour), statusLabel: meta.label, statusBg: meta.bg,
        };
      })} />
    </div>
  );
}

function Card({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-500">{icon}{label}</div>
      <div className={`mt-2 text-2xl font-bold ${tone}`}>{value}</div>
    </div>
  );
}
