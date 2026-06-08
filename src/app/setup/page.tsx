'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';

function SetupInner() {
  const sp = useSearchParams();
  const email = sp.get('email') || '';
  const token = sp.get('token') || '';

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [secret, setSecret] = useState('');
  const [otpauth, setOtpauth] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const setPassword = async () => {
    setError('');
    if (pw.length < 8) return setError('Password must be at least 8 characters.');
    if (pw !== pw2) return setError('Passwords don’t match.');
    setBusy(true);
    try {
      const r = await fetch('/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_password', email, setup_token: token, password: pw }) });
      const j = await r.json();
      if (!j.ok) return setError(j.error || 'Something went wrong.');
      setSecret(j.secret); setOtpauth(j.otpauth); setStep(2);
    } finally { setBusy(false); }
  };
  const enable2fa = async () => {
    setError(''); setBusy(true);
    try {
      const r = await fetch('/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'enable_2fa', email, setup_token: token, token: code }) });
      const j = await r.json();
      if (!j.ok) return setError(j.error || 'Code didn’t match.');
      setStep(3);
    } finally { setBusy(false); }
  };

  if (!email || !token) {
    return <p className="text-center text-sm text-red-500">Invalid setup link. Ask your admin to send a new one.</p>;
  }

  return (
    <>
      <div className="mb-6 text-center">
        <Image src="/tpp-smile.png" alt="TPP" width={56} height={56} className="mx-auto mb-3 rounded-2xl shadow-sm" priority />
        <h1 className="text-xl font-bold text-caramel">Set up your account</h1>
        <p className="mt-1 text-sm text-gray-500">{email}</p>
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 8 chars)" className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-caramel" />
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm password" className="w-full rounded-xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-caramel" />
          {error && <p className="text-center text-sm text-red-500">{error}</p>}
          <button disabled={busy} onClick={setPassword} className="w-full rounded-xl bg-caramel px-4 py-3 font-semibold text-white hover:bg-maple disabled:opacity-50">Continue</button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Add this key to your authenticator app (Google Authenticator, 1Password…):</p>
          <code className="block rounded-lg bg-gray-50 px-3 py-2 text-center text-sm font-mono tracking-wider text-caramel">{secret}</code>
          <p className="break-all text-[11px] text-gray-400">{otpauth}</p>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Enter the 6-digit code" className="w-full rounded-xl border border-gray-200 px-4 py-3 text-center tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-caramel" />
          {error && <p className="text-center text-sm text-red-500">{error}</p>}
          <button disabled={busy || code.length !== 6} onClick={enable2fa} className="w-full rounded-xl bg-caramel px-4 py-3 font-semibold text-white hover:bg-maple disabled:opacity-50">Verify &amp; finish</button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 text-center">
          <p className="text-sm text-caramel">All set! 🎉 Your password and 2FA are ready.</p>
          <a href="/login" className="inline-block rounded-xl bg-caramel px-5 py-3 font-semibold text-white hover:bg-maple">Go to sign in</a>
        </div>
      )}
    </>
  );
}

export default function SetupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-cream via-churro/40 to-cream">
      <div className="w-full max-w-md rounded-2xl border border-churro/60 bg-paper p-8 shadow-xl">
        <Suspense fallback={<p className="text-center text-sm text-gray-400">Loading…</p>}>
          <SetupInner />
        </Suspense>
      </div>
    </div>
  );
}
