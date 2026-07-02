'use client';
// For-like replica of the Sales & Data master spreadsheet: weeks down the rows (ascending,
// Jan at top), every metric across the columns (sticky Week column), colour-gradient heatmap,
// the full year laid out (future weeks blank), and a year totals/average row at the bottom.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Week = Record<string, any> & { week_start: string; derived: Record<string, number | null> };
type Dir = 'high' | 'low' | 'none';
type Fmt = 'money' | 'money2' | 'num' | 'pct' | 'x';
type Agg = 'sum' | 'avg';
type Metric = { key: string; label: string; fmt: Fmt; dir: Dir; agg: Agg; derived?: boolean };
type Group = { label: string; metrics: Metric[] };

const GROUPS: Group[] = [
  { label: 'Sales channels', metrics: [
    { key: 'online_sales', label: 'Online', fmt: 'money', dir: 'high', agg: 'sum' },
    { key: 'orders', label: 'Orders', fmt: 'num', dir: 'high', agg: 'sum' },
    { key: 'cr', label: 'CR', fmt: 'pct', dir: 'high', agg: 'avg' },
    { key: 'aov', label: 'AOV', fmt: 'money2', dir: 'high', agg: 'avg' },
    { key: 'shipping_charged', label: 'Ship charged', fmt: 'money', dir: 'none', agg: 'sum' },
    { key: 'orders_nz', label: 'NZ ord', fmt: 'num', dir: 'high', agg: 'sum' },
    { key: 'nz_cr', label: 'NZ CR', fmt: 'pct', dir: 'high', agg: 'avg' },
    { key: 'nz_aov', label: 'NZ AOV', fmt: 'money2', dir: 'high', agg: 'avg' },
    { key: 'orders_uk', label: 'UK ord', fmt: 'num', dir: 'high', agg: 'sum' },
    { key: 'uk_cr', label: 'UK CR', fmt: 'pct', dir: 'high', agg: 'avg' },
    { key: 'uk_aov', label: 'UK AOV', fmt: 'money2', dir: 'high', agg: 'avg' },
    { key: 'amazon_sales_au', label: 'Amazon AU', fmt: 'money', dir: 'high', agg: 'sum' },
    { key: 'amazon_sales_uk', label: 'Amazon UK', fmt: 'money', dir: 'high', agg: 'sum' },
    { key: 'amazon_sales', label: 'Amazon total', fmt: 'money', dir: 'high', agg: 'sum', derived: true },
    { key: 'wholesale_invoices', label: 'Wholesale', fmt: 'money', dir: 'high', agg: 'sum' },
    { key: 'sales_total', label: 'Sales total', fmt: 'money', dir: 'high', agg: 'sum', derived: true },
  ] },
  { label: 'Meta', metrics: [
    { key: 'meta_spend', label: 'Spend', fmt: 'money', dir: 'none', agg: 'sum' },
    { key: 'meta_roas', label: 'ROAS', fmt: 'x', dir: 'high', agg: 'avg' },
    { key: 'meta_purchases', label: 'Purch', fmt: 'num', dir: 'high', agg: 'sum' },
    { key: 'meta_nc_roas', label: 'NC ROAS', fmt: 'x', dir: 'high', agg: 'avg' },
    { key: 'meta_cpa', label: 'CPA', fmt: 'money2', dir: 'low', agg: 'avg' },
    { key: 'meta_nc_cpa', label: 'NC CPA', fmt: 'money2', dir: 'low', agg: 'avg' },
  ] },
  { label: 'Google', metrics: [
    { key: 'google_spend', label: 'Spend', fmt: 'money', dir: 'none', agg: 'sum' },
    { key: 'google_roas', label: 'ROAS', fmt: 'x', dir: 'high', agg: 'avg' },
    { key: 'google_purchases', label: 'Purch', fmt: 'num', dir: 'high', agg: 'sum' },
    { key: 'google_nc_roas', label: 'NC ROAS', fmt: 'x', dir: 'high', agg: 'avg' },
    { key: 'google_cpa', label: 'CPA', fmt: 'money2', dir: 'low', agg: 'avg' },
    { key: 'google_nc_cpa', label: 'NC CPA', fmt: 'money2', dir: 'low', agg: 'avg' },
  ] },
  { label: 'Totals & profits', metrics: [
    { key: 'total_ad_spend', label: 'Ad spend', fmt: 'money', dir: 'none', agg: 'sum', derived: true },
    { key: 'blended_roas', label: 'Bl. ROAS', fmt: 'x', dir: 'high', agg: 'avg', derived: true },
    { key: 'mer', label: 'MER', fmt: 'pct', dir: 'low', agg: 'avg', derived: true },
    { key: 'gross_profit', label: 'Gross profit', fmt: 'money', dir: 'high', agg: 'sum' },
    { key: 'gpm', label: 'GPM', fmt: 'pct', dir: 'high', agg: 'avg', derived: true },
    { key: 'shipbob_charges', label: 'ShipBob', fmt: 'money', dir: 'low', agg: 'sum' },
    { key: 'shipping_ratio', label: 'Ship/sales', fmt: 'pct', dir: 'low', agg: 'avg', derived: true },
    { key: 'online_np', label: 'Online NP', fmt: 'money', dir: 'high', agg: 'sum', derived: true },
    { key: 'wholesale_np', label: 'Whsale NP', fmt: 'money', dir: 'high', agg: 'sum', derived: true },
    { key: 'net_profit', label: 'NET PROFIT', fmt: 'money', dir: 'high', agg: 'sum', derived: true },
    { key: 'npm', label: 'NPM', fmt: 'pct', dir: 'high', agg: 'avg', derived: true },
  ] },
];
const ALL = GROUPS.flatMap((g) => g.metrics);

// Colour-coded section headers (white/dark text chosen for contrast on each bg).
const GROUP_STYLE: Record<string, { bg: string; fg: string }> = {
  'Sales channels': { bg: '#bd6930', fg: '#ffffff' }, // caramel (brand)
  'Meta': { bg: '#1877f2', fg: '#ffffff' },            // Meta blue
  'Google': { bg: '#e8930c', fg: '#3a2400' },          // amber (dark text for contrast)
  'Totals & profits': { bg: '#025c46', fg: '#ffffff' },// profit green
};
const HEAD_BLUE = '#2f5f8a'; // deeper brand blue — readable with white text

const fmt = (v: number | null | undefined, f: Fmt) => {
  if (v == null) return '—';
  if (f === 'money') return '$' + Math.round(v).toLocaleString('en-AU');
  if (f === 'money2') return '$' + v.toFixed(2);
  if (f === 'pct') return (v * 100).toFixed(1) + '%';
  if (f === 'x') return v.toFixed(2) + '×';
  return v.toLocaleString('en-AU');
};
// Amazon AU/UK sales auto-fill from SP-API once connected (Settings); this cell stays editable
// as a manual override either way — /api/analytics/save locks a field once hand-set so
// autofill never overwrites it. Amazon TOTAL is a derived (AU+UK) column, not editable here.
function EditableCell({ weekStart, field, value, onSaved }: { weekStart: string; field: string; value: number | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value != null ? String(value) : '');
  const save = async () => {
    setEditing(false);
    if (val.trim() === (value != null ? String(value) : '')) return; // no change
    await fetch('/api/analytics/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week_start: weekStart, field, value: val }),
    });
    onSaved();
  };
  if (editing) {
    return (
      <input
        autoFocus type="number" defaultValue={val} onClick={(e) => e.stopPropagation()}
        onChange={(e) => setVal(e.target.value)} onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }}
        className="w-20 rounded border border-caramel px-1 py-0.5 text-right text-[12px] tabular-nums focus:outline-none"
      />
    );
  }
  return (
    <span onClick={(e) => { e.stopPropagation(); setEditing(true); }} title={`Click to enter Amazon ${field.endsWith('_uk') ? 'UK' : 'AU'} sales for this week`}
      className="cursor-text decoration-dotted decoration-gray-400 hover:underline">
      {value == null ? '—' : fmt(value, 'money')}
    </span>
  );
}

const wk = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
const valOf = (w: Week, m: Metric): number | null => { const v = m.derived ? w.derived?.[m.key] : w[m.key]; return v == null || v === '' ? null : Number(v); };

export default function SalesMaster({ weeks, year }: { weeks: Week[]; year: number }) {
  const ranges = useMemo(() => {
    const r: Record<string, { min: number; max: number }> = {};
    for (const m of ALL) {
      const vals = weeks.map((w) => valOf(w, m)).filter((v): v is number => v != null);
      r[m.key] = vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : { min: 0, max: 0 };
    }
    return r;
  }, [weeks]);

  const totals = useMemo(() => {
    const t: Record<string, number | null> = {};
    for (const m of ALL) {
      const vals = weeks.map((w) => valOf(w, m)).filter((v): v is number => v != null);
      if (!vals.length) { t[m.key] = null; continue; }
      t[m.key] = m.agg === 'sum' ? vals.reduce((s, v) => s + v, 0) : vals.reduce((s, v) => s + v, 0) / vals.length;
    }
    return t;
  }, [weeks]);

  const tint = (v: number | null, m: Metric) => {
    if (v == null || m.dir === 'none') return undefined;
    const { min, max } = ranges[m.key] || { min: 0, max: 0 };
    if (min === max) return undefined;
    let p = (v - min) / (max - min);
    if (m.dir === 'low') p = 1 - p;
    const hue = Math.round(p * 120); // 0 red → 120 green
    const dist = Math.abs(p - 0.5) * 2; // 0 mid … 1 extreme → outliers pop
    const light = Math.round(95 - dist * 22); // extremes darker/more saturated
    return `hsl(${hue} 72% ${light}%)`;
  };

  const [sel, setSel] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="border-collapse text-[12px]">
        <thead className="sticky top-0 z-20">
          <tr>
            <th rowSpan={2} className="sticky left-0 z-10 border-b border-r border-white/20 px-2 py-2 text-left text-[12px] font-bold text-white" style={{ background: HEAD_BLUE }}>Week</th>
            {GROUPS.map((g, gi) => (
              <th key={g.label} colSpan={g.metrics.length} className={`border-b border-white/20 px-2 py-1.5 text-center text-[12px] font-extrabold uppercase tracking-wide ${gi ? 'border-l-2 border-l-white/50' : ''}`} style={{ background: GROUP_STYLE[g.label]?.bg, color: GROUP_STYLE[g.label]?.fg }}>{g.label}</th>
            ))}
          </tr>
          <tr>
            {GROUPS.map((g, gi) => g.metrics.map((m, mi) => (
              <th key={m.key} className={`whitespace-nowrap border-b border-white/20 px-2 py-1.5 text-right text-[11px] font-bold text-white ${gi && mi === 0 ? 'border-l-2 border-l-white/40' : ''}`} style={{ background: HEAD_BLUE }}>{m.label}</th>
            )))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            const on = sel === w.week_start;
            return (
            <tr key={w.week_start} onClick={() => setSel(on ? null : w.week_start)}
              className={`cursor-pointer border-b last:border-0 ${on ? 'border-y-2 border-caramel' : 'border-gray-100 hover:bg-cream/30'}`}>
              <td className={`sticky left-0 z-10 whitespace-nowrap border-r border-gray-200 px-2 py-1.5 font-semibold ${on ? 'bg-caramel text-white' : 'bg-white text-caramel'}`}>{wk(w.week_start)}</td>
              {GROUPS.map((g, gi) => g.metrics.map((m, mi) => {
                const v = valOf(w, m);
                return (
                  <td key={m.key} className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-gray-700 ${on ? 'border-y-2 border-caramel' : ''} ${gi && mi === 0 ? 'border-l-2 border-l-caramel/20' : ''} ${m.key === 'net_profit' ? 'font-bold text-caramel' : ''}`}
                    style={{ background: tint(v, m) }}>
                    {(m.key === 'amazon_sales_au' || m.key === 'amazon_sales_uk')
                      ? <EditableCell weekStart={w.week_start} field={m.key} value={v} onSaved={() => router.refresh()} />
                      : fmt(v, m.fmt)}
                  </td>
                );
              }))}
            </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-caramel/40 bg-gray-50 font-semibold">
            <td className="sticky left-0 z-10 whitespace-nowrap border-r border-gray-200 bg-gray-50 px-2 py-2 text-caramel">{year} Σ/avg</td>
            {GROUPS.map((g, gi) => g.metrics.map((m, mi) => (
              <td key={m.key} className={`whitespace-nowrap px-2 py-2 text-right tabular-nums text-caramel ${gi && mi === 0 ? 'border-l-2 border-l-caramel/30' : ''}`}>{fmt(totals[m.key], m.fmt)}</td>
            )))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
