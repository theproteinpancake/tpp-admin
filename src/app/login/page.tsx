'use client';

import { useState } from 'react';
import Image from 'next/image';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, token }),
      });

      if (res.ok) {
        window.location.assign('/');
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (data.twofa) {
        setNeedCode(true);
        setError(data.error === '2fa_required' ? '' : 'Invalid code');
      } else {
        setError('Incorrect password');
      }
      setLoading(false);
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-cream via-churro/40 to-cream">
      <div className="w-full max-w-md rounded-2xl border border-churro/60 bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <Image src="/tpp-smile.png" alt="The Protein Pancake" width={64} height={64} className="mx-auto mb-4 rounded-2xl shadow-sm" priority />
          <h1 className="text-2xl font-bold text-gray-900">TPP Control</h1>
          <p className="mt-1 text-gray-500">Sign in to the dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            readOnly={needCode}
            className="w-full rounded-xl border border-gray-200 px-4 py-3 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-caramel disabled:bg-gray-50"
          />

          {needCode && (
            <input
              type="text" inputMode="numeric" autoComplete="one-time-code"
              value={token}
              onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit authenticator code"
              autoFocus
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-center tracking-[0.3em] transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-caramel"
            />
          )}

          {error && <p className="text-center text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading || !password || (needCode && token.length !== 6)}
            className="w-full rounded-xl bg-caramel px-4 py-3 font-semibold text-white transition-colors hover:bg-maple disabled:cursor-not-allowed disabled:bg-caramel/40"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
