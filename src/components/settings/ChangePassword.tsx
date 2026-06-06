'use client';
import { useState } from 'react';

export default function ChangePassword({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setMsg(null);
    if (next.length < 8) return setMsg('New password must be at least 8 characters.');
    setBusy(true);
    try {
      const r = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, new: next }) });
      const j = await r.json();
      setMsg(j.ok ? 'Password updated ✓' : (j.error || 'Failed'));
      if (j.ok) { setCurrent(''); setNext(''); }
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasPassword && <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" className="w-44 rounded-lg border border-gray-200 px-3 py-2 text-sm" />}
      <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password" className="w-44 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
      <button disabled={busy || !next} onClick={save} className="rounded-lg bg-caramel px-3.5 py-2 text-sm font-medium text-white hover:bg-maple disabled:opacity-50">Update</button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </div>
  );
}
