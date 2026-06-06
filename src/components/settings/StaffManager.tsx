'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, Trash2, Link2, Copy } from 'lucide-react';

type Staff = { id: string; email: string; name: string | null; role: string; active: boolean; password_hash?: string | null };

export default function StaffManager({ initial }: { initial: Staff[] }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('staff');
  const [busy, setBusy] = useState(false);
  const [setupLink, setSetupLink] = useState<string | null>(null);
  const router = useRouter();

  const call = async (payload: any) => {
    setBusy(true);
    try {
      const r = await fetch('/api/settings/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (j.setup_link) setSetupLink(j.setup_link);
      router.refresh();
      return j;
    } finally { setBusy(false); }
  };
  const add = async () => { if (!email) return; await call({ action: 'add', email, name, role }); setEmail(''); setName(''); setRole('staff'); };

  return (
    <div>
      {setupLink && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="mb-1 text-xs font-medium text-emerald-700">Setup link — send this to the staff member (one-time):</p>
          <div className="flex items-center gap-2">
            <input readOnly value={setupLink} className="flex-1 rounded border border-emerald-200 bg-white px-2 py-1 text-xs text-gray-700" onFocus={(e) => e.target.select()} />
            <button onClick={() => navigator.clipboard?.writeText(setupLink)} className="rounded bg-emerald-600 p-1.5 text-white"><Copy className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}
      <div className="divide-y divide-gray-100">
        {initial.map((u) => (
          <div key={u.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-gray-800">{u.name || u.email}</p>
              <p className="truncate text-xs text-gray-400">{u.email}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!u.password_hash && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">pending setup</span>}
              <select value={u.role} disabled={busy} onChange={(e) => call({ action: 'update', id: u.id, role: e.target.value })}
                className="rounded-md border border-gray-200 px-2 py-1 text-xs">
                <option value="admin">Admin</option><option value="staff">Staff</option>
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
        ))}
        {initial.length === 0 && <p className="py-3 text-sm text-gray-400">No staff yet.</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@theproteinpancake.co" className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-2 text-sm">
          <option value="staff">Staff</option><option value="admin">Admin</option>
        </select>
        <button disabled={busy || !email} onClick={add} className="flex items-center gap-1.5 rounded-lg bg-caramel px-3 py-2 text-sm font-medium text-white hover:bg-maple disabled:opacity-50">
          <UserPlus className="h-4 w-4" /> Add
        </button>
      </div>
    </div>
  );
}
