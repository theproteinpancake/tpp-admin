'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Trash2, Search, X } from 'lucide-react';

type Inf = {
  id: string; name: string; handle: string | null; followers: number | null; email: string | null;
  flavour_sent: string | null; region: string | null; sent_from: string | null; date_initiated: string | null;
  status: string | null; post_type: string | null; notes: string | null; tracking_number: string | null; tracking_url: string | null;
  cost_cogs: number | null; cost_fulfilment: number | null; parcel_cost: number | null; cost_currency: string | null;
};
const ccy = (n: number | null, cur?: string | null) => (n == null ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: cur || 'AUD' }).format(n));

const REGIONS = ['AU', 'UK', 'NZ', 'USA', 'OTHER'];
const REGION_LABEL: Record<string, string> = { AU: '🇦🇺 Australia', UK: '🇬🇧 UK', NZ: '🇳🇿 New Zealand', USA: '🇺🇸 USA', OTHER: '🌍 Other' };
const STATUS = [
  { v: 'order_processing', label: 'Order processing' }, { v: 'shipped', label: 'Shipped' },
  { v: 'delivered', label: 'Delivered' }, { v: 'completed', label: 'Completed' },
];
const POST = ['None', 'Reel', 'Reel + Story', 'Story'];
// colour by stage: not-done = amber, in-transit = blue, delivered = indigo, done = green
const STATUS_COLOR: Record<string, string> = {
  order_processing: 'bg-amber-50 text-amber-700 border-amber-200',
  shipped: 'bg-blue-50 text-blue-700 border-blue-200',
  delivered: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const POST_COLOR: Record<string, string> = {
  None: 'bg-gray-50 text-gray-500 border-gray-200',
  Story: 'bg-amber-50 text-amber-700 border-amber-200',
  Reel: 'bg-blue-50 text-blue-700 border-blue-200',
  'Reel + Story': 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—');

function Cell({ id, field, value, options, colors }: { id: string; field: string; value: string; options: { v: string; label: string }[]; colors?: Record<string, string> }) {
  const [val, setVal] = useState(value);
  const router = useRouter();
  const onChange = async (v: string) => {
    setVal(v);
    await fetch('/api/marketing/influencer', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: v }) });
    router.refresh();
  };
  const cls = colors?.[val] || 'bg-paper text-caramel border-gray-200';
  return (
    <select value={val} onChange={(e) => onChange(e.target.value)} className={`rounded-md border px-1.5 py-1 text-xs font-medium focus:outline-none ${cls}`}>
      {options.map((o) => <option key={o.v} value={o.v} className="bg-paper text-caramel">{o.label}</option>)}
    </select>
  );
}

// Inline-editable free-text field (notes, handle, email) — saves on blur.
function EditText({ id, field, value, placeholder, className }: { id: string; field: string; value: string; placeholder: string; className?: string }) {
  const [val, setVal] = useState(value);
  const [dirty, setDirty] = useState(false);
  const router = useRouter();
  const save = async () => {
    if (!dirty) return;
    await fetch('/api/marketing/influencer', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: val.trim() || null }) });
    setDirty(false);
    router.refresh();
  };
  return (
    <input value={val} onChange={(e) => { setVal(e.target.value); setDirty(true); }} onBlur={save}
      placeholder={placeholder} className={className || 'w-full rounded border border-transparent bg-transparent px-1 py-1 text-xs text-gray-600 hover:border-gray-200 focus:border-caramel focus:outline-none'} />
  );
}

function DeleteBtn({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const del = async () => {
    if (!confirm(`Remove ${name} from the influencer list? This can't be undone.`)) return;
    setBusy(true);
    try { await fetch(`/api/marketing/influencer?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); router.refresh(); }
    finally { setBusy(false); }
  };
  return (
    <button onClick={del} disabled={busy} title="Remove influencer" className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-40">
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

const SORTS: { v: string; label: string }[] = [
  { v: 'date_desc', label: 'Newest sent' }, { v: 'date_asc', label: 'Oldest sent' },
  { v: 'name', label: 'Name A–Z' }, { v: 'followers', label: 'Most followers' }, { v: 'cost', label: 'Highest cost' },
];
const normStatus = (s: string | null) => (['order_processing', 'shipped', 'delivered', 'completed'].includes(s || '') ? (s as string) : 'order_processing');
const normPost = (p: string | null) => (POST.includes(p || '') ? (p as string) : 'None');

export default function InfluencerTable({ influencers }: { influencers: Inf[] }) {
  const [region, setRegion] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [postF, setPostF] = useState('');
  const [sort, setSort] = useState('date_desc');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = influencers.filter((i) => {
      if (region !== 'ALL' && (i.region || 'OTHER') !== region) return false;
      if (statusF && normStatus(i.status) !== statusF) return false;
      if (postF && normPost(i.post_type) !== postF) return false;
      if (needle && !`${i.name} ${i.handle || ''} ${i.email || ''} ${i.flavour_sent || ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const t = (d: string | null) => { const v = Date.parse((d || '') + 'T00:00:00'); return Number.isNaN(v) ? 0 : v; };
    out = [...out].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'followers' ? (b.followers || 0) - (a.followers || 0)
      : sort === 'cost' ? (b.parcel_cost || 0) - (a.parcel_cost || 0)
      : sort === 'date_asc' ? t(a.date_initiated) - t(b.date_initiated)
      : t(b.date_initiated) - t(a.date_initiated));
    return out;
  }, [influencers, region, q, statusF, postF, sort]);

  const groups = REGIONS.map((r) => ({ region: r, rows: filtered.filter((i) => (i.region || 'OTHER') === r) })).filter((g) => g.rows.length);
  const active = !!q || !!statusF || !!postF;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {['ALL', ...REGIONS].map((r) => (
          <button key={r} onClick={() => setRegion(r)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${region === r ? 'bg-caramel text-white' : 'bg-gray-100 text-gray-600 hover:bg-cream'}`}>
            {r === 'ALL' ? `All (${influencers.length})` : `${REGION_LABEL[r].split(' ')[0]} ${r} (${influencers.filter((i) => (i.region || 'OTHER') === r).length})`}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / handle / email / flavour…"
            className="w-56 rounded-lg border border-gray-200 py-1.5 pl-8 pr-2 text-sm text-caramel placeholder:text-gray-400 focus:border-caramel focus:outline-none focus:ring-1 focus:ring-caramel" />
        </div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-caramel focus:border-caramel focus:outline-none">
          <option value="">Delivery: All</option>
          {STATUS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
        <select value={postF} onChange={(e) => setPostF(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-caramel focus:border-caramel focus:outline-none">
          <option value="">Posted: All</option>
          {POST.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-caramel focus:border-caramel focus:outline-none">
          {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
        {active && (
          <button onClick={() => { setQ(''); setStatusF(''); setPostF(''); }} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{filtered.length} of {influencers.length}</span>
      </div>

      {groups.map((g) => (
        <div key={g.region} className="mb-5 overflow-x-auto rounded-xl border border-gray-200 bg-paper shadow-sm">
          <div className="border-b border-gray-100 bg-cream/40 px-4 py-2 text-sm font-semibold text-maple">{REGION_LABEL[g.region]} <span className="text-xs font-normal text-gray-400">· {g.rows.length}</span></div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2">Name</th><th className="px-3 py-2">Handle</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Flavour</th>
                <th className="px-3 py-2">Sent</th><th className="px-3 py-2">Delivery Status</th><th className="px-3 py-2">Posted Status</th>
                <th className="px-3 py-2">Cost</th><th className="px-3 py-2">Tracking</th><th className="px-3 py-2 w-48 min-w-40">Notes</th>
                <th className="sticky right-0 bg-cream/95 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((i) => (
                <tr key={i.id} className="border-b border-gray-50 align-top hover:bg-cream/20">
                  <td className="px-3 py-2 font-medium text-caramel">
                    <EditText id={i.id} field="name" value={i.name} placeholder="add name…" className="w-32 rounded border border-transparent bg-transparent px-1 py-1 text-sm font-medium text-caramel placeholder:text-gray-300 hover:border-gray-200 focus:border-caramel focus:outline-none" />
                    {i.followers ? <span className="block px-1 text-[10px] text-gray-400">{i.followers.toLocaleString()} followers</span> : ''}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    <div className="flex items-center gap-1">
                      <EditText id={i.id} field="handle" value={i.handle || ''} placeholder="add handle…" className="w-28 rounded border border-transparent bg-transparent px-1 py-1 text-xs text-blue-600 placeholder:text-gray-300 hover:border-gray-200 focus:border-caramel focus:outline-none" />
                      {i.handle && <a href={`https://instagram.com/${i.handle.replace('@', '')}`} target="_blank" title="open Instagram"><ExternalLink className="h-3 w-3 shrink-0 text-gray-400 hover:text-blue-600" /></a>}
                    </div>
                  </td>
                  <td className="max-w-[190px] px-3 py-2 text-xs">
                    <div className="flex items-center gap-1">
                      <EditText id={i.id} field="email" value={i.email || ''} placeholder="add email…" className="w-36 truncate rounded border border-transparent bg-transparent px-1 py-1 text-xs text-blue-600 placeholder:text-gray-300 hover:border-gray-200 focus:border-caramel focus:outline-none" />
                      {i.email && <a href={`mailto:${i.email}`} title={`email ${i.email}`}><ExternalLink className="h-3 w-3 shrink-0 text-gray-400 hover:text-blue-600" /></a>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">{i.flavour_sent || '—'}</td>
                  <td className="px-3 py-2 text-gray-400">{fmtDate(i.date_initiated)}</td>
                  <td className="px-3 py-2"><Cell id={i.id} field="status" value={['order_processing', 'shipped', 'delivered', 'completed'].includes(i.status || '') ? (i.status as string) : 'order_processing'} options={STATUS} colors={STATUS_COLOR} /></td>
                  <td className="px-3 py-2"><Cell id={i.id} field="post_type" value={POST.includes(i.post_type || '') ? (i.post_type as string) : 'None'} options={POST.map((p) => ({ v: p, label: p }))} colors={POST_COLOR} /></td>
                  <td className="px-3 py-2 text-xs text-gray-600" title={i.parcel_cost != null ? `COGS ${ccy(i.cost_cogs, i.cost_currency)} + fulfilment ${ccy(i.cost_fulfilment, i.cost_currency)}` : ''}>{ccy(i.parcel_cost, i.cost_currency)}</td>
                  <td className="px-3 py-2 text-xs">{i.tracking_url ? <a href={i.tracking_url} target="_blank" className="inline-flex items-center gap-1 text-blue-600 hover:underline">{i.tracking_number || 'track'}<ExternalLink className="h-3 w-3" /></a> : (i.tracking_number || '—')}</td>
                  <td className="px-3 py-2"><EditText id={i.id} field="notes" value={i.notes || ''} placeholder="add note…" /></td>
                  <td className="sticky right-0 bg-paper/95 px-2 py-2 backdrop-blur-sm"><DeleteBtn id={i.id} name={i.name} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {groups.length === 0 && <p className="py-6 text-center text-sm text-gray-400">No influencers in this region.</p>}
    </div>
  );
}
