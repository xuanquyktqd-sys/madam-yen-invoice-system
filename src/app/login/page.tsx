'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const text = await res.text();
      const json = (() => { try { return JSON.parse(text); } catch { return null; } })();
      if (!res.ok) {
        throw new Error(String(json?.error ?? text ?? 'Login failed'));
      }

      const role = json?.role;
      window.location.href = role === 'staff' ? '/upload' : '/dashboard';
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        <h1 className="text-white text-2xl font-black">Madam Yen IMS</h1>
        <p className="text-slate-400 text-sm mt-1">Sign in to continue</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <label className="block">
            <div className="text-xs text-slate-400 mb-1">Username</div>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-500"
              autoComplete="username"
              required
            />
          </label>
          <label className="block">
            <div className="text-xs text-slate-400 mb-1">Password</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-500"
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="text-sm text-rose-200 bg-rose-950/30 border border-rose-900/40 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

