'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, X } from 'lucide-react';

type Severity = 'critical' | 'warning' | 'info';
export type ActionItem = { key: string; severity: Severity; title: string; detail: string; command: string; href: string; count: number };

const SEV: Record<Severity, string> = { critical: '#dc2626', warning: '#d97706', info: '#2563eb' };
const PAGE = 6;

export default function ActionCenter({ actions }: { actions: ActionItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(actions);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (!items.length) return null;
  const visible = showAll ? items : items.slice(0, PAGE);

  const dismiss = async (key: string) => {
    setBusy(key);
    setItems((cur) => cur.filter((a) => a.key !== key)); // optimistic
    try {
      await fetch('/api/logistics/action/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
      router.refresh();
    } finally { setBusy(null); }
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-caramel" />
        <h2 className="text-lg font-semibold text-gray-900">Action Center</h2>
        <span className="rounded-full bg-cream px-2 py-0.5 text-[11px] font-medium text-maple">{items.length} to action</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((a) => (
          <div key={a.key} className="group relative rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-caramel">
            <button onClick={() => dismiss(a.key)} disabled={busy === a.key} title="Dismiss"
              className="absolute right-2 top-2 rounded-full p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40">
              <X className="h-3.5 w-3.5" />
            </button>
            <Link href={a.href} className="block pr-5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SEV[a.severity] }} />
                  {a.title}
                </span>
                <span className="mr-1 rounded-full bg-gray-100 px-1.5 text-[11px] font-medium text-gray-500">{a.count}</span>
              </div>
              <p className="mt-1.5 text-xs text-gray-600">{a.detail}</p>
              <p className="mt-2 text-[11px] text-gray-400 group-hover:text-maple">💬 “{a.command}”</p>
            </Link>
          </div>
        ))}
      </div>
      {items.length > PAGE && (
        <div className="mt-3 text-center">
          <button onClick={() => setShowAll((s) => !s)} className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-cream">
            {showAll ? 'Show less' : `Show all ${items.length}`}
          </button>
        </div>
      )}
    </section>
  );
}
