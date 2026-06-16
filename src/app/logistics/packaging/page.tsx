import { Boxes, Package2, Mail, AlertTriangle } from 'lucide-react';
import { getPouchTracking, getSrpTracking, getShipperTracking, getCustomPackaging, PACK_STATUS_META } from '@/lib/packaging';
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
  const [pouches, srp, shippers, custom] = await Promise.all([getPouchTracking(), getSrpTracking(), getShipperTracking(), getCustomPackaging()]);
  const srpAlerts = srp.filter((s) => s.status === 'order_now' || s.status === 'order_soon').length;
  const shipperAlerts = shippers.filter((s) => s.status === 'order_now' || s.status === 'order_soon').length;
  const pouchAlerts = pouches.filter((p) => p.status === 'order_now' || p.status === 'order_soon').length;
  const pouchSet = pouches.filter((p) => p.baseline_qty != null).length;
  const customAlerts = custom.filter((c) => c.status === 'order_now' || c.status === 'order_soon').length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-caramel">Packaging</h1>
        <p className="mt-1 text-gray-500">Empty pouches at ABC &amp; custom shipping packaging — tracked separately from product stock</p>
      </div>

      {/* Summary */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-paper p-5 shadow-sm">
          <p className="text-sm font-semibold text-caramel">Pouches to reorder</p>
          <div className={`mt-2 text-2xl font-bold ${pouchAlerts ? 'text-red-600' : 'text-emerald-600'}`}>{pouchAlerts}</div>
          <p className="text-xs text-gray-400">{pouchSet}/{pouches.length} baselines · within lead time</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-paper p-5 shadow-sm">
          <p className="text-sm font-semibold text-caramel">SRP cartons to reorder</p>
          <div className={`mt-2 text-2xl font-bold ${srpAlerts ? 'text-red-600' : 'text-emerald-600'}`}>{srpAlerts}</div>
          <p className="text-xs text-gray-400">shelf-ready · VISY → ABC</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-paper p-5 shadow-sm">
          <p className="text-sm font-semibold text-caramel">Shipping cartons to reorder</p>
          <div className={`mt-2 text-2xl font-bold ${shipperAlerts ? 'text-red-600' : 'text-emerald-600'}`}>{shipperAlerts}</div>
          <p className="text-xs text-gray-400">live ShipBob · VISY → Altona</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-paper p-5 shadow-sm">
          <p className="text-sm font-semibold text-caramel">Custom packaging to reorder</p>
          <div className={`mt-2 text-2xl font-bold ${customAlerts ? 'text-red-600' : 'text-emerald-600'}`}>{customAlerts}</div>
          <p className="text-xs text-gray-400">boxes &amp; cards</p>
        </div>
      </div>

      {/* Pouches */}
      <section className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <Package2 className="h-5 w-5 text-caramel" />
          <h2 className="text-lg font-semibold text-caramel">Empty pouches (ABC)</h2>
        </div>
        <p className="mb-3 text-xs text-gray-500">Enter the stock-take baseline ABC provides. Every PO placed after that date auto-deducts, giving a live remaining count and a reorder flag at lead time (default 60 days).</p>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-paper shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Pouch (SKU)', 'Baseline', 'Used (POs)', 'Pouches left', 'SRP cartons (320g)', 'Packable', '~Days cover', 'Status', 'Set / update baseline'].map((h) => (
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
                      <span className="text-sm font-medium text-caramel">{p.flavour} {p.size}</span>
                      <span className="text-[11px] text-gray-400">{p.sku}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{fmt(p.baseline_qty)}{p.baseline_date && <span className="block text-[11px] text-gray-400">from {p.baseline_date}</span>}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{p.baseline_qty != null ? `−${fmt(p.consumed)}` : '—'}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-caramel">{fmt(p.remaining)}</td>
                  <td className="px-4 py-3 text-sm">
                    {p.srp ? (
                      <span className={p.srp.binding ? 'font-semibold text-red-600' : 'text-gray-600'}>
                        {fmt(p.srp.boxes_remaining)} <span className="text-[11px] text-gray-400">×{p.srp.units_per} = {fmt(p.srp.packable_bags)}</span>
                        {p.srp.binding && <span className="block text-[10px] font-medium uppercase tracking-wide text-red-500">⚠ carton-limited</span>}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-caramel">{fmt(p.packable)}{p.srp?.binding && <span className="block text-[10px] font-normal text-gray-400">of {fmt(p.remaining)} pouches</span>}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{(() => { const d = Math.min(p.days_cover ?? Infinity, p.srp?.days_cover ?? Infinity); return Number.isFinite(d) ? `${d}d` : '—'; })()}</td>
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

      {/* Shelf-ready (SRP) cartons — auto-deduct from the linked 320g SKU's POs */}
      {srp.length > 0 && (
        <section className="mb-10">
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="h-5 w-5 text-caramel" />
            <h2 className="text-lg font-semibold text-caramel">SRP cartons — discontinued 320g</h2>
          </div>
          <p className="mb-3 text-xs text-gray-500">Held shelf-ready cartons for 320g sizes we no longer produce (active flavours show inline on their pouch row above). No active SKU draws these down.</p>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-paper shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Carton', 'Linked SKU', 'Baseline', 'Used (POs)', 'Remaining', '~Days cover', 'Status'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {srp.map((s) => (
                  <tr key={s.id} className="hover:bg-cream/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-1.5 rounded-full" style={{ backgroundColor: flavourColor(s.linked_flavour) }} />
                        <span className="text-sm font-medium text-caramel">{s.name.replace('SRP Box (small) — ', '')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.linked_sku || '—'} <span className="text-[11px] text-gray-400">×{s.units_per}/box</span></td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmt(s.baseline_qty)}{s.baseline_date && <span className="block text-[11px] text-gray-400">from {s.baseline_date}</span>}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.baseline_qty != null ? `−${fmt(s.consumed_boxes)}` : '—'}{s.consumed_units > 0 && <span className="block text-[11px] text-gray-400">{fmt(s.consumed_units)} bags</span>}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-caramel">{fmt(s.remaining)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.days_cover != null ? `${s.days_cover}d` : '—'}</td>
                    <td className="px-4 py-3"><Pill status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Shipping cartons at ShipBob Altona — live stock, ordered from VISY with a WRO label */}
      {shippers.length > 0 && (
        <section className="mb-10">
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="h-5 w-5 text-caramel" />
            <h2 className="text-lg font-semibold text-caramel">Shipping cartons (ShipBob Altona)</h2>
          </div>
          <p className="mb-3 text-xs text-gray-500">Custom shipping cartons held at ShipBob Altona — stock is live from ShipBob. Order from VISY via WhatsApp (&ldquo;order more PANSMALL&rdquo;); they ship to Altona with a WRO label on the pallet so ShipBob can receive them. MOQ 1,000 (increments of 1,000).</p>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-paper shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Carton', 'VISY code', 'Fulfillable', 'On hand', 'Reorder pt', 'Std order', 'Status'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shippers.map((s) => (
                  <tr key={s.id} className="hover:bg-cream/30">
                    <td className="px-4 py-3 text-sm font-medium text-caramel">{s.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{s.visy_code}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-caramel">{s.fulfillable != null ? fmt(s.fulfillable) : <span className="text-gray-300" title="ShipBob live count unavailable">—</span>}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmt(s.onhand)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmt(s.reorder_point)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmt(s.min_order)}</td>
                    <td className="px-4 py-3"><Pill status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-gray-400">Reorder points are starting thresholds — tell me to tune any of them. Live ShipBob fulfillable count; &ldquo;—&rdquo; means ShipBob didn&apos;t return a level for that item.</p>
        </section>
      )}

      {/* Custom packaging */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Boxes className="h-5 w-5 text-maple" />
            <h2 className="text-lg font-semibold text-caramel">Custom shipping packaging</h2>
          </div>
          <CustomPackagingForm />
        </div>
        {custom.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-paper px-4 py-6 text-center text-sm text-gray-500">
            No custom packaging yet. Add your shipping boxes (Visy AU / CBS UK) and thank-you cards (China) to track on-hand and reorder timing.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-paper shadow-sm">
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
                    <td className="px-4 py-3 text-sm font-medium text-caramel">
                      <span className="inline-flex items-center gap-1.5">{c.kind === 'card' ? <Mail className="h-3.5 w-3.5 text-gray-400" /> : <Boxes className="h-3.5 w-3.5 text-gray-400" />}{c.name}</span>
                      {c.sku && <span className="ml-1 text-[11px] text-gray-400">{c.sku}</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.kind}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.supplier || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.site || '—'}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-caramel">{fmt(c.on_hand)}</td>
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
