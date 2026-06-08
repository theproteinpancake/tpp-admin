'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Trash2, Link2, Copy } from 'lucide-react';

type Staff = { id: string; email: string; name: string | null; role: string; active: boolean; sections?: string[] | null; password_hash?: string | null };

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'owner', label: 'Owner (full access)' },
  { value: 'wholesale', label: 'Wholesale & Marketing' },
  { value: 'marketing', label: 'Marketing only' },
  { value: 'logistics', label: 'Logistics & App' },
  { value: 'staff', label: 'Staff (custom)' },
];
const SECTIONS: { key: string; label: string }[] = [
  { key: 'app', label: 'App' }, { key: 'logistics', label: 'Logistics' },
  { key: 'wholesale', label: 'Wholesale' }, { key: 'marketing', label: 'Marketing' },
];
const ROLE_DEFAULTS: Record<string, string[]> = {
  owner: ['app', 'logistics', 'wholesale', 'marketing'], admin: ['app', 'logistics', 'wholesale', 'marketing'],
  wholesale: ['wholesale', 'marketing'], marketing: ['marketing'], logistics: ['app', 'logistics'], staff: [],
};
const effectiveSections = (u: { role: string; sections?: string[] | null }) =>
  u.role === 'owner' || u.role === 'admin' ? ROLE_DEFAULTS.owner
    : (u.sections && u.sections.length ? u.sections : (ROLE_DEFAULTS[u.role] || []));

export default function StaffManager({ initial }: { initial: Staff[] }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('staff');
  const [sections, setSections] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [setupLink, setSetupLink] = useState<string | null>(null);
  const router = useRouter();

  const call = async (payload: any) => {
    setBusy(true);
    try {
      const r = await fetch('/api/settings/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (j.error) alert(j.error);
      if (j.setup_link) setSetupLink(j.setup_link);
      router.refresh();
      return j;
    } finally { setBusy(false); }
  };
  const add = async () => { if (!email) return; await call({ action: 'add', email, name, role, sections }); setEmail(''); setName(''); setRole('staff'); setSections([]); };
  const toggleSection = (u: Staff, key: string) => {
    const cur = effectiveSections(u);
    const next = cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key];
    call({ action: 'update', id: u.id, sections: next });
  };
  const toggleNewSection = (key: string) => setSections((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));

  return (
    <div>
      {setupLink && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="mb-1 text-xs font-medium text-emerald-700">Setup link — send this to the staff member (one-time):</p>
          <div className="flex items-center gap-2">
            <input readOnly value={setupLink} className="flex-1 rounded border border-emerald-200 bg-paper px-2 py-1 text-xs text-caramel" onFocus={(e) => e.target.select()} />
            <button onClick={() => navigator.clipboard?.writeText(setupLink)} className="rounded bg-emerald-600 p-1.5 text-white"><Copy className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}
      <div className="divide-y divide-gray-100">
        {initial.map((u) => {
          const owner = u.role === 'owner' || u.role === 'admin';
          const eff = effectiveSections(u);
          return (
            <div key={u.id} className="py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-caramel">{u.name || u.email}</p>
                  <p className="truncate text-xs text-gray-400">{u.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!u.password_hash && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">pending setup</span>}
                  <select value={u.role} disabled={busy} onChange={(e) => call({ action: 'update', id: u.id, role: e.target.value })}
                    className="rounded-md border border-gray-200 px-2 py-1 text-xs">
                    {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <button disabled={busy} onClick={() => call({ action: 'update', id: u.id, active: !u.active })}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${u.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {u.active ? 'Active' : 'Disabled'}
                  </button>
                  <button title="Reset & get a new setup link" disabled={busy} onClick={() => { if (confirm(`Reset ${u.email}'s login? They'll set a new password + 2FA.`)) call({ action: 'reset_setup', id: u.id }); }}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100"><Link2 className="h-3.5 w-3.5" /></button>
                  <button disabled={busy} onClick={() => { if (confirm(`Remove ${u.email}?`)) call({ action: 'remove', id: u.id }); }}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-gray-400">Access:</span>
                {owner ? (
                  <span className="rounded-full bg-caramel/10 px-2 py-0.5 text-[11px] font-medium text-caramel">Everything</span>
                ) : SECTIONS.map((s) => {
                  const on = eff.includes(s.key);
                  return (
                    <button key={s.key} disabled={busy} onClick={() => toggleSection(u, s.key)}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${on ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {initial.length === 0 && <p className="py-3 text-sm text-gray-400">No staff yet.</p>}
      </div>

      <div className="mt-4 border-t border-gray-100 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@theproteinpancake.co" className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-2 text-sm">
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button disabled={busy || !email} onClick={add} className="flex items-center gap-1.5 rounded-lg bg-caramel px-3 py-2 text-sm font-medium text-white hover:bg-maple disabled:opacity-50">
            <UserPlus className="h-4 w-4" /> Add
          </button>
        </div>
        {role === 'staff' && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-gray-400">Custom access:</span>
            {SECTIONS.map((s) => (
              <button key={s.key} type="button" onClick={() => toggleNewSection(s.key)}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${sections.includes(s.key) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
