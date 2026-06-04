import { Package, AlertTriangle, Boxes, TrendingDown, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { getStockData, summariseSite, computeStatus, STATUS_META, type StockStatus } from '@/lib/stock';
import type { StockRow } from '@/lib/supabase-logistics';
import { flavourColor } from '@/lib/flavours';
import { getShortestDated, expiryStatus, EXPIRY_META } from '@/lib/lots';
import TrendSparkline, { type Point } from '@/components/stock/TrendSparkline';
import SyncNowButton from '@/components/stock/SyncNowButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SITE_COLOR: Record<string, string> = { ALTONA: '#C4814A', MANCHESTER: '#4A90A4' };

function fmtInt(n: number) { return n.toLocaleString('en-AU'); }
function fmtMoney(n: number, ccy: string | null) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || 'AUD', maximumFractionDigits: 0 }).format(n);
}
function cover(d: number | null) { return d == null ? '—' : d >= 999 ? '999+' : `${Math.round(d)}d`; }

interface ProductGroup {
  product_id: string; sku: string; name: string; flavour: string | null;
  size_code: string | null; unit_size_g: number | null; tier: string; category: string;
  active: boolean; bySite: Record<string, StockRow>;
}

function groupProducts(rows: StockRow[]) {
  const m = new Map<string, ProductGroup>();
  for (const r of rows) {
    let g = m.get(r.product_id);
    if (!g) {
      g = { product_id: r.product_id, sku: r.sku, name: r.name, flavour: r.flavour,
        size_code: r.size_code, unit_size_g: r.unit_size_g, tier: r.tier, category: r.category,
        active: r.active, bySite: {} };
      m.set(r.product_id, g);
    }
    g.bySite[r.location_code] = r;
  }
  return [...m.values()];
}

const SIZE_ORDER: Record<string, number> = { S: 0, M: 1, L: 2, SAMPLE: 3 };

function StatusPill({ status }: { status: StockStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
      style={{ backgroundColor: meta.bg }}>
      <span className="h-1.5 w-1.5 rounded-full bg-white/85" />
      {meta.label}
    </span>
  );
}

// Trend indicator — sparkline once we have history, otherwise a clear arrow.
function Trend({ points, trend, color }: { points: Point[]; trend: string | null; color: string }) {
  if (points && points.length >= 2) return <TrendSparkline data={points} color={color} />;
  if (trend === 'up') return <span title="sales trending up" className="inline-flex items-center text-emerald-600"><ArrowUp className="h-4 w-4" /></span>;
  if (trend === 'down') return <span title="sales trending down" className="inline-flex items-center text-red-500"><ArrowDown className="h-4 w-4" /></span>;
  if (trend === 'flat') return <span title="steady" className="inline-flex items-center text-gray-400"><Minus className="h-4 w-4" /></span>;
  return <span className="text-xs text-gray-300">—</span>;
}

function SiteCell({ row, points, color }: { row: StockRow | undefined; points: Point[]; color: string }) {
  if (!row) return <td className="px-3 py-3 text-center text-xs text-gray-300">not stocked</td>;
  const status = computeStatus(row);
  return (
    <td className="px-3 py-3 align-middle">
      <div className="flex items-center gap-4">
        <div className="min-w-[78px]">
          <div className="text-base font-semibold text-gray-900 leading-none">{fmtInt(row.on_hand)}</div>
          <div className="mt-0.5 text-[11px] text-gray-500">
            {fmtInt(row.available)} avail · {cover(row.days_of_cover)}
            {row.inbound > 0 && <span className="text-blue-600"> · +{fmtInt(row.inbound)} in</span>}
          </div>
        </div>
        <StatusPill status={status} />
        <div className="ml-auto">{<Trend points={points} trend={row.trend} color={color} />}</div>
      </div>
    </td>
  );
}

function sizeText(g: { unit_size_g: number | null }) {
  return g.unit_size_g ? (g.unit_size_g >= 1000 ? `${g.unit_size_g / 1000}kg` : `${g.unit_size_g}g`) : '';
}

function MobileSiteRow({ name, row }: { name: string; row: StockRow | undefined }) {
  if (!row) {
    return (
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs font-medium text-gray-500">{name}</span>
        <span className="text-xs text-gray-300">not stocked</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="min-w-0">
        <span className="text-xs font-medium text-gray-500">{name}</span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-semibold leading-none text-gray-900">{fmtInt(row.on_hand)}</span>
          <span className="truncate text-[11px] text-gray-500">
            {fmtInt(row.available)} avail · {cover(row.days_of_cover)}
            {row.inbound > 0 && <span className="text-blue-600"> · +{fmtInt(row.inbound)} in</span>}
          </span>
        </div>
      </div>
      <StatusPill status={computeStatus(row)} />
    </div>
  );
}

function StockTable({
  groups, sites, historyByProduct,
}: {
  groups: ProductGroup[];
  sites: { code: string; name: string }[];
  historyByProduct: Map<string, Record<string, Point[]>>;
}) {
  return (
    <>
      {/* Desktop / tablet: comparison table */}
      <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">Product</th>
              {sites.map((s) => (
                <th key={s.code} className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  {s.name.replace(' ShipBob', '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groups.map((g) => {
              const hist = historyByProduct.get(g.product_id) ?? {};
              return (
                <tr key={g.product_id} className="hover:bg-cream/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="h-7 w-1.5 shrink-0 rounded-full" style={{ background: flavourColor(g.flavour) }} />
                      <div>
                        <div className="font-medium text-gray-900">{g.flavour ?? g.name}</div>
                        <div className="text-[11px] text-gray-500">{g.sku}{sizeText(g) ? ` · ${sizeText(g)}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  {sites.map((s) => (
                    <SiteCell key={s.code} row={g.bySite[s.code]} points={hist[s.code] ?? []} color={SITE_COLOR[s.code] ?? '#C4814A'} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: one card per SKU, sites stacked */}
      <div className="space-y-2.5 md:hidden">
        {groups.map((g) => (
          <div key={g.product_id} className="overflow-hidden rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
            style={{ borderLeft: `4px solid ${flavourColor(g.flavour)}` }}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="font-semibold text-gray-900">{g.flavour ?? g.name}</span>
              <span className="text-[11px] text-gray-500">{g.sku}{sizeText(g) ? ` · ${sizeText(g)}` : ''}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {sites.map((s) => (
                <MobileSiteRow key={s.code} name={s.name.replace(' ShipBob', '')} row={g.bySite[s.code]} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default async function StockOverviewPage() {
  const { sites, rows, history, lastSync } = await getStockData();
  const shortestDated = await getShortestDated(6);

  // history -> product -> site -> points
  const historyByProduct = new Map<string, Record<string, Point[]>>();
  for (const h of history) {
    let p = historyByProduct.get(h.product_id);
    if (!p) { p = {}; historyByProduct.set(h.product_id, p); }
    (p[h.location_code] ??= []).push({ date: h.snapshot_date.slice(5), value: h.on_hand });
  }

  const groups = groupProducts(rows).filter((g) => g.active);
  const sortBySizeName = (a: ProductGroup, b: ProductGroup) =>
    (a.flavour ?? a.name).localeCompare(b.flavour ?? b.name) ||
    (SIZE_ORDER[a.size_code ?? 'M'] ?? 1) - (SIZE_ORDER[b.size_code ?? 'M'] ?? 1);

  const primary = groups.filter((g) => g.tier === 'primary' && g.category === 'mix').sort(sortBySizeName);
  const secondaryMix = groups.filter((g) => g.tier === 'secondary' && g.category === 'mix').sort(sortBySizeName);
  const other = groups.filter((g) => g.category !== 'mix').sort((a, b) => a.category.localeCompare(b.category) || a.sku.localeCompare(b.sku));

  const siteList = sites.map((s) => ({ code: s.code, name: s.name }));
  const hasVelocity = rows.some((r) => r.days_of_cover != null);

  // 5 SKUs running out soonest at Altona (selling + lowest cover)
  const urgent = rows
    .filter((r) => r.active && r.category === 'mix' && r.location_code === 'ALTONA' && r.days_of_cover != null)
    .sort((a, b) => (a.days_of_cover ?? 1e9) - (b.days_of_cover ?? 1e9))
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Overview</h1>
          <p className="mt-1 text-gray-500">
            Live on-hand across Altona (AU) and Manchester (UK)
            {lastSync && <> · last synced {lastSync}</>}
          </p>
        </div>
        <SyncNowButton />
      </div>

      {/* Site summary cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {sites.map((s) => {
          const sum = summariseSite(rows, s.code);
          return (
            <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{s.name.replace(' ShipBob', '')}</p>
                <span className="rounded-full bg-cream px-2 py-0.5 text-[11px] font-medium text-maple">{s.country}</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-2xl font-bold text-gray-900">{fmtInt(sum.units)}</span>
                <span className="text-sm text-gray-400">units on hand</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-gray-50 px-2.5 py-1.5">
                  <div className="text-gray-400">Stock value</div>
                  <div className="font-semibold text-gray-700">{fmtMoney(sum.value, s.currency)}</div>
                </div>
                <div className="rounded-lg bg-gray-50 px-2.5 py-1.5">
                  <div className="text-gray-400">SKUs tracked</div>
                  <div className="font-semibold text-gray-700">{sum.skuCount}</div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs">
                {sum.oos > 0 ? (
                  <span className="inline-flex items-center gap-1 font-medium text-red-600">
                    <AlertTriangle className="h-3.5 w-3.5" /> {sum.oos} out of stock
                  </span>
                ) : (
                  <span className="font-medium text-emerald-600">All in stock</span>
                )}
                {sum.primaryOos > 0 && (
                  <span className="font-medium text-red-700">· {sum.primaryOos} primary OOS</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Running out soonest */}
      {urgent.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-red-500" />
            <h2 className="text-lg font-semibold text-gray-900">Highest priority</h2>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">Altona</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {urgent.map((r) => (
              <div key={r.product_id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
                style={{ borderTop: `3px solid ${flavourColor(r.flavour)}` }}>
                <div className="text-sm font-semibold text-gray-900">{r.flavour}</div>
                <div className="text-[11px] text-gray-500">{r.sku} · {r.unit_size_g && r.unit_size_g >= 1000 ? `${r.unit_size_g / 1000}kg` : `${r.unit_size_g}g`}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-xl font-bold text-gray-900">{cover(r.days_of_cover)}</span>
                  <span className="text-[11px] text-gray-400">cover</span>
                </div>
                <div className="mt-0.5 text-[11px] text-gray-500">
                  {fmtInt(r.available)} avail{r.inbound > 0 && <span className="text-blue-600"> · +{fmtInt(r.inbound)} in</span>}
                </div>
                <div className="mt-2"><StatusPill status={computeStatus(r)} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Shortest-dated stock (best-before) */}
      {shortestDated.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-gray-900">Shortest-dated stock</h2>
            <a href="/logistics/batches" className="text-[11px] font-medium text-maple underline">view all batches</a>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shortestDated.map((l) => {
              const meta = EXPIRY_META[expiryStatus(l.days_left)];
              return (
                <div key={l.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
                  style={{ borderLeft: `4px solid ${flavourColor(l.flavour)}` }}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-gray-900">{l.flavour ?? l.sku} {l.unit_size_g ? (l.unit_size_g >= 1000 ? `${l.unit_size_g / 1000}kg` : `${l.unit_size_g}g`) : ''}</div>
                    <div className="text-[11px] text-gray-500">{l.site} · lot {l.lot_number} · {fmtInt(l.on_hand)} units</div>
                    <div className="text-[11px] text-gray-500">
                      best before {l.expiry_date ? new Date(l.expiry_date + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      {l.days_left != null && <> · {l.days_left < 0 ? `${-l.days_left}d ago` : `${l.days_left}d left`}</>}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white" style={{ backgroundColor: meta.bg }}>{meta.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!hasVelocity && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Days-of-cover is shown as “—” until velocity is computed from sales history (next step).
            Trend sparklines fill in as daily snapshots accrue.
          </span>
        </div>
      )}

      {/* Primary SKUs */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Package className="h-5 w-5 text-caramel" />
          <h2 className="text-lg font-semibold text-gray-900">Primary SKUs</h2>
          <span className="rounded-full bg-caramel/10 px-2 py-0.5 text-[11px] font-medium text-maple">top priority</span>
        </div>
        <StockTable groups={primary} sites={siteList} historyByProduct={historyByProduct} />
      </section>

      {/* Secondary SKUs */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Boxes className="h-5 w-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-700">Secondary SKUs</h2>
        </div>
        <StockTable groups={secondaryMix} sites={siteList} historyByProduct={historyByProduct} />
      </section>

      {/* Syrup & accessories */}
      {other.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="h-5 w-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-700">Syrup &amp; Accessories</h2>
          </div>
          <StockTable groups={other} sites={siteList} historyByProduct={historyByProduct} />
        </section>
      )}
    </div>
  );
}
