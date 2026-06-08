import Link from 'next/link';
import { Package, AlertTriangle, Boxes, TrendingDown, Receipt, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { getStockData, summariseSite, computeStatus, STATUS_META, type StockStatus } from '@/lib/stock';
import type { StockRow } from '@/lib/supabase-logistics';
import { flavourColor } from '@/lib/flavours';
import { getShortestDated, expiryStatus, EXPIRY_META } from '@/lib/lots';
import { getBillingHighlights, SITE_LABEL } from '@/lib/billing';
import { getActionCenter } from '@/lib/actionCenter';
import SyncNowButton from '@/components/stock/SyncNowButton';
import ActionCenter from '@/components/stock/ActionCenter';
import ProductThumb from '@/components/ProductThumb';
import { siteShort } from '@/lib/site';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
      <span className="h-1.5 w-1.5 rounded-full bg-paper/85" />
      {meta.label}
    </span>
  );
}

function sizeText(g: { unit_size_g: number | null }) {
  return g.unit_size_g ? (g.unit_size_g >= 1000 ? `${g.unit_size_g / 1000}kg` : `${g.unit_size_g}g`) : '';
}

// Compact, flavour-grouped overview: one product image per flavour, a column per size,
// with each site's available + cover + status dot underneath. Fits many SKUs on a phone.
function StockTable({ groups }: { groups: ProductGroup[] }) {
  const byFlavour: { flavour: string; thumb: string | null; variants: ProductGroup[] }[] = [];
  const idx = new Map<string, number>();
  for (const g of groups) {
    const key = g.flavour ?? g.name;
    let i = idx.get(key);
    if (i == null) { i = byFlavour.length; idx.set(key, i); byFlavour.push({ flavour: key, thumb: g.flavour, variants: [] }); }
    byFlavour[i].variants.push(g);
  }
  for (const f of byFlavour) f.variants.sort((a, b) => (SIZE_ORDER[a.size_code ?? 'M'] ?? 1) - (SIZE_ORDER[b.size_code ?? 'M'] ?? 1));

  const SITES = ['ALTONA', 'MANCHESTER'];
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {byFlavour.map((f) => (
        <div key={f.flavour} className="rounded-xl border border-gray-200 bg-paper p-2.5 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <ProductThumb flavour={f.thumb} size={30} />
            <div className="truncate font-semibold leading-tight text-caramel">{f.flavour}</div>
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${f.variants.length}, minmax(0,1fr))` }}>
            {f.variants.map((v) => (
              <div key={v.product_id} className="rounded-lg bg-cream/60 px-2 py-1.5">
                <div className="mb-1 text-[11px] font-semibold text-caramel">{sizeText(v) || v.sku}</div>
                <div className="space-y-0.5">
                  {SITES.map((code) => {
                    const r = v.bySite[code];
                    if (!r) return null;
                    const st = computeStatus(r);
                    return (
                      <div key={code} className="flex items-center gap-1 text-[11px] leading-tight">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_META[st].bg }} />
                        <span className="text-gray-400">{siteShort(code)}</span>
                        <span className="font-semibold text-caramel">{fmtInt(r.available)}</span>
                        <span className="text-gray-400">{cover(r.days_of_cover)}</span>
                        {r.inbound > 0 && <span className="text-tppblue">+{fmtInt(r.inbound)}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PriorityRow({ label, rows }: { label: string; rows: StockRow[] }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <TrendingDown className="h-5 w-5 text-red-500" />
        <h2 className="text-lg font-semibold text-caramel">Highest priority</h2>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">{label}</span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 bg-paper px-4 py-3 text-sm text-gray-400">Nothing urgent here — stock looks healthy or sales velocity is still building.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {rows.map((r) => (
            <div key={r.product_id} className="rounded-lg border border-gray-200 bg-paper p-2.5 shadow-sm" style={{ borderTop: `3px solid ${flavourColor(r.flavour)}` }}>
              <div className="flex items-center gap-2">
                <ProductThumb flavour={r.flavour} size={34} />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold leading-tight text-caramel">{r.flavour}</div>
                  <div className="text-[10px] text-gray-500">{r.sku} · {r.unit_size_g && r.unit_size_g >= 1000 ? `${r.unit_size_g / 1000}kg` : `${r.unit_size_g}g`}</div>
                </div>
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-lg font-bold leading-none text-caramel">{cover(r.days_of_cover)}</span>
                <span className="text-[10px] text-gray-400">cover</span>
              </div>
              <div className="mt-0.5 text-[10px] text-gray-500">
                {fmtInt(r.available)} avail{r.inbound > 0 && <span className="text-tppblue"> · +{fmtInt(r.inbound)} in</span>}
              </div>
              <div className="mt-1.5"><StatusPill status={computeStatus(r)} /></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default async function StockOverviewPage() {
  const { sites, rows, lastSync } = await getStockData();
  const shortestDated = await getShortestDated(6);
  const billing = await getBillingHighlights();
  const actions = await getActionCenter();

  const groups = groupProducts(rows).filter((g) => g.active);
  const sortBySizeName = (a: ProductGroup, b: ProductGroup) =>
    (a.flavour ?? a.name).localeCompare(b.flavour ?? b.name) ||
    (SIZE_ORDER[a.size_code ?? 'M'] ?? 1) - (SIZE_ORDER[b.size_code ?? 'M'] ?? 1);

  const primary = groups.filter((g) => g.tier === 'primary' && g.category === 'mix').sort(sortBySizeName);
  const secondaryMix = groups.filter((g) => g.tier === 'secondary' && g.category === 'mix').sort(sortBySizeName);
  const other = groups.filter((g) => g.category !== 'mix').sort((a, b) => a.category.localeCompare(b.category) || a.sku.localeCompare(b.sku));

  const hasVelocity = rows.some((r) => r.days_of_cover != null);

  // 5 SKUs running out soonest per site (selling + lowest cover)
  const urgentFor = (site: string) => rows
    .filter((r) => r.active && r.category === 'mix' && r.location_code === site && r.days_of_cover != null)
    .sort((a, b) => (a.days_of_cover ?? 1e9) - (b.days_of_cover ?? 1e9))
    .slice(0, 6);
  const urgentAU = urgentFor('ALTONA');
  const urgentUK = urgentFor('MANCHESTER');

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-caramel sm:text-2xl">Stock Overview</h1>
          <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">
            Live on-hand · Altona (AU) &amp; Manchester (UK)
            {lastSync && <> · synced {lastSync}</>}
          </p>
        </div>
        <SyncNowButton />
      </div>

      {/* Highest priority — top of page, per site */}
      <PriorityRow label="Altona" rows={urgentAU} />
      <PriorityRow label="Manchester" rows={urgentUK} />

      {/* Site summary cards — 2-up on mobile */}
      <div className="mb-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {sites.map((s) => {
          const sum = summariseSite(rows, s.code);
          return (
            <div key={s.id} className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm sm:p-4">
              <div className="flex items-center justify-between">
                <p className="truncate text-xs font-semibold text-caramel sm:text-sm">{s.name.replace(' ShipBob', '')}</p>
                <span className="rounded-full bg-cream px-1.5 py-0.5 text-[10px] font-medium text-maple">{s.country}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-xl font-bold text-caramel sm:text-2xl">{fmtInt(sum.units)}</span>
                <span className="text-[11px] text-gray-400">units</span>
              </div>
              <div className="mt-2 space-y-1 text-[11px]">
                <div className="flex justify-between"><span className="text-gray-400">Value</span><span className="font-semibold text-caramel">{fmtMoney(sum.value, s.currency)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">SKUs</span><span className="font-semibold text-caramel">{sum.skuCount}</span></div>
              </div>
              <div className="mt-2 text-[11px] leading-tight">
                {sum.oos > 0 ? (
                  <span className="inline-flex items-center gap-1 font-medium text-red-600"><AlertTriangle className="h-3 w-3" /> {sum.oos} OOS</span>
                ) : (
                  <span className="font-medium text-emerald-600">All in stock</span>
                )}
                {sum.primaryOos > 0 && <span className="font-medium text-red-700"> · {sum.primaryOos} primary</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Action Center — proactive: what needs attention (6 at a time, dismissable) */}
      <ActionCenter actions={actions} />

      {/* Billing highlights */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-caramel" />
            <h2 className="text-lg font-semibold text-caramel">Billing this month</h2>
          </div>
          <Link href="/logistics/shipping" className="text-xs font-medium text-maple hover:underline">View all →</Link>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {billing.map((h) => {
            const up = h.momPct != null && h.momPct > 0;
            return (
              <div key={h.site} className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm sm:p-4">
                <div className="flex items-center justify-between gap-1">
                  <p className="truncate text-xs font-semibold text-caramel sm:text-sm">{SITE_LABEL[h.site]}</p>
                  {h.momPct != null && (
                    <span className={`inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium ${up ? 'text-red-600' : 'text-emerald-600'}`}>
                      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {Math.abs(h.momPct)}%
                    </span>
                  )}
                </div>
                <div className="mt-1 text-lg font-bold text-caramel sm:text-xl">{fmtMoney(h.thisMonth, h.currency)}</div>
                <div className="text-[11px] text-gray-400">shipping · last mo {fmtMoney(h.lastMonth, h.currency)}</div>
                <div className="mt-1.5 text-[11px] leading-tight">
                  {h.outlierExposure > 0 && <span className="font-medium text-red-600">⚠ {fmtMoney(h.outlierExposure, h.currency)} over ({h.outlierCount})</span>}
                  {h.unpaidCount > 0 && <span className="font-medium text-amber-600"> {h.unpaidCount} unpaid</span>}
                  {h.outlierExposure === 0 && h.unpaidCount === 0 && <span className="text-emerald-600">No flags</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Shortest-dated stock (best-before) */}
      {shortestDated.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-caramel">Shortest-dated stock</h2>
            <a href="/logistics/batches" className="text-[11px] font-medium text-maple underline">view all batches</a>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shortestDated.map((l) => {
              const meta = EXPIRY_META[expiryStatus(l.days_left)];
              return (
                <div key={l.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-paper p-3 shadow-sm"
                  style={{ borderLeft: `4px solid ${flavourColor(l.flavour)}` }}>
                  <ProductThumb flavour={l.flavour} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-caramel">{l.flavour ?? l.sku} {l.unit_size_g ? (l.unit_size_g >= 1000 ? `${l.unit_size_g / 1000}kg` : `${l.unit_size_g}g`) : ''}</div>
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
          <h2 className="text-lg font-semibold text-caramel">Primary SKUs</h2>
          <span className="rounded-full bg-caramel/10 px-2 py-0.5 text-[11px] font-medium text-maple">top priority</span>
        </div>
        <StockTable groups={primary} />
      </section>

      {/* Secondary SKUs */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Boxes className="h-5 w-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-caramel">Secondary SKUs</h2>
        </div>
        <StockTable groups={secondaryMix} />
      </section>

      {/* Syrup & accessories */}
      {other.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="h-5 w-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-caramel">Syrup &amp; Accessories</h2>
          </div>
          <StockTable groups={other} />
        </section>
      )}
    </div>
  );
}
