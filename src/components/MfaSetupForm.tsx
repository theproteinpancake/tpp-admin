'use client';
// Forced 2FA enrollment (mandatory for every account, Jun 2026) — reuses the exact same
// /api/settings/2fa begin/enable actions the optional Settings toggle already used, just
// auto-started (no skip) and redirects onward once verified instead of refreshing in place.
import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

export default function MfaSetupForm({ redirectTo }: { redirectTo: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const post = async (body: any) => {
    setBusy(true); setMsg(null);
    try { const r = await fetch('/api/settings/2fa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return await r.json(); }
    finally { setBusy(false); }
  };
  useEffect(() => { (async () => { const j = await post({ action: 'begin' }); if (j.secret) { setSecret(j.secret); setOtpauth(j.otpauth); } })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const enable = async () => {
    const j = await post({ action: 'enable', token });
    // Hard navigation, not router.push — see PasswordUpdateForm for why (stale client route
    // cache can otherwise re-serve a pre-enrollment redirect and bounce the user back here).
    if (j.ok) window.location.href = redirectTo;
    else setMsg(j.error || 'Failed');
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-xl border border-gray-200 bg-paper p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-caramel" />
          <h1 className="text-lg font-bold text-caramel">Set up two-factor authentication</h1>
        </div>
        <p className="mb-4 text-sm text-gray-500">2FA is now required for every account before you can use the dashboard. This takes about a minute.</p>
        {!secret ? (
          <p className="text-sm text-gray-400">{busy ? 'Generating your setup key…' : 'Loading…'}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">In your authenticator app (Google Authenticator, 1Password, etc.) add a new account with this key:</p>
            <code className="block rounded-lg bg-gray-50 px-3 py-2 text-sm font-mono tracking-wider text-caramel">{secret}</code>
            <p className="break-all text-xs text-gray-400">{otpauth}</p>
            <div className="flex items-center gap-2">
              <input value={token} onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Enter the 6-digit code" autoFocus
                className="w-48 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              <button disabled={busy || token.length !== 6} onClick={enable} className="rounded-lg bg-caramel px-3.5 py-2 text-sm font-medium text-white hover:bg-maple disabled:opacity-50">Verify &amp; continue</button>
            </div>
            {msg && <p className="text-xs text-red-500">{msg}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
