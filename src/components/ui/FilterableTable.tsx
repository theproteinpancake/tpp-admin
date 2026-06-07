'use client';
// Reusable filter/sort table. Server pages fetch plain rows and pass a column config
// (with client-side cell renderers) — this handles global search, per-column dropdown
// filters, a date-range filter, and click-to-sort headers, all client-side.
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Search, X } from 'lucide-react';

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sort?: 'text' | 'num' | 'date'; // present = sortable
  value?: (row: T) => unknown;    // value used for sort/filter (default row[key])
  filter?: 'select' | 'date';     // adds a control to the toolbar
  align?: 'right' | 'center';
  th?: string;
  td?: string;
};

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

function val<T>(col: Column<T>, row: T): unknown {
  return col.value ? col.value(row) : (row as Record<string, unknown>)[col.key];
}
const asNum = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0);
const asTime = (v: unknown) => { const t = v instanceof Date ? v.getTime() : Date.parse(String(v ?? '')); return Number.isNaN(t) ? 0 : t; };
const asText = (v: unknown) => String(v ?? '').toLowerCase();

export default function FilterableTable<T>({
  columns, rows, getKey, initialSort, searchable = true, searchPlaceholder = 'Search…', empty = 'Nothing to show.',
}: {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T, i: number) => string | number;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  searchable?: boolean;
  searchPlaceholder?: string;
  empty?: ReactNode;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortState>(initialSort ?? null);
  const [selects, setSelects] = useState<Record<string, string>>({});
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const selectCols = columns.filter((c) => c.filter === 'select');
  const dateCol = columns.find((c) => c.filter === 'date');

  const distinct = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const c of selectCols) {
      const set = new Set<string>();
      for (const r of rows) { const v = val(c, r); if (v != null && v !== '') set.add(String(v)); }
      m[c.key] = [...set].sort((a, b) => a.localeCompare(b));
    }
    return m;
  }, [rows, selectCols]);

  const filtered = useMemo(() => {
    let out = rows;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      out = out.filter((r) => columns.some((c) => asText(val(c, r)).includes(needle)));
    }
    for (const c of selectCols) {
      const sel = selects[c.key];
      if (sel) out = out.filter((r) => String(val(c, r) ?? '') === sel);
    }
    if (dateCol && (from || to)) {
      const lo = from ? Date.parse(from) : -Infinity;
      const hi = to ? Date.parse(to) + 864e5 - 1 : Infinity;
      out = out.filter((r) => { const t = asTime(val(dateCol, r)); return t >= lo && t <= hi; });
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        const cmp = col.sort === 'num' ? (a: T, b: T) => asNum(val(col, a)) - asNum(val(col, b))
          : col.sort === 'date' ? (a: T, b: T) => asTime(val(col, a)) - asTime(val(col, b))
          : (a: T, b: T) => asText(val(col, a)).localeCompare(asText(val(col, b)));
        out = [...out].sort((a, b) => (sort.dir === 'asc' ? cmp(a, b) : -cmp(a, b)));
      }
    }
    return out;
  }, [rows, q, selects, from, to, sort, columns, selectCols, dateCol]);

  const toggleSort = (c: Column<T>) => {
    if (!c.sort) return;
    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.sort === 'text' ? 'asc' : 'desc' }));
  };
  const active = !!q || Object.values(selects).some(Boolean) || !!from || !!to;
  const clearAll = () => { setQ(''); setSelects({}); setFrom(''); setTo(''); };

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {searchable && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder}
              className="w-48 rounded-lg border border-gray-200 py-1.5 pl-8 pr-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-caramel focus:outline-none focus:ring-1 focus:ring-caramel" />
          </div>
        )}
        {selectCols.map((c) => (
          <select key={c.key} value={selects[c.key] || ''} onChange={(e) => setSelects((s) => ({ ...s, [c.key]: e.target.value }))}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:border-caramel focus:outline-none">
            <option value="">{c.header}: All</option>
            {distinct[c.key]?.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        ))}
        {dateCol && (
          <div className="flex items-center gap-1 text-sm text-gray-500">
            <span className="text-xs">{dateCol.header}:</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:border-caramel focus:outline-none" />
            <span className="text-xs">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-700 focus:border-caramel focus:outline-none" />
          </div>
        )}
        {active && (
          <button onClick={clearAll} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{filtered.length} of {rows.length}</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[11px] uppercase tracking-wide text-gray-400">
              {columns.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-semibold ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''} ${c.sort ? 'cursor-pointer select-none hover:text-gray-600' : ''} ${c.th || ''}`}
                  onClick={() => toggleSort(c)}>
                  <span className={`inline-flex items-center gap-1 ${c.align === 'right' ? 'flex-row-reverse' : ''}`}>
                    {c.header}
                    {c.sort && (sort?.key === c.key ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={getKey(r, i)} className="border-b border-gray-100 last:border-0 hover:bg-cream/40">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2.5 align-middle ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''} ${c.td || ''}`}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-gray-400">{empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
