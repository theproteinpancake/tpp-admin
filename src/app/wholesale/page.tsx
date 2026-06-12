import { Store, TrendingUp, TrendingDown, Clock, AlertTriangle } from 'lucide-react';
import { getWholesaleDashboard } from '@/lib/wholesale';
import SyncWholesaleButton from '@/components/wholesale/SyncWholesaleButton';
import DueActions from '@/components/wholesale/DueActions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—');
const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const p = pct(cur, prev);
  if (p === null) return <span className="text-xs text-gray-400">—</span>;
  const up = p >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{Math.abs(p)}%
    </span>
  );
}

export default async function WholesaleDashboard() {
  const d = await getWholesaleDashboard();
  const maxMonth = Math.max(1, ...d.months.map((m) => m.total));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Store className="h-6 w-6 text-caramel" />
          <div>
            <h1 className="text-xl font-bold text-caramel">Wholesale</h1>
            <p className="text-sm text-gray-500">{d.customer_count} active wholesale customers</p>
          </div>
        </div>
        <SyncWholesaleButton />
      </div>

      {/* Totals */}
      <div className="mb-6 grid grid-cols-3 gap-2">
        {[
          { label: 'This week', cur: d.totals.week, prev: d.totals.prev_week, sub: 'vs last wk' },
          { label: 'This month', cur: d.totals.month, prev: d.totals.prev_month, sub: 'vs last mo' },
          { label: 'This year', cur: d.totals.year, prev: d.totals.prev_year, sub: 'vs last yr' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm sm:p-4">
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400 sm:text-xs">{c.label}</p>
            <p className="mt-1 text-lg font-bold text-caramel sm:text-2xl">{money(c.cur)}</p>
            <p className="mt-1 flex items-center gap-1 text-[10px] text-gray-400 sm:text-xs"><Delta cur={c.cur} prev={c.prev} /> {c.sub}</p>
          </div>
        ))}
      </div>

      {/* Trend */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-paper p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-caramel">Monthly wholesale sales (12 mo)</p>
        <div className="flex h-40 items-end gap-1.5">
          {d.months.map((m, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full items-end justify-center" style={{ height: '128px' }}>
                <div className="w-full rounded-t bg-caramel/80" style={{ height: `${Math.round((m.total / maxMonth) * 100)}%` }} title={money(m.total)} />
              </div>
              <span className="text-[10px] text-gray-400">{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Due to reorder — full-width table: cycle / last order / expected / how late */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-paper p-4 shadow-sm">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-caramel"><Clock className="h-4 w-4 text-caramel" /> Due to reorder</p>
        {d.due.length === 0 ? <p className="text-sm text-gray-400">No customers due right now.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="px-2 py-1.5 font-semibold">Customer</th>
                  <th className="px-2 py-1.5 text-right font-semibold" title="their average gap between orders">Order cycle</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Last order</th>
                  <th className="px-2 py-1.5 text-right font-semibold" title="last order + their cycle">Expected</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Status</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {d.due.slice(0, 12).map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0 hover:bg-cream/20">
                    <td className="max-w-[260px] truncate px-2 py-2 font-medium text-caramel">{c.name}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-gray-600">every ~{c.avg_interval_days}d</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-gray-600">{fmtDate(c.last_order)} <span className="text-[11px] text-gray-400">({c.days_since}d ago)</span></td>
                    <td className="whitespace-nowrap px-2 py-2 text-right text-gray-600">{fmtDate(c.expected_next)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${c.overdue_days >= 14 ? 'bg-red-100 text-red-700' : c.overdue_days >= 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {c.overdue_days >= 0 ? `${c.overdue_days}d late` : `due in ${Math.abs(c.overdue_days)}d`}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right"><DueActions id={c.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top customers */}
        <div className="rounded-xl border border-gray-200 bg-paper p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-caramel">Top customers</p>
          <div className="space-y-2">
            {d.topCustomers.map((c, i) => (
              <div key={c.name} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-caramel"><span className="mr-2 text-gray-300">{i + 1}</span>{c.name}</span>
                <span className="shrink-0 text-gray-500">{money(c.total_value)} <span className="text-xs text-gray-400">· {c.order_count}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lapsed customers (re-engagement) */}
      {d.lapsed.length > 0 && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-paper p-4 shadow-sm">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-caramel"><AlertTriangle className="h-4 w-4 text-amber-500" /> Lapsed — worth a re-engagement nudge</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {d.lapsed.map((c) => (
              <div key={c.name} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-caramel">{c.name}</span>
                <span className="shrink-0 text-xs text-gray-400">last {fmtDate(c.last_order)} · {c.days_since}d ago · {money(c.total_value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 320g stock + reorder timing */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-paper p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-caramel">320g wholesale stock (Altona) — when to reorder from ABC</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
                <th className="py-2">Flavour</th><th className="py-2">SKU</th><th className="py-2 text-right">Available</th>
                <th className="py-2 text-right">Inbound</th><th className="py-2 text-right">~Units/day</th>
                <th className="py-2 text-right">Cover</th><th className="py-2 text-right">Order by</th>
              </tr>
            </thead>
            <tbody>
              {d.stock.map((s) => {
                const urgent = s.days_cover != null && s.days_cover <= 45;
                return (
                  <tr key={s.sku} className="border-b border-gray-50">
                    <td className="py-2 text-caramel">{s.flavour}</td>
                    <td className="py-2 text-gray-400">{s.sku}</td>
                    <td className="py-2 text-right text-caramel">{s.available}</td>
                    <td className="py-2 text-right text-gray-500">{s.inbound || '—'}</td>
                    <td className="py-2 text-right text-gray-500">{s.daily}</td>
                    <td className={`py-2 text-right font-medium ${urgent ? 'text-red-600' : 'text-caramel'}`}>{s.days_cover != null ? `${s.days_cover}d` : '—'}</td>
                    <td className="py-2 text-right text-caramel">
                      {urgent && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-red-500" />}{fmtDate(s.reorder_by)}
                    </td>
                  </tr>
                );
              })}
              {d.stock.length === 0 && <tr><td colSpan={7} className="py-3 text-center text-gray-400">No 320g stock data.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
