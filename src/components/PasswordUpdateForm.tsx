'use client';
// Forced password (re)set — mandatory for every account, and mandatory yearly rotation
// (Amazon SP-API security requirement, Jul 2026). Reuses the same /api/auth/change-password
// endpoint the optional Settings field already used; the server is the source of truth for the
// policy, this just mirrors it for immediate feedback.
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

const MIN_LEN = 12;
function clientPolicyError(pw: string): string | null {
  if (pw.length < MIN_LEN) return `Password must be at least ${MIN_LEN} characters.`;
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include a special character (e.g. ! @ # $ %).';
  return null;
}

export default function PasswordUpdateForm({ hasPassword, redirectTo }: { hasPassword: boolean; redirectTo: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setMsg(null);
    const err = clientPolicyError(next);
    if (err) return setMsg(err);
    if (next !== confirm) return setMsg('Passwords don’t match.');
    setBusy(true);
    try {
      const r = await fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, new: next }) });
      const j = await r.json();
      // Hard navigation, not router.push — the destination's guard check depends on the
      // password_changed_at we just wrote, and Next's client router cache can otherwise
      // serve a page prefetched before that write, bouncing straight back here (the loop
      // Luke hit in prod: password saved fine, but the cached /analytics prefetch still
      // carried the pre-update redirect back to /password-update).
      if (j.ok) window.location.href = redirectTo;
      else setMsg(j.error || 'Failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-xl border border-gray-200 bg-paper p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-caramel" />
          <h1 className="text-lg font-bold text-caramel">{hasPassword ? 'Time to update your password' : 'Set your password'}</h1>
        </div>
        <p className="mb-4 text-sm text-gray-500">
          {hasPassword
            ? 'Passwords must be rotated at least once a year. This takes about a minute.'
            : 'Every account needs its own password before continuing.'}
        </p>
        <div className="space-y-3">
          {hasPassword && (
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" autoFocus
              className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-caramel" />
          )}
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder={`New password (min ${MIN_LEN} chars)`}
            className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-caramel" />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-caramel" />
          <p className="text-xs text-gray-400">Needs an uppercase and lowercase letter, a number, and a special character.</p>
          {msg && <p className="text-sm text-red-500">{msg}</p>}
          <button disabled={busy || !next} onClick={save} className="w-full rounded-xl bg-caramel px-4 py-3 font-semibold text-white hover:bg-maple disabled:opacity-50">
            Update password
          </button>
        </div>
      </div>
    </div>
  );
}
