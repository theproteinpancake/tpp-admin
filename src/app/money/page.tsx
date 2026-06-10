import { Landmark } from 'lucide-react';
import { requireOwner } from '@/lib/guard';
import { getCashView, type CashItem } from '@/lib/cashflow';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const money = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-AU');
const fmtD = (s: string | null) => s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';

function Chip({ label, value, tone, sub }: { label: string; value: string; tone?: 'good' | 'bad'; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-caramel'}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  );
}

function ItemTable({ title, items, empty }: { title: string; items: CashItem[]; empty: string }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-caramel">{title}</h2>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-gray-200 text-right text-[10px] uppercase tracking-wide text-gray-400">
              <th className="px-2 py-1.5 text-left font-semibold">Who</th>
              <th className="px-2 py-1.5 text-left font-semibold">Ref</th>
              <th className="px-2 py-1.5 font-semibold">Due</th>
              <th className="px-2 py-1.5 font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={n} className="border-b border-gray-100 text-right last:border-0 hover:bg-cream/40">
                <td className="max-w-[220px] truncate px-2 py-2 text-left font-medium text-caramel">{i.who}{i.source === 'inbox' && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-700">NOT IN XERO</span>}</td>
                <td className="max-w-[140px] truncate px-2 py-2 text-left text-gray-500">{i.ref || '—'}</td>
                <td className={`whitespace-nowrap px-2 py-2 ${i.overdue ? 'font-semibold text-red-600' : 'text-gray-600'}`}>{fmtD(i.due)}{i.overdue ? ' ⚠️' : ''}</td>
                <td className="px-2 py-2 font-semibold tabular-nums text-caramel">{money(i.amount)}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={4} className="px-2 py-4 text-center text-gray-400">{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function MoneyPage() {
  await requireOwner();
  const c = await getCashView();
  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 flex items-center gap-2.5">
        <Landmark className="h-6 w-6 text-caramel" />
        <div>
          <h1 className="text-xl font-bold text-caramel sm:text-2xl">Money</h1>
          <p className="mt-0.5 text-xs text-gray-500">Owner-only. Cash in vs cash out — incl. committed POs and supplier bills the agent spotted in the inbox that aren't in Xero yet.</p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Chip label="Bank" value={c.bank_balance != null ? money(c.bank_balance) : '—'} sub={c.bank_accounts.map((b) => `${b.name} ${money(b.balance)}`).join(' · ') || 'via Xero bank feeds'} />
        <Chip label="Coming in (AR)" value={money(c.ar_total)} tone="good" sub={c.ar_overdue ? `${money(c.ar_overdue)} overdue — chase` : 'invoices owed to you'} />
        <Chip label="Going out" value={money(c.ap_total)} tone="bad" sub="bills + committed POs + wages 30d" />
        <Chip label="Net position" value={money(c.net_30d)} tone={c.net_30d >= 0 ? 'good' : 'bad'} sub="in minus out" />
        <Chip label="Untracked bills" value={money(c.detected_bills)} sub="found in inbox, not in Xero" />
      </div>

      {c.notes.length > 0 && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{c.notes.join(' ')}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <ItemTable title="💵 Coming in — who owes you" items={c.ar_items} empty="Nothing outstanding." />
        <ItemTable title="📤 Going out — what you owe" items={c.ap_items} empty="No upcoming outflows found." />
      </div>
    </div>
  );
}
