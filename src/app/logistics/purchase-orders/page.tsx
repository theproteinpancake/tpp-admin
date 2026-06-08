import Link from 'next/link';
import { Plus, ClipboardList, PackagePlus, Truck } from 'lucide-react';
import { getPurchaseOrders, poUnits, PO_STATUS_META, OPEN_STATUSES, type POStatus } from '@/lib/po';
import { getConnection } from '@/lib/xero';
import { getPoForecast } from '@/lib/poForecast';
import { flavourColor } from '@/lib/flavours';
import XeroButtons from '@/components/po/XeroButtons';
import POTable from '@/components/po/POTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function money(n: number | null, ccy: string | null) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || 'AUD', maximumFractionDigits: 0 }).format(n);
}
function sizeLabel(g: number | null) { return g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`; }

export default async function PurchaseOrdersPage() {
  const [pos, conn, forecast] = await Promise.all([getPurchaseOrders(), getConnection(), getPoForecast('ALTONA')]);
  const open = pos.filter((p) => OPEN_STATUSES.includes(p.status));
  const inboundUnits = open.reduce((s, p) => s + poUnits(p).outstanding, 0);
  const openValue = open.reduce((s, p) => s + (p.total_cost || 0), 0);
  const nowMonthKey = new Date().toISOString().slice(0, 7);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="mt-1 text-gray-500">Outstanding orders and pending (inbound) stock</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <XeroButtons connected={!!conn} org={conn?.tenant_name} />
          <Link href="/logistics/purchase-orders/new"
            className="inline-flex items-center gap-2 rounded-lg bg-caramel px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-maple">
            <Plus className="h-4 w-4" /> New PO
          </Link>
        </div>
      </div>


      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card icon={<ClipboardList className="h-5 w-5 text-caramel" />} label="Open POs" value={String(open.length)} />
        <Card icon={<PackagePlus className="h-5 w-5 text-caramel" />} label="Pending (inbound) units" value={inboundUnits.toLocaleString('en-AU')} />
        <Card icon={<Truck className="h-5 w-5 text-caramel" />} label="Open PO value" value={money(openValue, 'AUD')} />
      </div>

      {/* Suggested POs — 3-month rolling schedule */}
      <section id="suggested" className="mb-8 scroll-mt-6">
        <div className="mb-3 flex items-center gap-2">
          <PackagePlus className="h-5 w-5 text-caramel" />
          <h2 className="text-lg font-semibold text-gray-900">Suggested orders — next 3 months</h2>
          <span className="rounded-full bg-cream px-2 py-0.5 text-[11px] font-medium text-maple">live velocity · ABC 30-day lead</span>
        </div>
        {forecast.months.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-paper px-4 py-6 text-center text-sm text-gray-500">
            Nothing to order in the next 3 months — current stock + inbound POs cover projected demand. ✅
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {forecast.months.map((m) => {
              const isNow = m.key === nowMonthKey;
              return (
                <div key={m.key} className={`rounded-xl border bg-paper p-4 shadow-sm ${isNow ? 'border-caramel' : 'border-gray-200'}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900">{m.label}{isNow && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 text-[10px] font-medium text-red-600">order now</span>}</span>
                    <span className="text-xs text-gray-400">{m.units.toLocaleString()} units</span>
                  </div>
                  <div className="space-y-1.5">
                    {m.items.map((it) => (
                      <div key={it.product_id} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-1.5 text-gray-700">
                          <span className="h-3 w-1.5 rounded-full" style={{ backgroundColor: flavourColor(it.flavour) }} />
                          {it.flavour} {it.size}
                        </span>
                        <span className="font-medium text-gray-900">×{it.units.toLocaleString()}{it.cartons ? <span className="text-[11px] font-normal text-gray-400"> ({it.cartons}ctn)</span> : null}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-xs text-gray-400">Projected from each SKU&apos;s live sales rate vs. on-hand + inbound. Ask the assistant to “draft the ABC PO” to turn the current month into a Xero draft.</p>
      </section>

      {pos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-paper p-10 text-center text-gray-500">
          No purchase orders yet. <Link href="/logistics/purchase-orders/new" className="font-medium text-maple underline">Create your first PO</Link>.
        </div>
      ) : (
        <POTable rows={pos.map((po) => {
          const u = poUnits(po);
          const meta = PO_STATUS_META[po.status as POStatus];
          return {
            id: po.id, supplier_name: po.supplier?.name ?? 'Supplier —', po_ref: po.po_number || po.id.slice(0, 8),
            dest: po.destination?.code ?? '—', status: po.status, statusLabel: meta.label, statusChip: meta.chip,
            expected_date: po.expected_date ?? null, received: u.received, ordered: u.ordered, outstanding: u.outstanding,
            total_cost: po.total_cost, valueText: money(po.total_cost, po.currency),
            itemLines: po.items.slice(0, 4).map((i) => `${i.product?.sku ?? '?'} ${sizeLabel(i.product?.unit_size_g ?? null)} ×${i.qty_ordered}`),
            extraItems: Math.max(0, po.items.length - 4),
          };
        })} />
      )}
    </div>
  );
}

function Card({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-paper p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-500">{icon}{label}</div>
      <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}
