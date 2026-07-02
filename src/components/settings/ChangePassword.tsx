'use client';
import { useState } from 'react';

const MIN_LEN = 12;
function clientPolicyError(pw: string): string | null {
  if (pw.length < MIN_LEN) return `Password must be at least ${MIN_LEN} characters.`;
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include a special character (e.g. ! @ # $ %).';
  return null;
}

export default function ChangePassword({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setMsg(null);
    const err = clientPolicyError(next);
    if (err) return setMsg(err);
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
      <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (min 12 chars)" className="w-44 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
      <button disabled={busy || !next} onClick={save} className="rounded-lg bg-caramel px-3.5 py-2 text-sm font-medium text-white hover:bg-maple disabled:opacity-50">Update</button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </div>
  );
}
