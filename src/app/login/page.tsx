'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
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
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        // Hard navigation so the freshly-set auth cookie is guaranteed to be
        // sent with the next request (avoids the soft-nav race that required
        // clicking Sign In multiple times). Keep `loading` true through redirect.
        window.location.assign('/');
        return;
      }

      setError('Incorrect password');
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
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-caramel text-3xl shadow-sm">
            🥞
          </div>
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
            className="w-full rounded-xl border border-gray-200 px-4 py-3 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-caramel"
          />

          {error && <p className="text-center text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-xl bg-caramel px-4 py-3 font-semibold text-white transition-colors hover:bg-maple disabled:cursor-not-allowed disabled:bg-caramel/40"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
