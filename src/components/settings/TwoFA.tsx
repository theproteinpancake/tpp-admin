'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';

export default function TwoFA({ enabled }: { enabled: boolean }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const post = async (body: any) => {
    setBusy(true); setMsg(null);
    try { const r = await fetch('/api/settings/2fa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return await r.json(); }
    finally { setBusy(false); }
  };
  const begin = async () => { const j = await post({ action: 'begin' }); if (j.secret) { setSecret(j.secret); setOtpauth(j.otpauth); } };
  const enable = async () => { const j = await post({ action: 'enable', token }); if (j.ok) { setSecret(null); setToken(''); router.refresh(); } else setMsg(j.error || 'Failed'); };

  // Mandatory for every account — no disable option (guard.ts also enforces this on every page).
  if (enabled) {
    return <p className="flex items-center gap-2 text-sm font-medium text-emerald-600"><ShieldCheck className="h-4 w-4" /> 2FA is ON — required for every account.</p>;
  }

  return (
    <div>
      {!secret ? (
        <button disabled={busy} onClick={begin} className="flex items-center gap-1.5 rounded-lg bg-caramel px-3.5 py-2 text-sm font-medium text-white hover:bg-maple disabled:opacity-50">
          <ShieldCheck className="h-4 w-4" /> Set up 2FA
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">In your authenticator app (Google Authenticator, 1Password, etc.) add a new account with this key:</p>
          <code className="block rounded-lg bg-gray-50 px-3 py-2 text-sm font-mono tracking-wider text-caramel">{secret}</code>
          <p className="break-all text-xs text-gray-400">{otpauth}</p>
          <div className="flex items-center gap-2">
            <input value={token} onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Enter the 6-digit code" className="w-48 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            <button disabled={busy || token.length !== 6} onClick={enable} className="rounded-lg bg-caramel px-3.5 py-2 text-sm font-medium text-white hover:bg-maple disabled:opacity-50">Verify &amp; enable</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
    </div>
  );
}
