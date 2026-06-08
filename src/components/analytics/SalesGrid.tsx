'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, ArrowUpRight, ArrowDownRight, Loader2 } from 'lucide-react';

type Derived = { sales_total: number; total_ad_spend: number; blended_roas: number | null; mer: number | null; gpm: number | null; wholesale_np: number; online_np: number; net_profit: number; npm: number | null; shipping_ratio: number | null; cr: number | null };
type Week = Record<string, any> & { week_start: string; derived: Derived };

const money = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
const money2 = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
const pct = (n: number | null | undefined) => n == null ? '—' : `${(n * 100).toFixed(1)}%`;
const num = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('en-AU');
const x = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(2)}×`;
const wkLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });

function Delta({ cur, prev, invert }: { cur: number | null; prev: number | null; invert?: boolean }) {
  if (cur == null || prev == null || prev === 0) return null;
  const chg = (cur - prev) / Math.abs(prev);
  const up = chg >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${good ? 'text-emerald-600' : 'text-red-600'}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(Math.round(chg * 100))}%
    </span>
  );
}

function Kpi({ label, value, cur, prev, invert }: { label: string; value: string; cur: number | null; prev: number | null; invert?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <div className="mt-1 flex items-baseline justify-between gap-1">
        <span className="text-lg font-bold text-caramel sm:text-xl">{value}</span>
        <Delta cur={cur} prev={prev} invert={invert} />
      </div>
    </div>
  );
}

// Editable manual cell (saves on blur, marks the field locked server-side)
function Cell({ week, field, value, kind = 'num', onSaved }: { week: string; field: string; value: any; kind?: 'num' | 'money' | 'text'; onSaved: () => void }) {
  const [v, setV] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (String(v) === String(value ?? '')) return;
    setBusy(true);
    try { await fetch('/api/analytics/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ week_start: week, field, value: v }) }); onSaved(); }
    finally { setBusy(false); }
  };
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} disabled={busy}
      inputMode={kind === 'text' ? 'text' : 'decimal'}
      className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-caramel focus:border-caramel focus:outline-none focus:ring-1 focus:ring-caramel" />
  );
}

const META = [['meta_spend', 'Spend', 'money'], ['meta_roas', 'ROAS'], ['meta_purchases', 'Purch'], ['meta_nc_roas', 'NC ROAS'], ['meta_cpa', 'CPA', 'money'], ['meta_nc_cpa', 'NC CPA', 'money']] as const;
const GOOGLE = [['google_spend', 'Spend', 'money'], ['google_roas', 'ROAS'], ['google_purchases', 'Purch'], ['google_nc_roas', 'NC ROAS'], ['google_cpa', 'CPA', 'money'], ['google_nc_cpa', 'NC CPA', 'money']] as const;
const AMAZON = [['amazon_sales', 'Sales', 'money'], ['amazon_purchases', 'Purch'], ['amazon_spend', 'Spend', 'money'], ['amazon_roas', 'ROAS']] as const;

export default function SalesGrid({ weeks, targetSales, targetNp }: { weeks: Week[]; targetSales: number; targetNp: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try { await fetch('/api/analytics/autofill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weeks: 4 }) }); router.refresh(); }
    finally { setBusy(false); }
  };
  const onSaved = () => router.refresh();

  if (!weeks.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-paper p-8 text-center text-sm text-gray-500">
        No weeks yet. <button onClick={refresh} className="font-medium text-maple underline">Pull this week from Shopify/Xero/ShipBob</button>.
      </div>
    );
  }

  const cur = weeks[0], prev = weeks[1];
  const d = cur.derived, pd = prev?.derived;
  const editGroup = (title: string, fields: readonly (readonly string[])[]) => (
    <div className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm">
      <p className="mb-2 text-xs font-semibold text-caramel">{title}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {fields.map(([f, lbl, kind]) => (
          <div key={f}>
            <p className="mb-0.5 text-[10px] text-gray-400">{lbl}</p>
            <Cell week={cur.week_start} field={f} value={cur[f]} kind={(kind as any) || 'num'} onSaved={onSaved} />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Refresh + week label */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-500">Week of <span className="font-semibold text-caramel">{wkLabel(cur.week_start)}</span>{cur.auto_filled_at ? '' : ' · not yet synced'}</p>
        <button onClick={refresh} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-caramel px-3 py-2 text-sm font-medium text-white hover:bg-maple disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </button>
      </div>

      {/* KPI summary with WoW deltas */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-4">
        <Kpi label="Sales total" value={money(d.sales_total)} cur={d.sales_total} prev={pd?.sales_total ?? null} />
        <Kpi label="Net profit" value={money(d.net_profit)} cur={d.net_profit} prev={pd?.net_profit ?? null} />
        <Kpi label="NPM" value={pct(d.npm)} cur={d.npm} prev={pd?.npm ?? null} />
        <Kpi label="Orders" value={num(cur.orders)} cur={cur.orders} prev={prev?.orders ?? null} />
        <Kpi label="Online sales" value={money(cur.online_sales)} cur={cur.online_sales} prev={prev?.online_sales ?? null} />
        <Kpi label="AOV" value={money2(cur.aov)} cur={cur.aov} prev={prev?.aov ?? null} />
        <Kpi label="Wholesale" value={money(cur.wholesale_invoices)} cur={cur.wholesale_invoices} prev={prev?.wholesale_invoices ?? null} />
        <Kpi label="Ad spend" value={money(d.total_ad_spend)} cur={d.total_ad_spend} prev={pd?.total_ad_spend ?? null} invert />
        <Kpi label="Blended ROAS" value={x(d.blended_roas)} cur={d.blended_roas} prev={pd?.blended_roas ?? null} />
        <Kpi label="MER" value={pct(d.mer)} cur={d.mer} prev={pd?.mer ?? null} invert />
        <Kpi label="Gross profit" value={money(cur.gross_profit)} cur={cur.gross_profit} prev={prev?.gross_profit ?? null} />
        <Kpi label="ShipBob" value={money(cur.shipbob_charges)} cur={cur.shipbob_charges} prev={prev?.shipbob_charges ?? null} invert />
      </div>

      {/* Targets */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm">
          <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Sales vs ${(targetSales / 1000).toFixed(0)}k target</p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-cream"><div className="h-full rounded-full bg-caramel" style={{ width: `${Math.min(100, Math.round((d.sales_total / targetSales) * 100))}%` }} /></div>
          <p className="mt-1 text-xs text-gray-500">{money(d.sales_total)} · {Math.round((d.sales_total / targetSales) * 100)}%</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm">
          <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Net profit vs ${(targetNp / 1000).toFixed(0)}k target</p>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-cream"><div className="h-full rounded-full bg-green-dark" style={{ width: `${Math.min(100, Math.round((d.net_profit / targetNp) * 100))}%` }} /></div>
          <p className="mt-1 text-xs text-gray-500">{money(d.net_profit)} · {Math.round((d.net_profit / targetNp) * 100)}%</p>
        </div>
      </div>

      {/* Editable ad-platform inputs for the current week */}
      <div className="space-y-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Ad platforms — enter for week of {wkLabel(cur.week_start)} (auto-fills once Meta/Google APIs are connected)</p>
        {editGroup('Meta', META)}
        {editGroup('Google', GOOGLE)}
        {editGroup('Amazon', AMAZON)}
        <div className="rounded-xl border border-gray-200 bg-paper p-3 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <div><p className="mb-0.5 text-[10px] text-gray-400">Conversion rate (e.g. 0.049)</p><Cell week={cur.week_start} field="cr" value={cur.cr} onSaved={onSaved} /></div>
            <div><p className="mb-0.5 text-[10px] text-gray-400">Notes for the week</p><Cell week={cur.week_start} field="notes" value={cur.notes} kind="text" onSaved={onSaved} /></div>
          </div>
        </div>
      </div>

      {/* Historical weekly table */}
      <div className="rounded-xl border border-gray-200 bg-paper p-2 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
                {['Week', 'Online', 'Orders', 'AOV', 'Wholesale', 'Amazon', 'Ad spend', 'Sales total', 'GP', 'Net profit', 'NPM', 'Bl. ROAS', 'MER'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week_start} className="border-b border-gray-100 last:border-0 hover:bg-cream/40">
                  <td className="whitespace-nowrap px-2 py-2 font-medium text-caramel">{wkLabel(w.week_start)}</td>
                  <td className="px-2 py-2 text-gray-600">{money(w.online_sales)}</td>
                  <td className="px-2 py-2 text-gray-600">{num(w.orders)}</td>
                  <td className="px-2 py-2 text-gray-600">{money2(w.aov)}</td>
                  <td className="px-2 py-2 text-gray-600">{money(w.wholesale_invoices)}</td>
                  <td className="px-2 py-2 text-gray-600">{money(w.amazon_sales)}</td>
                  <td className="px-2 py-2 text-gray-600">{money(w.derived.total_ad_spend)}</td>
                  <td className="px-2 py-2 font-semibold text-caramel">{money(w.derived.sales_total)}</td>
                  <td className="px-2 py-2 text-gray-600">{money(w.gross_profit)}</td>
                  <td className="px-2 py-2 font-semibold text-caramel">{money(w.derived.net_profit)}</td>
                  <td className="px-2 py-2 text-gray-600">{pct(w.derived.npm)}</td>
                  <td className="px-2 py-2 text-gray-600">{x(w.derived.blended_roas)}</td>
                  <td className="px-2 py-2 text-gray-600">{pct(w.derived.mer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-gray-400">Profit metrics use editable assumptions (wholesale margin, online COGS %, payment fee %). CR &amp; ad-platform figures are manual until APIs are connected. Net-profit formula is an estimate — tell me your exact cost model and I&apos;ll match it.</p>
    </div>
  );
}
