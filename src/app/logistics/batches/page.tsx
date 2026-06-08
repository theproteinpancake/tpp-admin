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
      <div className="mb-5">
        <h1 className="text-xl font-bold text-caramel sm:text-2xl">Batches</h1>
        <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">Lot tracking &amp; best-before dates across sites</p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-2">
        <Card icon={<AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />} label="Expired" value={String(expired.length)} tone={expired.length ? 'text-red-700' : 'text-caramel'} />
        <Card icon={<Clock className="h-4 w-4 shrink-0 text-red-500" />} label="Under 30d" value={String(critical.length)} tone="text-caramel" />
        <Card icon={<Clock className="h-4 w-4 shrink-0 text-amber-500" />} label="Under 3mo" value={String(warning.length)} tone="text-caramel" />
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
    <div className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm sm:p-4">
      <div className="flex items-center gap-1 text-[11px] font-medium text-gray-500 sm:text-xs">{icon}{label}</div>
      <div className={`mt-1.5 text-lg font-bold sm:text-2xl ${tone}`}>{value}</div>
    </div>
  );
}
