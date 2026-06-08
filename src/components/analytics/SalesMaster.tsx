'use client';
// For-like replica of the Sales & Data master spreadsheet: weeks down the rows, every
// metric across the columns (sticky Week column), with a colour-gradient heatmap per
// metric so trends pop at a glance. Horizontal scroll for the full metric set.
import { useMemo } from 'react';

type Week = Record<string, any> & { week_start: string; derived: Record<string, number | null> };
type Dir = 'high' | 'low' | 'none';
type Fmt = 'money' | 'money2' | 'num' | 'pct' | 'x';
type Metric = { key: string; label: string; fmt: Fmt; dir: Dir; derived?: boolean };
type Group = { label: string; metrics: Metric[] };

const GROUPS: Group[] = [
  { label: 'Sales channels', metrics: [
    { key: 'online_sales', label: 'Online', fmt: 'money', dir: 'high' },
    { key: 'orders', label: 'Orders', fmt: 'num', dir: 'high' },
    { key: 'cr', label: 'CR', fmt: 'pct', dir: 'high' },
    { key: 'aov', label: 'AOV', fmt: 'money2', dir: 'high' },
    { key: 'shipping_charged', label: 'Ship charged', fmt: 'money', dir: 'none' },
    { key: 'orders_nz', label: 'NZ ord', fmt: 'num', dir: 'high' },
    { key: 'nz_aov', label: 'NZ AOV', fmt: 'money2', dir: 'high' },
    { key: 'orders_uk', label: 'UK ord', fmt: 'num', dir: 'high' },
    { key: 'uk_aov', label: 'UK AOV', fmt: 'money2', dir: 'high' },
    { key: 'amazon_sales', label: 'Amazon', fmt: 'money', dir: 'high' },
    { key: 'wholesale_invoices', label: 'Wholesale', fmt: 'money', dir: 'high' },
    { key: 'sales_total', label: 'Sales total', fmt: 'money', dir: 'high', derived: true },
  ] },
  { label: 'Meta', metrics: [
    { key: 'meta_spend', label: 'Spend', fmt: 'money', dir: 'none' },
    { key: 'meta_roas', label: 'ROAS', fmt: 'x', dir: 'high' },
    { key: 'meta_purchases', label: 'Purch', fmt: 'num', dir: 'high' },
    { key: 'meta_nc_roas', label: 'NC ROAS', fmt: 'x', dir: 'high' },
    { key: 'meta_cpa', label: 'CPA', fmt: 'money2', dir: 'low' },
    { key: 'meta_nc_cpa', label: 'NC CPA', fmt: 'money2', dir: 'low' },
  ] },
  { label: 'Google', metrics: [
    { key: 'google_spend', label: 'Spend', fmt: 'money', dir: 'none' },
    { key: 'google_roas', label: 'ROAS', fmt: 'x', dir: 'high' },
    { key: 'google_purchases', label: 'Purch', fmt: 'num', dir: 'high' },
    { key: 'google_nc_roas', label: 'NC ROAS', fmt: 'x', dir: 'high' },
    { key: 'google_cpa', label: 'CPA', fmt: 'money2', dir: 'low' },
    { key: 'google_nc_cpa', label: 'NC CPA', fmt: 'money2', dir: 'low' },
  ] },
  { label: 'Totals & profits', metrics: [
    { key: 'total_ad_spend', label: 'Ad spend', fmt: 'money', dir: 'none', derived: true },
    { key: 'blended_roas', label: 'Bl. ROAS', fmt: 'x', dir: 'high', derived: true },
    { key: 'mer', label: 'MER', fmt: 'pct', dir: 'low', derived: true },
    { key: 'gross_profit', label: 'Gross profit', fmt: 'money', dir: 'high' },
    { key: 'gpm', label: 'GPM', fmt: 'pct', dir: 'high', derived: true },
    { key: 'shipbob_charges', label: 'ShipBob', fmt: 'money', dir: 'low' },
    { key: 'shipping_ratio', label: 'Ship/sales', fmt: 'pct', dir: 'low', derived: true },
    { key: 'online_np', label: 'Online NP', fmt: 'money', dir: 'high', derived: true },
    { key: 'wholesale_np', label: 'Whsale NP', fmt: 'money', dir: 'high', derived: true },
    { key: 'net_profit', label: 'NET PROFIT', fmt: 'money', dir: 'high', derived: true },
    { key: 'npm', label: 'NPM', fmt: 'pct', dir: 'high', derived: true },
  ] },
];
const ALL = GROUPS.flatMap((g) => g.metrics);

const fmt = (v: number | null | undefined, f: Fmt) => {
  if (v == null) return '—';
  if (f === 'money') return '$' + Math.round(v).toLocaleString('en-AU');
  if (f === 'money2') return '$' + v.toFixed(2);
  if (f === 'pct') return (v * 100).toFixed(1) + '%';
  if (f === 'x') return v.toFixed(2) + '×';
  return v.toLocaleString('en-AU');
};
const wk = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: '2-digit' });
const valOf = (w: Week, m: Metric): number | null => { const v = m.derived ? w.derived?.[m.key] : w[m.key]; return v == null || v === '' ? null : Number(v); };

export default function SalesMaster({ weeks }: { weeks: Week[] }) {
  // per-metric min/max for the heatmap
  const ranges = useMemo(() => {
    const r: Record<string, { min: number; max: number }> = {};
    for (const m of ALL) {
      const vals = weeks.map((w) => valOf(w, m)).filter((v): v is number => v != null);
      r[m.key] = { min: Math.min(...vals), max: Math.max(...vals) };
    }
    return r;
  }, [weeks]);

  const tint = (v: number | null, m: Metric) => {
    if (v == null || m.dir === 'none') return undefined;
    const { min, max } = ranges[m.key] || { min: 0, max: 0 };
    if (min === max) return undefined;
    let t = (v - min) / (max - min);
    if (m.dir === 'low') t = 1 - t;
    return `hsl(${Math.round(t * 120)} 75% 90%)`; // red→green pastel
  };

  if (!weeks.length) return <div className="rounded-xl border border-dashed border-gray-300 bg-paper p-8 text-center text-sm text-gray-500">No weekly data yet.</div>;

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-paper shadow-sm">
      <table className="border-collapse text-[11px]">
        <thead>
          <tr className="bg-cream/70">
            <th rowSpan={2} className="sticky left-0 z-10 border-b border-r border-gray-200 bg-cream/95 px-2 py-1.5 text-left font-semibold text-caramel">Week</th>
            {GROUPS.map((g, gi) => (
              <th key={g.label} colSpan={g.metrics.length} className={`border-b border-gray-200 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-maple ${gi ? 'border-l-2 border-l-caramel/30' : ''}`}>{g.label}</th>
            ))}
          </tr>
          <tr className="bg-cream/40">
            {GROUPS.map((g, gi) => g.metrics.map((m, mi) => (
              <th key={m.key} className={`whitespace-nowrap border-b border-gray-200 px-2 py-1 text-right font-semibold text-gray-500 ${gi && mi === 0 ? 'border-l-2 border-l-caramel/30' : ''}`}>{m.label}</th>
            )))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.week_start} className="border-b border-gray-100 last:border-0">
              <td className="sticky left-0 z-10 whitespace-nowrap border-r border-gray-200 bg-paper px-2 py-1.5 font-semibold text-caramel">{wk(w.week_start)}</td>
              {GROUPS.map((g, gi) => g.metrics.map((m, mi) => {
                const v = valOf(w, m);
                return (
                  <td key={m.key} className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-gray-700 ${gi && mi === 0 ? 'border-l-2 border-l-caramel/20' : ''} ${m.key === 'net_profit' ? 'font-bold text-caramel' : ''}`}
                    style={{ background: tint(v, m) }}>
                    {fmt(v, m.fmt)}
                  </td>
                );
              }))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
