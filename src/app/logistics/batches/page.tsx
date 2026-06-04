import { Layers, AlertTriangle, Clock } from 'lucide-react';
import { getLots, expiryStatus, EXPIRY_META } from '@/lib/lots';
import { flavourColor } from '@/lib/flavours';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const fmtInt = (n: number) => n.toLocaleString('en-AU');
const sizeText = (g: number | null) => (g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`);
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

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

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {['Product', 'Site', 'Lot', 'Best before', 'Days left', 'On hand', 'Status'].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lots.map((l) => {
              const st = expiryStatus(l.days_left);
              const meta = EXPIRY_META[st];
              return (
                <tr key={l.id} className="hover:bg-cream/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="h-6 w-1.5 shrink-0 rounded-full" style={{ background: flavourColor(l.flavour) }} />
                      <div>
                        <div className="font-medium text-gray-900">{l.flavour ?? l.sku}</div>
                        <div className="text-[11px] text-gray-500">{l.sku} · {sizeText(l.unit_size_g)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{l.site}</td>
                  <td className="px-4 py-3 font-mono text-sm text-gray-700">{l.lot_number}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{fmtDate(l.expiry_date)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{l.days_left == null ? '—' : `${l.days_left}d`}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">{fmtInt(l.on_hand)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${meta.chip}`}>{meta.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {lots.length === 0 && <p className="mt-4 text-sm text-gray-500">No lot data yet — it populates from the daily ShipBob sync.</p>}
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
