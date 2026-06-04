import Link from 'next/link';
import { Plus, ClipboardList, PackagePlus, Truck } from 'lucide-react';
import { getPurchaseOrders, poUnits, PO_STATUS_META, OPEN_STATUSES, type POStatus } from '@/lib/po';
import { getConnection } from '@/lib/xero';
import POActions from '@/components/po/POActions';
import XeroButtons from '@/components/po/XeroButtons';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function money(n: number | null, ccy: string | null) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || 'AUD', maximumFractionDigits: 0 }).format(n);
}
function sizeLabel(g: number | null) { return g == null ? '' : g >= 1000 ? `${g / 1000}kg` : `${g}g`; }

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ xero?: string; org?: string; msg?: string }>;
}) {
  const [pos, conn, sp] = await Promise.all([getPurchaseOrders(), getConnection(), searchParams]);
  const open = pos.filter((p) => OPEN_STATUSES.includes(p.status));
  const inboundUnits = open.reduce((s, p) => s + poUnits(p).outstanding, 0);
  const openValue = open.reduce((s, p) => s + (p.total_cost || 0), 0);

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

      {sp.xero === 'connected' && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          ✅ Connected to Xero{sp.org ? ` (${sp.org})` : ''}. Hit “Sync from Xero” to pull your purchase orders.
        </div>
      )}
      {sp.xero === 'error' && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          Xero connection failed{sp.msg ? `: ${sp.msg}` : ''}. Try again.
        </div>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card icon={<ClipboardList className="h-5 w-5 text-caramel" />} label="Open POs" value={String(open.length)} />
        <Card icon={<PackagePlus className="h-5 w-5 text-caramel" />} label="Pending (inbound) units" value={inboundUnits.toLocaleString('en-AU')} />
        <Card icon={<Truck className="h-5 w-5 text-caramel" />} label="Open PO value" value={money(openValue, 'AUD')} />
      </div>

      {pos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-500">
          No purchase orders yet. <Link href="/logistics/purchase-orders/new" className="font-medium text-maple underline">Create your first PO</Link>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['PO / Supplier', 'Dest', 'Status', 'Expected', 'Units (recv/ord)', 'Value', 'Items'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pos.map((po) => {
                const u = poUnits(po);
                const meta = PO_STATUS_META[po.status as POStatus];
                return (
                  <tr key={po.id} className="align-top hover:bg-cream/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{po.supplier?.name ?? 'Supplier —'}</div>
                      <div className="text-[11px] text-gray-400">{po.po_number || po.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{po.destination?.code ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${meta.chip}`}>{meta.label}</span>
                      <POActions id={po.id} status={po.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{po.expected_date ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {u.received}/{u.ordered}
                      {u.outstanding > 0 && <span className="ml-1 text-[11px] text-amber-600">(+{u.outstanding} inbound)</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{money(po.total_cost, po.currency)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {po.items.slice(0, 4).map((i, idx) => (
                        <div key={idx}>{i.product?.sku ?? '?'} {sizeLabel(i.product?.unit_size_g ?? null)} ×{i.qty_ordered}</div>
                      ))}
                      {po.items.length > 4 && <div>+{po.items.length - 4} more</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Card({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-500">{icon}{label}</div>
      <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}
