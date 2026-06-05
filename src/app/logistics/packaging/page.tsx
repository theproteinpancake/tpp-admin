import { Boxes, Package2, Mail, AlertTriangle } from 'lucide-react';
import { getPouchTracking, getCustomPackaging, PACK_STATUS_META } from '@/lib/packaging';
import { flavourColor } from '@/lib/flavours';
import { setPouchBaseline, deletePackaging } from '@/lib/packagingActions';
import CustomPackagingForm from '@/components/packaging/CustomPackagingForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Pill({ status }: { status: keyof typeof PACK_STATUS_META }) {
  const m = PACK_STATUS_META[status];
  return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: m.bg }}>{m.label}</span>;
}
const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-AU'));

export default async function PackagingPage() {
  const [pouches, custom] = await Promise.all([getPouchTracking(), getCustomPackaging()]);
  const pouchAlerts = pouches.filter((p) => p.status === 'order_now' || p.status === 'order_soon').length;
  const pouchSet = pouches.filter((p) => p.baseline_qty != null).length;
  const customAlerts = custom.filter((c) => c.status === 'order_now' || c.status === 'order_soon').length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Packaging</h1>
        <p className="mt-1 text-gray-500">Empty pouches at ABC &amp; custom shipping packaging — tracked separately from product stock</p>
      </div>

      {/* Summary */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-900">Pouch SKUs tracked</p>
          <div className="mt-2 text-2xl font-bold text-gray-900">{pouchSet}<span className="text-sm font-normal text-gray-400"> / {pouches.length}</span></div>
          <p className="text-xs text-gray-400">baselines entered</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-900">Pouches to reorder</p>
          <div className={`mt-2 text-2xl font-bold ${pouchAlerts ? 'text-red-600' : 'text-emerald-600'}`}>{pouchAlerts}</div>
          <p className="text-xs text-gray-400">within lead time</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-900">Custom packaging to reorder</p>
          <div className={`mt-2 text-2xl font-bold ${customAlerts ? 'text-red-600' : 'text-emerald-600'}`}>{customAlerts}</div>
          <p className="text-xs text-gray-400">boxes &amp; cards</p>
        </div>
      </div>

      {/* Pouches */}
      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <Package2 className="h-5 w-5 text-caramel" />
          <h2 className="text-lg font-semibold text-gray-900">Empty pouches (ABC)</h2>
        </div>
        <p className="mb-3 text-xs text-gray-500">Enter the stock-take baseline ABC provides. Every PO placed after that date auto-deducts, giving a live remaining count and a reorder flag at lead time (default 60 days).</p>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Pouch (SKU)', 'Baseline', 'Used (POs)', 'Remaining', '~Days cover', 'Status', 'Set / update baseline'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pouches.map((p) => (
                <tr key={p.product_id} className="hover:bg-cream/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-1.5 rounded-full" style={{ backgroundColor: flavourColor(p.flavour) }} />
                      <span className="text-sm font-medium text-gray-900">{p.flavour} {p.size}</span>
                      <span className="text-[11px] text-gray-400">{p.sku}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{fmt(p.baseline_qty)}{p.baseline_date && <span className="block text-[11px] text-gray-400">from {p.baseline_date}</span>}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.baseline_qty != null ? `−${fmt(p.consumed)}` : '—'}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">{fmt(p.remaining)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.days_cover != null ? `${p.days_cover}d` : '—'}</td>
                  <td className="px-4 py-3"><Pill status={p.status} /></td>
                  <td className="px-4 py-3">
                    <form action={async (fd) => { 'use server'; await setPouchBaseline(fd); }} className="flex items-center gap-1.5">
                      <input type="hidden" name="product_id" value={p.product_id} />
                      <input name="baseline_qty" type="number" defaultValue={p.baseline_qty ?? ''} placeholder="qty"
                        className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-caramel focus:outline-none" />
                      <input name="lead_days" type="number" defaultValue={p.lead_days} title="lead days"
                        className="w-14 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-caramel focus:outline-none" />
                      <button type="submit" className="rounded-md bg-caramel px-2.5 py-1 text-xs font-medium text-white hover:opacity-90">Save</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Custom packaging */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-maple" />
            <h2 className="text-lg font-semibold text-gray-900">Custom shipping packaging</h2>
          </div>
          <CustomPackagingForm />
        </div>
        {custom.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
            No custom packaging yet. Add your shipping boxes (Visy AU / CBS UK) and thank-you cards (China) to track on-hand and reorder timing.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Item', 'Type', 'Supplier', 'Site', 'On hand', 'Lead', 'Reorder pt', 'Status', ''].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {custom.map((c) => (
                  <tr key={c.id} className="hover:bg-cream/30">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      <span className="inline-flex items-center gap-1.5">{c.kind === 'card' ? <Mail className="h-3.5 w-3.5 text-gray-400" /> : <Boxes className="h-3.5 w-3.5 text-gray-400" />}{c.name}</span>
                      {c.sku && <span className="ml-1 text-[11px] text-gray-400">{c.sku}</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.kind}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.supplier || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.site || '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900">{fmt(c.on_hand)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.lead_days}d</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmt(c.reorder_point)}</td>
                    <td className="px-4 py-3"><Pill status={c.status} /></td>
                    <td className="px-4 py-3">
                      <form action={async () => { 'use server'; await deletePackaging(c.id); }}>
                        <button type="submit" className="text-xs text-gray-400 hover:text-red-600">Remove</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-400"><AlertTriangle className="h-3.5 w-3.5" /> On-hand is entered manually for now — once we identify the ShipBob packaging SKUs we can pull these live like product stock.</p>
      </section>
    </div>
  );
}
