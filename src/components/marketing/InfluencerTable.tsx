'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink } from 'lucide-react';

type Inf = {
  id: string; name: string; handle: string | null; followers: number | null; email: string | null;
  flavour_sent: string | null; region: string | null; sent_from: string | null; date_initiated: string | null;
  status: string | null; post_type: string | null; notes: string | null; tracking_number: string | null; tracking_url: string | null;
};

const REGIONS = ['AU', 'UK', 'NZ', 'USA', 'OTHER'];
const REGION_LABEL: Record<string, string> = { AU: '🇦🇺 Australia', UK: '🇬🇧 UK', NZ: '🇳🇿 New Zealand', USA: '🇺🇸 USA', OTHER: '🌍 Other' };
const STATUS = [
  { v: 'order_processing', label: 'Order processing' }, { v: 'shipped', label: 'Shipped' },
  { v: 'delivered', label: 'Delivered' }, { v: 'posted', label: 'Posted' }, { v: 'completed', label: 'Completed' },
];
const POST = ['None', 'Reel', 'Reel + Story', 'Story'];
const STATUS_BADGE: Record<string, string> = {
  order_processing: 'bg-gray-100 text-gray-600', shipped: 'bg-blue-100 text-blue-700',
  delivered: 'bg-violet-100 text-violet-700', posted: 'bg-amber-100 text-amber-700', completed: 'bg-emerald-100 text-emerald-700',
};
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—');

function Cell({ id, field, value, options }: { id: string; field: string; value: string; options: { v: string; label: string }[] }) {
  const [val, setVal] = useState(value);
  const router = useRouter();
  const onChange = async (v: string) => {
    setVal(v);
    await fetch('/api/marketing/influencer', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: v }) });
    router.refresh();
  };
  return (
    <select value={val} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs text-gray-700 focus:border-caramel focus:outline-none">
      {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}

function Notes({ id, value }: { id: string; value: string }) {
  const [val, setVal] = useState(value);
  const [dirty, setDirty] = useState(false);
  const save = async () => {
    if (!dirty) return;
    await fetch('/api/marketing/influencer', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field: 'notes', value: val }) });
    setDirty(false);
  };
  return (
    <input value={val} onChange={(e) => { setVal(e.target.value); setDirty(true); }} onBlur={save}
      placeholder="add note…" className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-xs text-gray-600 hover:border-gray-200 focus:border-caramel focus:outline-none" />
  );
}

export default function InfluencerTable({ influencers }: { influencers: Inf[] }) {
  const [region, setRegion] = useState<string>('ALL');
  const visible = region === 'ALL' ? influencers : influencers.filter((i) => (i.region || 'OTHER') === region);
  const groups = REGIONS.map((r) => ({ region: r, rows: visible.filter((i) => (i.region || 'OTHER') === r) })).filter((g) => g.rows.length);

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

      {groups.map((g) => (
        <div key={g.region} className="mb-5 overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 bg-cream/40 px-4 py-2 text-sm font-semibold text-maple">{REGION_LABEL[g.region]} <span className="text-xs font-normal text-gray-400">· {g.rows.length}</span></div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2">Name</th><th className="px-3 py-2">Handle</th><th className="px-3 py-2">Flavour</th>
                <th className="px-3 py-2">Sent</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Posted Tagged</th>
                <th className="px-3 py-2">Tracking</th><th className="px-3 py-2 w-48">Notes</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((i) => (
                <tr key={i.id} className="border-b border-gray-50 align-top hover:bg-cream/20">
                  <td className="px-3 py-2 font-medium text-gray-800">{i.name}{i.followers ? <span className="block text-[10px] text-gray-400">{i.followers.toLocaleString()} followers</span> : ''}</td>
                  <td className="px-3 py-2 text-gray-500">{i.handle ? <a className="text-blue-600 hover:underline" href={`https://instagram.com/${(i.handle || '').replace('@', '')}`} target="_blank">{i.handle}</a> : '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{i.flavour_sent || '—'}</td>
                  <td className="px-3 py-2 text-gray-400">{fmtDate(i.date_initiated)}</td>
                  <td className="px-3 py-2"><Cell id={i.id} field="status" value={i.status || 'order_processing'} options={STATUS} /></td>
                  <td className="px-3 py-2"><Cell id={i.id} field="post_type" value={POST.includes(i.post_type || '') ? (i.post_type as string) : 'None'} options={POST.map((p) => ({ v: p, label: p }))} /></td>
                  <td className="px-3 py-2 text-xs">{i.tracking_url ? <a href={i.tracking_url} target="_blank" className="inline-flex items-center gap-1 text-blue-600 hover:underline">{i.tracking_number || 'track'}<ExternalLink className="h-3 w-3" /></a> : (i.tracking_number || '—')}</td>
                  <td className="px-3 py-2"><Notes id={i.id} value={i.notes || ''} /></td>
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
